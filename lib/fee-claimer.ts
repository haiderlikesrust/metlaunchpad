import BN from "bn.js";
import {CpAmm,getUnClaimLpFee} from "@meteora-ag/cp-amm-sdk";
import type {VersionedTransactionResponse} from "@solana/web3.js";
import {database,pubkey,rpc} from "./server";
import {agentSigner} from "./custody";
import {signOperation,type Operation} from "./chain-journal";
import {chainEvents} from "./chain-events";
import {livePool,mintInfo} from "./pool-state";
import {historicalPrice} from "./asset-price";
import {recordAssetClaim} from "./asset-ledger";
import {gasBudget} from "./gas-budget";
import {tokenDelta} from "./token-deltas";
import {SOL_MINT} from "./launch-economics";

export async function ingestClaim(op:Operation){
 if(op.status!=="finalized"||!op.result_json||!op.agent_id||!op.signature)return;
 const context=JSON.parse(op.context_json) as {pool:string;baseMint:string;quoteMint:string;quoteDecimals:number;wallet:string;position?:string},tx=JSON.parse(op.result_json) as VersionedTransactionResponse,at=(tx.blockTime||0)*1000;
 if(!at)return;const events=chainEvents(tx).filter(e=>e.data.pool?.toString()===context.pool);let base=0n,quote=0n;
 for(const e of events){if(e.name==="evtClaimTradingFee"){base+=BigInt(e.data.tokenBaseAmount.toString());quote+=BigInt(e.data.tokenQuoteAmount.toString());}else if(e.name==="evtClaimPositionFee"&&e.data.owner.toString()===context.wallet&&e.data.position.toString()===context.position){base+=BigInt(e.data.feeAClaimed.toString());quote+=BigInt(e.data.feeBClaimed.toString());}}
 for(const e of chainEvents(tx)){if((e.name==="claimFee"||e.name==="claimFee2")&&e.data.lbPair?.toString()===context.pool&&e.data.owner?.toString()===context.wallet&&e.data.position?.toString()===context.position){base+=BigInt(e.data.feeX.toString());quote+=BigInt(e.data.feeY.toString());}}
 // Token-2022 transfer fees are not spendable proceeds. Account only for net receipts.
 const receivedBase=tokenDelta(tx,context.wallet,context.baseMint);base=receivedBase<base?receivedBase:base;
 if(context.quoteMint!==SOL_MINT){const received=tokenDelta(tx,context.wallet,context.quoteMint);quote=received<quote?received:quote;}
 if(base<0n||quote<0n)throw new Error("Claim receipt decreased the agent's token balance.");
 if(base===0n&&quote===0n)return;
 for(const [mint,amount,decimals] of [[context.baseMint,base,9],[context.quoteMint,quote,context.quoteDecimals]] as [string,bigint,number][]){
  if(amount===0n)continue;const price=await historicalPrice(mint,at),usd=price===null?null:Math.floor(Number(amount)/10**decimals*price*1e6);if(usd!==null&&!Number.isSafeInteger(usd))throw new Error("Claim valuation exceeds accounting precision.");await recordAssetClaim(op.agent_id,op.signature,mint,amount,decimals,usd,at);
 }
 const rows=await database().prepare("SELECT amount,mint,decimals,usd_micros FROM asset_claims WHERE signature=?").bind(op.signature).all<{amount:string;mint:string;decimals:number;usd_micros:number|null}>();
 for(const row of rows.results)if(row.usd_micros===null){const price=await historicalPrice(row.mint,at);if(price!==null){const usd=Math.floor(Number(BigInt(row.amount))/10**row.decimals*price*1e6);if(Number.isSafeInteger(usd))await database().prepare("UPDATE asset_claims SET usd_micros=? WHERE signature=? AND mint=? AND usd_micros IS NULL").bind(usd,op.signature,row.mint).run();row.usd_micros=usd;}}
 if(rows.results.length&&rows.results.every(r=>r.usd_micros!==null)){const usd=rows.results.reduce((s,r)=>s+r.usd_micros!,0);if(!Number.isSafeInteger(usd))throw new Error("Claim value is out of range.");await database().prepare("INSERT OR IGNORE INTO fee_receipts(signature,agent_id,recipient,usd_micros,compute_micros,verified_at) VALUES(?,?,?,?,?,?)").bind(op.signature,op.agent_id,context.wallet,usd,Math.floor(usd*.05),Date.now()).run();}
}
export async function claimFees(mint:string){
 const state=await livePool(mint),agent=state.launch.agent_id,signer=await agentSigner(agent),db=database();
 const pending=await db.prepare("SELECT * FROM chain_operations WHERE agent_id=? AND purpose='claim' AND status IN ('submitted','prepared') ORDER BY created_at LIMIT 1").bind(agent).first<Operation>();
 if(pending){const {reconcileOperation,submitOperation}=await import("./chain-journal");const op=pending.status==="prepared"?await submitOperation(pending.id,pending.wire):await reconcileOperation(pending);await ingestClaim(op);return;}
 const context={baseMint:mint,quoteMint:state.launch.quote_mint,quoteDecimals:state.launch.quote_decimals,wallet:signer.publicKey.toBase58()};
 if(await gasBudget(agent)<1_000_000n)return;
 // DBC fees may still be unclaimed after graduation. Claim them before the DAMM position.
 if(state.pool.poolState.partnerBaseFee.gtn(0)||state.pool.poolState.partnerQuoteFee.gtn(0)){
  const op=await signOperation(crypto.randomUUID(),"claim",agent,async()=>({tx:await state.dbc.partner.claimPartnerTradingFee({feeClaimer:signer.publicKey,payer:signer.publicKey,pool:pubkey(state.launch.pool_address),maxBaseAmount:new BN("18446744073709551615"),maxQuoteAmount:new BN("18446744073709551615")}),signers:[signer],context:{...context,pool:state.launch.pool_address}}));await ingestClaim(op);return;
 }
 if(state.graduated&&state.dammState){
  const sdk=new CpAmm(rpc()),p=state.dammState,positions=await sdk.getUserPositionByPool(pubkey(state.graduated),signer.publicKey),[a,b]=await Promise.all([mintInfo(mint),mintInfo(state.launch.quote_mint)]);
  for(const position of positions){
   const fees=getUnClaimLpFee(p,position.positionState);if(fees.feeTokenA.isZero()&&fees.feeTokenB.isZero())continue;
   const recent=await db.prepare("SELECT id FROM chain_operations WHERE agent_id=? AND purpose='claim' AND created_at>? AND json_extract(context_json,'$.position')=? LIMIT 1").bind(agent,Date.now()-300000,position.position.toBase58()).first();if(recent)continue;
   const op=await signOperation(crypto.randomUUID(),"claim",agent,async()=>({tx:await sdk.claimPositionFee({owner:signer.publicKey,position:position.position,positionNftAccount:position.positionNftAccount,pool:pubkey(state.graduated!),tokenAMint:p.tokenAMint,tokenBMint:p.tokenBMint,tokenAVault:p.tokenAVault,tokenBVault:p.tokenBVault,tokenAProgram:a.program,tokenBProgram:b.program}),signers:[signer],context:{...context,pool:state.graduated,position:position.position.toBase58()}}));await ingestClaim(op);break;
  }
 }
}
