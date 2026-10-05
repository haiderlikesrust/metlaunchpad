import DLMM,{ActivationType,StrategyType,deriveCustomizablePermissionlessLbPair,LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import {Keypair,PublicKey,Transaction,type VersionedTransactionResponse} from "@solana/web3.js";
import BN from "bn.js";
import {database,event,HttpError,pubkey,rpc} from "./server";
import {agentSigner} from "./custody";
import {assetBalance,creditEntry,reserveJob,type ExecutionJob} from "./asset-ledger";
import {stageOperation} from "./fee-jobs";
import {signOperation,type Operation} from "./chain-journal";
import {chainEvents} from "./chain-events";
import {livePool} from "./pool-state";
import {assetPrice} from "./asset-price";
import {ingestClaim} from "./fee-claimer";
import type {Proposal} from "./engine";
import {gasBudget} from "./gas-budget";
import {tokenDelta} from "./token-deltas";
import {SOL_MINT} from "./launch-economics";
import {nativeLaunchFeeBps} from "./launch-fee";
function jobShape(id:string,agent:string):ExecutionJob{return {id,agent_id:agent,kind:"dlmm",status:"reserved",input_mint:"",input_amount:"0",output_mint:null,output_amount:null,context_json:"{}",created_at:Date.now()};}
async function ownedPool(agent:string,address:string,mint:string,quote:string){const signer=await agentSigner(agent),pool=await DLMM.create(rpc(),pubkey(address));if(pool.tokenX.publicKey.toBase58()!==mint||pool.tokenY.publicKey.toBase58()!==quote||!pool.lbPair.creator.equals(signer.publicKey))throw new Error("Companion pool binding mismatch.");return {pool,signer};}
export async function ensureCompanion(mint:string){
 const state=await livePool(mint);if(!state.graduated)return null;const agent=state.launch.agent_id,signer=await agentSigner(agent);
 const [address]=deriveCustomizablePermissionlessLbPair(pubkey(mint),pubkey(state.launch.quote_mint),new PublicKey(LBCLMM_PROGRAM_IDS["mainnet-beta"]));
 if(!await rpc().getAccountInfo(address)){
  // Initial setup uses only the agent's gas balance. Principal stays permanently locked in DAMM.
  if(await gasBudget(agent)<100_000_000n)throw new HttpError(409,"Accumulating earned reserves for companion-pool account rent.");
  const op=await stageOperation(jobShape(`companion:${agent}`,agent),"create",async()=>({tx:await DLMM.createCustomizablePermissionlessLbPair2(rpc(),new BN(100),pubkey(mint),pubkey(state.launch.quote_mint),new BN(DLMM.getBinIdFromPrice(state.priceQuote*10**(state.launch.quote_decimals-9),100,false)),new BN(nativeLaunchFeeBps(state.curve)),ActivationType.Timestamp,false,signer.publicKey),signers:[signer],context:{mint,quote:state.launch.quote_mint,pool:address.toBase58()}}));if(op.status!=="finalized")return null;
 }
 await ownedPool(agent,address.toBase58(),mint,state.launch.quote_mint);await database().prepare("UPDATE agent_custody SET dlmm_pool=? WHERE agent_id=?").bind(address.toBase58(),agent).run();return address.toBase58();
}
export async function executeLiquidityJob(job:ExecutionJob){
 const c=JSON.parse(job.context_json),{pool,signer}=await ownedPool(job.agent_id,c.pool,c.baseMint,c.quoteMint);
 if(job.kind==="dlmm_add"){
  const active=await pool.getActiveBin(),half=Math.max(1,Math.min(30,Math.ceil(Math.log(1+c.rangePct/200)/Math.log(1+pool.lbPair.binStep/10000))));
  const state=await livePool(c.baseMint),price=Number(pool.fromPricePerLamport(Number(active.price)));if(Math.abs(price/state.priceQuote-1)>.02)throw new HttpError(409,"Companion price differs from the primary pool; liquidity addition paused.");
  const op=await stageOperation(job,"add",async()=>{const position=Keypair.generate();return {tx:await pool.initializePositionAndAddLiquidityByStrategy({positionPubKey:position.publicKey,totalXAmount:new BN(job.input_amount),totalYAmount:new BN(c.amountY),strategy:{minBinId:active.binId-half,maxBinId:active.binId+half,strategyType:StrategyType.Curve},user:signer.publicKey,slippage:.5}),signers:[signer,position],context:{...c,position:position.publicKey.toBase58(),amountX:job.input_amount,amountY:c.amountY,job:job.id}};});
  if(op.status!=="finalized"||!op.result_json)return;const actual=JSON.parse(op.context_json),receipt=JSON.parse(op.result_json) as VersionedTransactionResponse;
  const usedX=-tokenDelta(receipt,signer.publicKey.toBase58(),c.baseMint);let usedY=-tokenDelta(receipt,signer.publicKey.toBase58(),c.quoteMint);
  if(c.quoteMint===SOL_MINT){usedY=0n;for(const e of chainEvents(receipt))if(e.name==='addLiquidity'&&e.data.lbPair.toString()===c.pool&&e.data.position.toString()===actual.position)usedY+=BigInt(e.data.amounts[1].toString());}
  const requestedX=BigInt(job.input_amount),requestedY=BigInt(c.amountY),earnedX=BigInt(c.earnedX),earnedY=BigInt(c.earnedY);
  if(usedX<0n||usedY<0n||usedX>requestedX||usedY>requestedY||(usedX===0n&&usedY===0n))throw new Error("Liquidity receipt violates the reserved deposit amounts.");
  const feeX=usedX<earnedX?usedX:earnedX,feeY=usedY<earnedY?usedY:earnedY;
  const refunds=[[c.baseMint,'compound',earnedX-feeX],[c.baseMint,'recycle',requestedX-earnedX-(usedX-feeX)],[c.quoteMint,'compound',earnedY-feeY],[c.quoteMint,'recycle',requestedY-earnedY-(usedY-feeY)]] as [string,'compound'|'recycle',bigint][];
  await database().batch([
   database().prepare("INSERT OR IGNORE INTO agent_positions(address,agent_id,pool,kind,created_at) VALUES(?,?,?,'dlmm',?)").bind(actual.position,job.agent_id,c.pool,Date.now()),
   database().prepare("UPDATE execution_jobs SET status='complete',context_json=?,updated_at=? WHERE id=?").bind(JSON.stringify({...c,valueUsd:Number(feeX)/1e9*c.priceX+Number(feeY)/10**c.quoteDecimals*c.priceY}),Date.now(),job.id),
   database().prepare("UPDATE agent_custody SET last_action_at=? WHERE agent_id=?").bind(Date.now(),job.agent_id),
   ...refunds.map(([mint,bucket,amount],i)=>database().prepare("INSERT OR IGNORE INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${job.id}:refund:${i}`,job.agent_id,mint,bucket,amount.toString(),op.id,Date.now()))]);
  const owner=await database().prepare("SELECT owner FROM agents WHERE id=?").bind(job.agent_id).first<{owner:string}>();await event(owner!.owner,job.agent_id,"compound_confirmed","Earned fees added to an agent-owned DLMM range.",{signature:op.signature,position:actual.position});
 }else if(job.kind==="dlmm_remove"){
  const position=await pool.getPosition(pubkey(c.position));if(!position.positionData.owner.equals(signer.publicKey)||!(position.positionData.feeOwner.equals(signer.publicKey)||position.positionData.feeOwner.equals(PublicKey.default)))throw new Error("Position is not controlled by this agent.");
  const op=await stageOperation(job,"remove",async()=>{const txs=await pool.removeLiquidity({user:signer.publicKey,position:pubkey(c.position),fromBinId:position.positionData.lowerBinId,toBinId:position.positionData.upperBinId,bps:new BN(c.bps),shouldClaimAndClose:false});if(txs.length!==1)throw new Error("Rebalance removal exceeds one atomic transaction.");return {tx:txs[0],signers:[signer],context:c};});
  if(op.status!=="finalized"||!op.result_json)return;let x=0n,y=0n;for(const e of chainEvents(JSON.parse(op.result_json) as VersionedTransactionResponse)){if(e.name==="removeLiquidity"&&e.data.lbPair.toString()===c.pool&&e.data.position.toString()===c.position){x+=BigInt(e.data.amounts[0].toString());y+=BigInt(e.data.amounts[1].toString());}}
  const receipt=JSON.parse(op.result_json) as VersionedTransactionResponse,receivedX=tokenDelta(receipt,signer.publicKey.toBase58(),c.baseMint);x=receivedX<x?receivedX:x;if(c.quoteMint!==SOL_MINT){const receivedY=tokenDelta(receipt,signer.publicKey.toBase58(),c.quoteMint);y=receivedY<y?receivedY:y;}
  if(x<0n||y<0n||(x===0n&&y===0n))throw new Error("Liquidity withdrawal has no verified positive amount.");await creditEntry(`${job.id}:x`,job.agent_id,c.baseMint,"recycle",x,op.id);await creditEntry(`${job.id}:y`,job.agent_id,c.quoteMint,"recycle",y,op.id);await database().prepare("UPDATE execution_jobs SET status='complete',updated_at=? WHERE id=?").bind(Date.now(),job.id).run();await database().prepare("UPDATE agent_custody SET last_action_at=? WHERE agent_id=?").bind(Date.now(),job.agent_id).run();
 }
}
export async function manageLiquidity(mint:string,proposal:Proposal){
 const state=await livePool(mint),agent=state.launch.agent_id,db=database();if(!state.graduated)return {status:"observing",reason:"The native bonding curve controls launch liquidity until graduation."};
 const pending=await db.prepare("SELECT id FROM execution_jobs WHERE agent_id=? AND kind IN ('dlmm_add','dlmm_remove','compound_swap') AND status NOT IN ('complete','cancelled') LIMIT 1").bind(agent).first();if(pending)return {status:"executing",reason:"A prior liquidity operation is being reconciled."};
 const earnedX=await assetBalance(agent,mint,"compound"),earnedY=await assetBalance(agent,state.launch.quote_mint,"compound"),recycledX=await assetBalance(agent,mint,"recycle"),recycledY=await assetBalance(agent,state.launch.quote_mint,"recycle"),baseBalance=earnedX+recycledX,quoteBalance=earnedY+recycledY,quotePrice=await assetPrice(state.launch.quote_mint),value=(Number(baseBalance)/1e9*state.priceQuote+Number(quoteBalance)/10**state.launch.quote_decimals)*quotePrice.usdPrice;
 if(value<10&&!state.launch.dlmm_pool)return {status:"observing",reason:"Accumulating earned fees for initial DLMM liquidity."};
 const address=state.launch.dlmm_pool||await ensureCompanion(mint);if(!address)return {status:"executing",reason:"Creating the companion DLMM pool."};
 const {pool,signer}=await ownedPool(agent,address,mint,state.launch.quote_mint),positions=(await pool.getPositionsByUserAndLbPair(signer.publicKey)).userPositions;
 if(value>=10){
  // Keep both assets near equal value; only the allocated compounding bucket funds the conversion.
  const baseValue=Number(baseBalance)/1e9*state.priceQuote*quotePrice.usdPrice;
  if(baseValue<value*.2&&quoteBalance>0n){const bucket=earnedY>0n?"compound":"recycle",available=earnedY>0n?earnedY:recycledY,amount=quoteBalance/2n<available?quoteBalance/2n:available;await reserveJob(agent,"compound_swap",state.launch.quote_mint,amount,bucket,mint,{bucket});return {status:"executing",reason:"Converting half the allocated quote fees for a balanced LP deposit."};}
  if(baseValue>value*.8&&baseBalance>0n){const bucket=earnedX>0n?"compound":"recycle",available=earnedX>0n?earnedX:recycledX,amount=baseBalance/2n<available?baseBalance/2n:available;await reserveJob(agent,"compound_swap",mint,amount,bucket,state.launch.quote_mint,{bucket});return {status:"executing",reason:"Balancing earned base-token fees before compounding."};}
  const id=crypto.randomUUID(),now=Date.now();await db.batch([
   db.prepare("INSERT INTO execution_jobs(id,agent_id,kind,status,input_mint,input_amount,context_json,created_at,updated_at) VALUES(?,?,'dlmm_add','reserved',?,?,?,?,?)").bind(id,agent,mint,baseBalance.toString(),JSON.stringify({pool:address,baseMint:mint,quoteMint:state.launch.quote_mint,amountY:quoteBalance.toString(),earnedX:earnedX.toString(),earnedY:earnedY.toString(),priceX:state.priceQuote*quotePrice.usdPrice,priceY:quotePrice.usdPrice,quoteDecimals:state.launch.quote_decimals,rangePct:proposal.rangePct,valueUsd:(Number(earnedX)/1e9*state.priceQuote+Number(earnedY)/10**state.launch.quote_decimals)*quotePrice.usdPrice}),now,now),
   db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,'compound',?,?,?)").bind(`${id}:x`,agent,mint,(-earnedX).toString(),id,now),
   db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,'compound',?,?,?)").bind(`${id}:y`,agent,state.launch.quote_mint,(-earnedY).toString(),id,now),
   db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,'recycle',?,?,?)").bind(id+":recycled-x",agent,mint,(-recycledX).toString(),id,now),
   db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,'recycle',?,?,?)").bind(id+":recycled-y",agent,state.launch.quote_mint,(-recycledY).toString(),id,now)]);return {status:"executing",reason:"Compounding verified earned fees into the selected range."};
 }
 if(proposal.action!=="hold"&&positions.length){const active=await pool.getActiveBin(),half=Math.max(1,Math.min(30,Math.ceil(Math.log(1+proposal.rangePct/200)/Math.log(1+pool.lbPair.binStep/10000)))),candidate=positions.find(p=>Math.abs((p.positionData.lowerBinId+p.positionData.upperBinId)/2-active.binId)>2||Math.abs(p.positionData.upperBinId-p.positionData.lowerBinId-half*2)>2);if(candidate){
  const bps=Math.min(1500,Math.floor(proposal.rebalancePct*100));if(bps<=0)return {status:"observing",reason:"No liquidity movement requested."};const id=crypto.randomUUID(),now=Date.now();await db.prepare("INSERT INTO execution_jobs(id,agent_id,kind,status,input_mint,input_amount,context_json,created_at,updated_at) VALUES(?,?,'dlmm_remove','reserved',?,'0',?,?,?)").bind(id,agent,mint,JSON.stringify({pool:address,baseMint:mint,quoteMint:state.launch.quote_mint,position:candidate.publicKey.toBase58(),bps,rangePct:proposal.rangePct}),now,now).run();return {status:"executing",reason:"Repositioning at most 15% of one agent-owned position."};
 }}return {status:"observing",reason:"The active range remains within the model's limits."};
}
export async function claimCompanionFees(mint:string){
 const state=await livePool(mint);if(!state.launch.dlmm_pool)return;const {pool,signer}=await ownedPool(state.launch.agent_id,state.launch.dlmm_pool,mint,state.launch.quote_mint),positions=(await pool.getPositionsByUserAndLbPair(signer.publicKey)).userPositions;
 for(const position of positions){if(position.positionData.feeX.isZero()&&position.positionData.feeY.isZero())continue;const pending=await database().prepare("SELECT id FROM chain_operations WHERE agent_id=? AND purpose='claim' AND status IN ('prepared','submitted') LIMIT 1").bind(state.launch.agent_id).first();if(pending)return;
  const op=await signOperation(crypto.randomUUID(),"claim",state.launch.agent_id,async()=>{const txs=await pool.claimSwapFee({owner:signer.publicKey,position});if(txs.length!==1)throw new Error("Claim requires multiple transactions.");return {tx:txs[0],signers:[signer],context:{pool:state.launch.dlmm_pool,baseMint:mint,quoteMint:state.launch.quote_mint,quoteDecimals:state.launch.quote_decimals,wallet:signer.publicKey.toBase58(),position:position.publicKey.toBase58()}};});await ingestClaim(op);break;
 }
}
