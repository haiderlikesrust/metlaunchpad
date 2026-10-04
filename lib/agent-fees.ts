import {CpAmm,getUnClaimLpFee} from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import {config,database,pubkey,rpc} from './server';
import {livePool,mintInfo} from './pool-state';
import {assetPrice} from './asset-price';
import {SOL_MINT} from './launch-economics';
import {liveCache} from './live-cache';
import {activationProgress,type AgentFees,type FeeAmount} from './fee-types';
import type {ExecutionJob} from './asset-ledger';
const add=(map:Map<string,bigint>,mint:string,value:bigint)=>map.set(mint,(map.get(mint)||0n)+value);
async function readFees(mint:string):Promise<AgentFees>{
 const state=await livePool(mint),db=database(),agent=state.launch.agent_id,quote=state.launch.quote_mint;
 const [claims,entries,jobs,activation,schedule,last,identity]=await Promise.all([
  db.prepare('SELECT mint,amount FROM asset_claims WHERE agent_id=?').bind(agent).all<{mint:string;amount:string}>(),
  db.prepare("SELECT mint,amount FROM asset_entries WHERE agent_id=? AND bucket NOT IN ('burn','recycle')").bind(agent).all<{mint:string;amount:string}>(),
  db.prepare("SELECT * FROM execution_jobs WHERE agent_id=? AND status!='complete'").bind(agent).all<ExecutionJob>(),
  db.prepare('SELECT COALESCE(SUM(usd_micros),0) amount FROM fee_receipts WHERE agent_id=?').bind(agent).first<{amount:number}>(),
  db.prepare('SELECT * FROM fee_collection_state WHERE agent_id=?').bind(agent).first<{last_checked_at:number|null;next_check_at:number;status:string;last_error:string|null}>(),
  db.prepare("SELECT signature,created_at,status FROM chain_operations WHERE agent_id=? AND purpose='claim' ORDER BY created_at DESC LIMIT 1").bind(agent).first<{signature:string|null;created_at:number;status:string}>(),
  db.prepare('SELECT symbol FROM launches WHERE mint=?').bind(mint).first<{symbol:string}>()
 ]);
 const held=new Map<string,bigint>(),claimed=new Map<string,bigint>(),pending=new Map<string,bigint>();
 for(const row of entries.results)add(held,row.mint,BigInt(row.amount));for(const row of claims.results)add(claimed,row.mint,BigInt(row.amount));
 for(const job of jobs.results){const c=JSON.parse(job.context_json);if(job.kind==='dlmm_remove'||c.bucket==='recycle')continue;
  if(job.kind==='dlmm_add'){add(held,job.input_mint,BigInt(c.earnedX||0));add(held,c.quoteMint,BigInt(c.earnedY||0));}
  else if(job.status==='reserved')add(held,job.input_mint,BigInt(job.input_amount));else if(job.output_mint)add(held,job.output_mint,BigInt(job.output_amount||0));
 }
 let complete=true;
 add(pending,mint,BigInt(state.pool.poolState.partnerBaseFee.toString()));add(pending,quote,BigInt(state.pool.poolState.partnerQuoteFee.toString()));
 try{
  if(state.graduated&&state.dammState){const sdk=new CpAmm(rpc()),positions=await sdk.getUserPositionByPool(pubkey(state.graduated),pubkey(state.launch.agent_wallet));for(const p of positions){const fee=getUnClaimLpFee(state.dammState,p.positionState);add(pending,mint,BigInt(fee.feeTokenA.toString()));add(pending,quote,BigInt(fee.feeTokenB.toString()));}}
  if(state.launch.dlmm_pool){const pool=await DLMM.create(rpc(),pubkey(state.launch.dlmm_pool)),positions=await pool.getPositionsByUserAndLbPair(pubkey(state.launch.agent_wallet));for(const p of positions.userPositions){add(pending,mint,BigInt(p.positionData.feeX.toString()));add(pending,quote,BigInt(p.positionData.feeY.toString()));}}
 }catch{complete=false;}
 const total=new Map(claimed);for(const [asset,amount] of pending)add(total,asset,amount);
 const valuations=new Map<string,{price:number|null;decimals:number;symbol:string}>();let quoteUsd:number|null=null;try{quoteUsd=(await assetPrice(quote)).usdPrice;}catch{}
 valuations.set(quote,{price:quoteUsd,decimals:state.launch.quote_decimals,symbol:quote===SOL_MINT?'SOL':'Quote'});valuations.set(mint,{price:quoteUsd===null?null:quoteUsd*state.priceQuote,decimals:9,symbol:identity?.symbol||'Token'});
 for(const asset of new Set([...held.keys(),...total.keys()]))if(!valuations.has(asset)){try{const info=await mintInfo(asset);let price:number|null=null;try{price=(await assetPrice(asset)).usdPrice;}catch{}valuations.set(asset,{price,decimals:info.mint.decimals,symbol:asset===SOL_MINT?'SOL':asset===config('THICC_TOKEN_MINT')?'THICC':asset.slice(0,5)});}catch{valuations.set(asset,{price:null,decimals:0,symbol:asset.slice(0,5)});}}
 function amount(map:Map<string,bigint>,valid=true):FeeAmount{let usd:number|null=valid?0:null;const tokens:FeeAmount['tokens']=[];for(const [asset,n] of map){if(n<=0n)continue;const value=valuations.get(asset)!;tokens.push({mint:asset,symbol:value.symbol,amount:(Number(n)/10**value.decimals).toLocaleString('en-US',{maximumFractionDigits:9,useGrouping:false})});if(usd!==null)usd=value.price===null?null:usd+Number(n)/10**value.decimals*value.price;}return {usd,tokens};}
 const settling=await db.prepare("SELECT id FROM chain_operations WHERE agent_id=? AND purpose!='claim' AND status IN ('prepared','submitted') LIMIT 1").bind(agent).first();
 return {held:amount(held,!settling),pending:amount(pending,complete),claimed:amount(claimed),total:amount(total,complete),activation:activationProgress((activation?.amount||0)/1e6),collection:{intervalSeconds:30,status:config('EXECUTION_PAUSED')==='true'?'paused':last&&['prepared','submitted'].includes(last.status)?'confirming':schedule?.status||'waiting',lastCheckedAt:schedule?.last_checked_at??null,nextCheckAt:schedule?.next_check_at||null,lastClaimAt:last?.status==='finalized'?last.created_at:null,signature:last?.signature||null,message:schedule?.last_error||null},observedAt:Date.now()};
}
const cached=liveCache<AgentFees>(2000);
export function agentFees(mint:string){return cached(mint,()=>readFees(mint));}
