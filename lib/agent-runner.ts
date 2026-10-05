import {withLock} from "./runtime-lock";
import {nativeAgentState} from "./native-agent";
import {database,event,HttpError} from "./server";
import {askModel} from "./openrouter";
import {validateProposal,validatePolicy,type Policy,type Market} from "./engine";
import {manageLiquidity} from "./dlmm-executor";
import {agentBudget} from "./agent-budget";
export type AgentRow={id:string;owner:string;pool_address:string;pool_name:string;wallet:string;position_address:string;model:string;policy:string;status:string;last_run:number|null};
export async function runAgent(row:AgentRow){
 const now=Date.now(),db=database(),budget=await agentBudget(row.id,now);
 if(budget.mode==='paused')return {status:'budget_paused'};
 const lease=await db.prepare("UPDATE agents SET lease_until=? WHERE id=? AND status='active' AND lease_until<? AND (last_run IS NULL OR last_run<?)").bind(now+90000,row.id,now,now-budget.delayMs).run();if(!lease.meta.changes)return {status:'monitoring'};
 try{
  const policy=JSON.parse(row.policy) as Policy;if(validatePolicy(policy).length)throw new Error("Invalid policy");
  const custody=await db.prepare("SELECT base_mint,graduated_pool,last_action_at FROM agent_custody WHERE agent_id=?").bind(row.id).first<{base_mint:string;graduated_pool:string|null;last_action_at:number|null}>();if(!custody)throw new Error("No custody record");
  const rights=await nativeAgentState(row.id,row.pool_address,row.position_address);
  if(!rights.active){await event(row.owner,row.id,"awaiting_fees","Waiting for $20 in finalized, priced fee claims.");return {status:"awaiting_fees"};}
  policy.computePct=Math.min(70,budget.earnedUsd/(Number(rights.claimedUsdMicros)/1e6)*100);policy.compoundPct=70-policy.computePct;
  const funded=await db.prepare("SELECT id FROM execution_jobs WHERE agent_id=? AND kind='compute' AND status='complete' LIMIT 1").bind(row.id).first();
  if(!funded){await event(row.owner,row.id,"awaiting_funding","Monitoring the market while the first earned-fee deposit to SolCard is prepared or confirmed. Paid model calls start after on-chain deposit confirmation.");return {status:'awaiting_funding'};}
  const pool=custody.graduated_pool||row.pool_address;
  const observations=await db.prepare("SELECT * FROM pool_observations WHERE pool=? AND observed_at>? ORDER BY observed_at DESC LIMIT 60").bind(pool,now-3600000).all<{observed_at:number;price_quote:number;liquidity_usd:number}>();
  const trades=await db.prepare("SELECT side,volume_usd FROM token_trades WHERE mint=? AND at>? AND at<=?").bind(custody.base_mint,now-3600000,now).all<{side:string;volume_usd:number}>();
  const cursor=await db.prepare("SELECT last_indexed_at FROM pool_cursors WHERE pool=?").bind(pool).first<{last_indexed_at:number|null}>(),recent=observations.results[0];
  if(!recent||now-recent.observed_at>60000||!cursor?.last_indexed_at||now-cursor.last_indexed_at>60000||observations.results.length<4||trades.results.length<3){await event(row.owner,row.id,"observing",`Watching the market: ${observations.results.length}/4 minimum price observations and ${trades.results.length}/3 minimum verified trades in the last hour. ${!recent||now-recent.observed_at>60000||!cursor?.last_indexed_at||now-cursor.last_indexed_at>60000?'Waiting for fresh indexed market data.':'More trading history is needed before a paid decision.'}`);return {status:"observing"};}
  const volume=trades.results.reduce((s,t)=>s+t.volume_usd,0),buys=trades.results.reduce((s,t)=>s+(t.side==="buy"?t.volume_usd:0),0),returns=observations.results.slice(0,-1).map((r,i)=>(r.price_quote/observations.results[i+1].price_quote-1)*100);
  const market:Market={price:recent.price_quote,depthUsd:recent.liquidity_usd,ageSeconds:(now-recent.observed_at)/1000,buyShare:volume>0?buys/volume*100:NaN,volatility:Math.sqrt(returns.reduce((s,r)=>s+r*r,0)/returns.length),priceMovePct:returns[0]};
  await event(row.owner,row.id,"model_requested","Analyzing verified price, volatility, liquidity depth and buy/sell flow.");
  const proposal=await askModel(row.model,market,policy,row.id),errors=validateProposal(proposal,market,policy,(now-(custody.last_action_at||0))/1000);
  await event(row.owner,row.id,"proposal",proposal.reason,{action:proposal.action});
  if(errors.length){await event(row.owner,row.id,"blocked",errors.join(" "),{proposal,market});return {status:"blocked",errors};}
  if(proposal.action==="hold"){await event(row.owner,row.id,"decision",proposal.reason,{proposal,market});return {status:"hold"};}
  const action=await withLock(`agent:${row.id}`,async()=>{const pending=await db.prepare("SELECT id FROM chain_operations WHERE agent_id=? AND status IN ('prepared','submitted') LIMIT 1").bind(row.id).first();if(pending)return {status:"observing",reason:"Waiting for the pending wallet transaction to finalize."};return manageLiquidity(custody.base_mint,proposal);});await event(row.owner,row.id,"decision",action.reason,{proposal,market,action});return action;
 }catch(error){await event(row.owner,row.id,"error",error instanceof HttpError?error.message:"Agent cycle stopped; pending transactions will be reconciled before retrying.");throw error;}
 finally{await db.prepare("UPDATE agents SET last_run=?,lease_until=0 WHERE id=?").bind(Date.now(),row.id).run();}
}
