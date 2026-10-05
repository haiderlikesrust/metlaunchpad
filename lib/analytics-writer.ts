import {database} from "./server";
import {historicalPrice} from "./asset-price";
import {SOL_MINT} from "./launch-economics";
import {livePool} from "./pool-state";
import {nativeLaunchFeeBps} from "./launch-fee";
export async function writeAnalytics(agent:string){
 const db=database(),now=Date.now(),c=await db.prepare("SELECT a.*,c.base_mint,c.graduated_pool,c.dlmm_pool,l.created_at FROM agents a JOIN agent_custody c ON c.agent_id=a.id JOIN launches l ON l.mint=c.base_mint WHERE a.id=?").bind(agent).first<{base_mint:string;pool_address:string;graduated_pool:string|null;dlmm_pool:string|null;created_at:number}>();if(!c)return;
 const market=await db.prepare("SELECT liquidity_usd,observed_at FROM pool_observations WHERE pool=? ORDER BY observed_at DESC LIMIT 1").bind(c.graduated_pool||c.pool_address).first<{liquidity_usd:number;observed_at:number}>();if(!market)return;
 const companion=c.dlmm_pool?await db.prepare("SELECT liquidity_usd,observed_at FROM pool_observations WHERE pool=? ORDER BY observed_at DESC LIMIT 1").bind(c.dlmm_pool).first<{liquidity_usd:number;observed_at:number}>():null;
 const liquidity=c.dlmm_pool&&(!companion||now-companion.observed_at>120000)?null:market.liquidity_usd+(companion?.liquidity_usd||0);
 let feeBps:number|null=null;try{feeBps=nativeLaunchFeeBps((await livePool(c.base_mint)).curve);}catch{/* Unknown fees are not replaced with new-launch defaults. */}
 for(const window of ["24h","7d","30d"]){const start=Math.max(c.created_at,now-(window==="24h"?86400000:window==="7d"?604800000:2592000000));if(now<=start)continue;
  const claims=await db.prepare("SELECT c.usd_micros,c.signature,o.context_json FROM asset_claims c JOIN chain_operations o ON o.signature=c.signature WHERE c.agent_id=? AND c.created_at>=?").bind(agent,start).all<{usd_micros:number|null;signature:string;context_json:string}>();
  const completeClaims=claims.results.every(r=>r.usd_micros!==null),fees=completeClaims?claims.results.reduce((s,r)=>s+r.usd_micros!/1e6,0):null;
  const baseFees=completeClaims?claims.results.filter(r=>JSON.parse(r.context_json).pool!==c.dlmm_pool).reduce((s,r)=>s+r.usd_micros!/1e6,0):null;
  const operations=await db.prepare("SELECT purpose,result_json,context_json FROM chain_operations WHERE agent_id=? AND status IN ('finalized','failed') AND created_at>=?").bind(agent,start).all<{purpose:string;result_json:string;context_json:string}>();let gas:number|null=0,baselineGas:number|null=0;
  for(const op of operations.results){const tx=JSON.parse(op.result_json),price=await historicalPrice(SOL_MINT,(tx.blockTime||0)*1000);if(price===null){gas=null;baselineGas=null;break;}const usd=(tx.meta?.fee||0)/1e9*price;gas+=usd;if(op.purpose==="claim"&&JSON.parse(op.context_json).pool!==c.dlmm_pool)baselineGas+=usd;}
  const calls=await db.prepare("SELECT cost_usd FROM model_calls WHERE agent_id=? AND created_at>=?").bind(agent,start).all<{cost_usd:number|null}>(),compute=calls.results.every(c=>c.cost_usd!==null)?calls.results.reduce((s,c)=>s+c.cost_usd!,0):null;
  const additions=await db.prepare("SELECT context_json FROM execution_jobs WHERE agent_id=? AND kind='dlmm_add' AND status='complete' AND updated_at>=?").bind(agent,start).all<{context_json:string}>();
  const removals=await db.prepare("SELECT COUNT(*) n FROM execution_jobs WHERE agent_id=? AND kind='dlmm_remove' AND status='complete' AND updated_at>=?").bind(agent,start).first<{n:number}>();
  const total=await db.prepare("SELECT COALESCE(SUM(usd_micros),0) n FROM fee_receipts WHERE agent_id=?").bind(agent).first<{n:number}>();
  const actual={liquidityUsd:liquidity,feesUsd:fees,gasUsd:gas,computeUsd:compute,compoundedUsd:additions.results.reduce((s,a)=>s+(JSON.parse(a.context_json).valueUsd||0),0),slippageBps:null,rebalances:removals?.n||0,feeBps};
  const baseline=baseFees!==null&&baselineGas!==null?{feesUsd:baseFees,gasUsd:baselineGas,slippageBps:null,method:"native-position-observed-flow-v1",replayComplete:true}:null;
  await db.prepare("INSERT INTO agent_analytics(id,agent_id,window,state,as_of,period_start,period_end,actual_json,baseline_json,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),agent,window,(total?.n||0)>=20_000_000?"active":"awaiting_fees",market.observed_at,start,Math.min(now,market.observed_at),JSON.stringify(actual),baseline?JSON.stringify(baseline):null,now).run();
 }
}
