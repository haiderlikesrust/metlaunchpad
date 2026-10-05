import {config,database,HttpError,pubkey} from './server';
import {agentBudget} from './agent-budget';
import type {AgentConsoleData,ConsoleEvent} from './agent-console-types';
import {liveCache} from './live-cache';

/** Public operational receipts only: never return owner records, signed wires,
 * raw model payloads, secret configuration or the platform's credit balance. */
async function readConsole(mint:string):Promise<AgentConsoleData>{
 pubkey(mint);const db=database(),now=Date.now();
 const agent=await db.prepare(`SELECT a.id,a.model,a.status,a.last_run,a.last_tick,a.lease_until,a.pool_address,c.graduated_pool
 FROM launches l JOIN agent_custody c ON c.base_mint=l.mint JOIN agents a ON a.id=c.agent_id
 WHERE l.mint=? AND l.verified_at IS NOT NULL AND l.pool_address=a.pool_address LIMIT 1`).bind(mint).first<{id:string;model:string;status:string;last_run:number|null;last_tick:number|null;lease_until:number;pool_address:string;graduated_pool:string|null}>();
 if(!agent)throw new HttpError(404,'No verified THICC agent is registered for this coin.');
 const pool=agent.graduated_pool||agent.pool_address;
 const [budget,activation,observations,trades,cursor,logs,jobs,operations,monitor,deposits]=await Promise.all([
  agentBudget(agent.id,now),
  db.prepare('SELECT COALESCE(SUM(usd_micros),0) total FROM fee_receipts WHERE agent_id=?').bind(agent.id).first<{total:number}>(),
  db.prepare('SELECT observed_at,liquidity_usd FROM pool_observations WHERE pool=? AND observed_at>? ORDER BY observed_at DESC LIMIT 60').bind(pool,now-3600000).all<{observed_at:number;liquidity_usd:number}>(),
  db.prepare('SELECT COUNT(*) count FROM token_trades WHERE mint=? AND at>? AND at<=?').bind(mint,now-3600000,now).first<{count:number}>(),
  db.prepare('SELECT last_indexed_at FROM pool_cursors WHERE pool=?').bind(pool).first<{last_indexed_at:number|null}>(),
  db.prepare("SELECT id,kind,message,created_at FROM events WHERE agent_id=? AND kind IN ('awaiting_fees','awaiting_funding','compute_allocated','observing','model_requested','proposal','decision','blocked','error','execution_waiting','worker_waiting','compound_confirmed','rebalance_confirmed','test_fee_recovery') ORDER BY created_at DESC,rowid DESC LIMIT 40").bind(agent.id).all<{id:string;kind:string;message:string;created_at:number}>(),
  db.prepare("SELECT id,kind,status,last_error FROM execution_jobs WHERE agent_id=? AND status NOT IN ('complete','cancelled') ORDER BY created_at LIMIT 10").bind(agent.id).all<{id:string;kind:string;status:string;last_error:string|null}>(),
  db.prepare(`SELECT o.id,o.purpose,o.status,o.signature,o.updated_at,j.kind FROM chain_operations o LEFT JOIN execution_jobs j ON j.agent_id=o.agent_id AND substr(o.purpose,1,length(j.id)+1)=j.id||':' WHERE o.agent_id=? ORDER BY o.updated_at DESC LIMIT 30`).bind(agent.id).all<{id:string;purpose:string;status:string;signature:string|null;updated_at:number;kind:string|null}>(),
  db.prepare("SELECT last_plan FROM funding_monitor WHERE id='openrouter'").first<{last_plan:string|null}>(),
  db.prepare("SELECT status,updated_at FROM execution_jobs WHERE agent_id=? AND kind='compute'").bind(agent.id).all<{status:string;updated_at:number}>()
 ]);
 const events:ConsoleEvent[]=logs.results.map(r=>({id:r.id,at:r.created_at,kind:r.kind,message:r.message}));
 const names:Record<string,string>={compute:'OpenRouter funding',buyback:'THICC buyback / burn',gas:'Gas reserve',compound_swap:'Liquidity token swap',dlmm_add:'Add liquidity',dlmm_remove:'Reposition liquidity'};
 for(const op of operations.results){const label=op.purpose==='claim'?'Fee collection':names[op.kind||'']||'Agent transaction';events.push({id:`tx:${op.id}`,at:op.updated_at,kind:op.status==='finalized'?'transaction_confirmed':'transaction',message:`${label} · ${op.status}`,signature:op.signature});}
 events.sort((a,b)=>b.at-a.at);
 let plan:{action?:string;reason?:string;checkedAt?:number;targetHours?:number;bootstrap?:boolean}={};try{plan=JSON.parse(monitor?.last_plan||'{}');}catch{}
 const fundingOps=operations.results.filter(o=>o.kind==='compute'&&o.purpose.endsWith(':deposit')&&o.status==='finalized');
 return {observedAt:now,model:agent.model,activated:(activation?.total||0)>=20_000_000,paused:config('EXECUTION_PAUSED')==='true'||agent.status!=='active',phase:agent.graduated_pool?'graduated':'bonding',lastWorkerAt:agent.last_tick,lastDecisionAt:agent.last_run,running:agent.lease_until>now,
  budget:{mode:budget.mode,earnedUsd:budget.earnedUsd,spentUsd:budget.spentUsd,committedUsd:budget.committedUsd,remainingUsd:budget.remainingUsd,callCount:budget.callCount},
  market:{lastObservedAt:observations.results[0]?.observed_at??null,lastIndexedAt:cursor?.last_indexed_at??null,observations:observations.results.length,trades:trades?.count||0,depthUsd:observations.results[0]?.liquidity_usd??null},
  jobs:jobs.results.map(j=>({id:j.id,kind:j.kind,status:j.status,message:j.last_error})),
  funding:{checkedAt:typeof plan.checkedAt==='number'?plan.checkedAt:null,message:plan.action==='top_up'?(plan.bootstrap?'Preparing initial earned-fee funding for SolCard. AI requests can start once the deposit confirms on-chain.':`Funding SolCard toward ${plan.targetHours||24} hours of measured AI usage.`):typeof plan.reason==='string'?plan.reason:'Waiting for the credit monitor to report its funding decision.',deposits:deposits.results.filter(d=>d.status==='complete').length,pendingDeposits:deposits.results.filter(d=>d.status!=='complete'&&d.status!=='cancelled').length,lastDepositAt:Math.max(0,...deposits.results.filter(d=>d.status==='complete').map(d=>d.updated_at))||null,signature:fundingOps[0]?.signature||null},events:events.slice(0,60)};
}
const cached=liveCache<AgentConsoleData>(1500);
export function agentConsole(mint:string){return cached(mint,()=>readConsole(mint));}
