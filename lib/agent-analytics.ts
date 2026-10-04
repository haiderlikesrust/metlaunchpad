import {z} from "zod";
import {database,HttpError} from "./server";
import type {AgentAnalytics,AnalyticsCoin,AnalyticsWindow} from "./agent-analytics-types";
const metric=z.number().finite().nonnegative().nullable();
const actualSchema=z.object({liquidityUsd:metric,feesUsd:metric,gasUsd:metric,computeUsd:metric,compoundedUsd:metric,slippageBps:metric,rebalances:z.number().int().nonnegative().nullable(),feeBps:metric}).strict();
const baselineSchema=z.object({feesUsd:z.number().finite().nonnegative(),gasUsd:z.number().finite().nonnegative(),slippageBps:metric,method:z.literal("native-position-observed-flow-v1"),replayComplete:z.boolean()}).strict();
type Row={mint:string;name:string;symbol:string;pool_address:string;agent_id:string|null;model:string|null;state:string|null;as_of:number|null;period_start:number|null;period_end:number|null;actual_json:string|null;baseline_json:string|null;action_kind:string|null;action_at:number|null};
export async function agentAnalytics(window:string):Promise<AgentAnalytics>{
 if(!["24h","7d","30d"].includes(window))throw new HttpError(400,"Choose 24h, 7d, or 30d.");
 const results=await database().prepare(`SELECT l.mint,l.name,l.symbol,l.pool_address,a.id AS agent_id,a.model,
 t.state,t.as_of,t.period_start,t.period_end,t.actual_json,t.baseline_json,
 (SELECT kind FROM events e WHERE e.agent_id=a.id AND kind IN ('observing','decision','blocked','awaiting_fees','rebalance_confirmed','compound_confirmed','fee_update_confirmed') ORDER BY created_at DESC LIMIT 1) AS action_kind,
 (SELECT created_at FROM events e WHERE e.agent_id=a.id AND kind IN ('observing','decision','blocked','awaiting_fees','rebalance_confirmed','compound_confirmed','fee_update_confirmed') ORDER BY created_at DESC LIMIT 1) AS action_at
 FROM launches l LEFT JOIN agents a ON a.pool_address=l.pool_address AND a.id=(SELECT id FROM agents WHERE pool_address=l.pool_address ORDER BY rowid LIMIT 1)
 LEFT JOIN agent_analytics t ON t.agent_id=a.id AND t.window=? AND t.as_of=(SELECT MAX(as_of) FROM agent_analytics WHERE agent_id=a.id AND window=? AND verified_at IS NOT NULL)
 WHERE l.verified_at IS NOT NULL AND l.pool_address IS NOT NULL ORDER BY l.created_at DESC`).bind(window,window).all<Row>();
 const now=Date.now(),duration=window==="24h"?86400000:window==="7d"?604800000:2592000000;
 const coins:AnalyticsCoin[]=results.results.map(r=>{
  let actual=null,baseline=null;
  const validPeriod=r.period_start!=null&&r.period_end!=null&&r.as_of!=null&&r.period_end>r.period_start&&r.period_end-r.period_start<=duration&&r.period_end<=r.as_of&&r.as_of<=now+5000;
  if(validPeriod&&r.actual_json){try{actual=actualSchema.parse(JSON.parse(r.actual_json));}catch{/* Invalid telemetry is never displayed as performance. */}}
  if(actual&&r.baseline_json){try{baseline=baselineSchema.parse(JSON.parse(r.baseline_json));}catch{/* Incomplete baseline remains unavailable. */}}
  return {mint:r.mint,name:r.name,symbol:r.symbol,poolAddress:r.pool_address,agentId:r.agent_id,model:r.model,state:!actual?"awaiting_data":now-(r.as_of||0)>300000?"stale":["active","awaiting_fees","observing","blocked"].includes(r.state||"")?r.state!:"observing",asOf:actual?r.as_of:null,periodStart:actual?r.period_start:null,periodEnd:actual?r.period_end:null,actual,baseline,lastAction:r.action_kind&&r.action_at?{kind:r.action_kind,at:r.action_at}:null};
 });
 return {window:window as AnalyticsWindow,fetchedAt:now,coins,totalCoins:coins.length};
}
