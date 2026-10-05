import {database} from './server';
import {decisionCadence} from './agent-cadence';
export async function agentBudget(agent:string,now=Date.now()){
 const db=database();
 const [earned,calls,grants]=await Promise.all([
  db.prepare('SELECT COALESCE(SUM(compute_micros),0) total,COALESCE(SUM(CASE WHEN verified_at>? THEN compute_micros ELSE 0 END),0) hourly FROM fee_receipts WHERE agent_id=?').bind(now-3600000,agent).first<{total:number;hourly:number}>(),
  db.prepare('SELECT COUNT(*) count,COALESCE(SUM(cost_usd),0) spent,COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) committed,COALESCE(AVG(CASE WHEN created_at>? THEN COALESCE(cost_usd,reserved_usd) END),0.01) average FROM model_calls WHERE agent_id=?').bind(now-3600000,agent).first<{count:number;spent:number;committed:number;average:number}>(),
  db.prepare('SELECT COALESCE(SUM(usd_micros),0) total,COALESCE(SUM(CASE WHEN created_at>? THEN usd_micros ELSE 0 END),0) hourly FROM compute_budget_grants WHERE agent_id=?').bind(now-3600000,agent).first<{total:number;hourly:number}>()
 ]);
 const earnedUsd=((earned?.total||0)+(grants?.total||0))/1e6,committedUsd=calls?.committed||0;
 return {...decisionCadence(earnedUsd,committedUsd,calls?.average||.01,((earned?.hourly||0)+(grants?.hourly||0))/1e6),earnedUsd,spentUsd:calls?.spent||0,committedUsd,callCount:calls?.count||0};
}
