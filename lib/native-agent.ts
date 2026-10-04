import {PublicKey} from "@solana/web3.js";
import {database,HttpError,pubkey,rpc} from "./server";
const DBC_PROGRAM=new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
/** Uses existing Meteora programs. Custody restrictions are server-enforced, not a custom on-chain vault. */
export async function nativeAgentState(agentId:string,poolAddress:string,positionAddress:string){
 const custody=await database().prepare("SELECT wallet,base_mint,pool_kind,config_address FROM agent_custody WHERE agent_id=?").bind(agentId).first<{wallet:string;base_mint:string;pool_kind:string;config_address:string|null}>();
 if(!custody)throw new HttpError(409,"No dedicated agent wallet has been registered for this launch.");
 const wallet=pubkey(custody.wallet),connection=rpc();
 if(custody.pool_kind==="dbc"){
  const {DynamicBondingCurveClient}=await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const client=new DynamicBondingCurveClient(connection,"finalized"),account=await connection.getAccountInfo(pubkey(poolAddress),"finalized");
  if(!account?.owner.equals(DBC_PROGRAM))throw new HttpError(409,"Pool is not owned by the Meteora DBC program.");
  const pool=await client.state.getPool(poolAddress);
  if(!pool||!pool.poolState.baseMint.equals(pubkey(custody.base_mint))||pool.poolState.config.toBase58()!==custody.config_address)throw new HttpError(409,"Agent pool binding does not match the chain.");
  const accountConfig=await connection.getAccountInfo(pool.poolState.config,"finalized");
  if(!accountConfig?.owner.equals(DBC_PROGRAM))throw new HttpError(409,"Invalid Meteora configuration owner.");
  const c=await client.state.getPoolConfig(pool.poolState.config);
  if(!c||!c.feeClaimer.equals(wallet)||c.creatorTradingFeePercentage!==0||c.creatorLiquidityPercentage!==0||c.creatorPermanentLockedLiquidityPercentage!==0)throw new HttpError(409,"Pool fee rights are not assigned exclusively to the agent wallet.");
 }else if(custody.pool_kind==="dlmm"){
  const {default:DLMM}=await import("@meteora-ag/dlmm");const pool=await DLMM.create(connection,pubkey(poolAddress));const position=await pool.getPosition(pubkey(positionAddress));
  if(!pool.tokenX.publicKey.equals(pubkey(custody.base_mint))||!position.positionData.owner.equals(wallet)||!position.positionData.feeOwner.equals(wallet))throw new HttpError(409,"Liquidity and fee rights are not assigned to the dedicated agent wallet.");
 }else throw new HttpError(409,"This pool type does not have a verified agent adapter yet.");
 const receipts=await database().prepare("SELECT usd_micros FROM fee_receipts WHERE agent_id=? AND recipient=?").bind(agentId,custody.wallet).all<{usd_micros:number}>();
 let claimedUsdMicros=0n;for(const receipt of receipts.results){if(!Number.isSafeInteger(receipt.usd_micros)||receipt.usd_micros<0)throw new HttpError(409,"Invalid verified fee ledger.");claimedUsdMicros+=BigInt(receipt.usd_micros);}
 return {wallet,poolKind:custody.pool_kind,claimedUsdMicros,active:claimedUsdMicros>=20_000_000n};
}
