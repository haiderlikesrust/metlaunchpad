import {config,database,HttpError,pubkey} from "./server";
import {getCredits} from "./openrouter";
import {forecastCreditRunway} from "./funding-forecast";
import {planAdaptiveFunding,type CreditSample} from "./adaptive-funding";
export async function monitorComputeFunding(){
 const db=database(),now=Date.now();
 await db.prepare("INSERT OR IGNORE INTO funding_monitor(id) VALUES ('openrouter')").run();
 const lock=await db.prepare("UPDATE funding_monitor SET lease_until=? WHERE id='openrouter' AND lease_until<?").bind(now+60000,now).run();
 if(!lock.meta.changes)return {action:"hold",reason:"Credit monitor is already running."};
 try{
  const credits=await getCredits();const toMicros=(value:number)=>{const n=Math.round(value*1e6);if(!Number.isSafeInteger(n)||n<0)throw new HttpError(502,"Invalid credit balance.");return BigInt(n);};
  await db.prepare("INSERT OR IGNORE INTO credit_snapshots(observed_at,remaining_micros,used_micros) VALUES (?,?,?)").bind(now,toMicros(credits.remaining).toString(),toMicros(credits.used).toString()).run();
  const rows=await db.prepare("SELECT observed_at,remaining_micros,used_micros FROM credit_snapshots WHERE observed_at>=? ORDER BY observed_at").bind(now-3900000).all<{observed_at:number;remaining_micros:string;used_micros:string}>();
  const samples:CreditSample[]=rows.results.map(r=>({at:r.observed_at,remainingMicros:BigInt(r.remaining_micros),usedMicros:BigInt(r.used_micros)}));
  const pending=await db.prepare("SELECT id FROM funding WHERE status IN ('awaiting_executor','awaiting_fee_claim','submitted','confirmed') LIMIT 1").first();
  const earned=await db.prepare("SELECT COALESCE(SUM(compute_micros),0) AS amount FROM fee_receipts").first<{amount:number}>();
  const allocated=await db.prepare("SELECT COALESCE(SUM(amount_usd),0) AS amount FROM funding WHERE status NOT IN ('cancelled','failed')").first<{amount:number}>();
  if(!Number.isSafeInteger(earned?.amount||0))throw new HttpError(409,"Fee ledger exceeds safe accounting precision.");
  const available=BigInt(earned?.amount||0)-toMicros(allocated?.amount||0);
  const destination=config("SOLCARD_DEPOSIT_ADDRESS");let verified=false;try{pubkey(destination);verified=!!destination;}catch{/* Missing destination keeps funding paused. */}
  const saved=await db.prepare("SELECT target_hours,last_forecast_at FROM funding_monitor WHERE id='openrouter'").first<{target_hours:number;last_forecast_at:number|null}>();
  let targetHours=saved?.target_hours||24;
  let plan=planAdaptiveFunding({samples,now,availableEarnedComputeMicros:available,pending:!!pending,destinationVerified:verified,targetHours});
  if(plan.action==="top_up"&&(!saved?.last_forecast_at||now-saved.last_forecast_at>=3600000)){
   const agent=await db.prepare("SELECT a.id,a.model FROM agents a JOIN agent_custody c ON c.agent_id=a.id WHERE a.status='active' LIMIT 1").first<{id:string;model:string}>();
   if(agent){const forecast=await forecastCreditRunway(agent.model,agent.id,samples,now);targetHours=forecast.targetHours;await db.prepare("UPDATE funding_monitor SET target_hours=?,last_forecast_at=? WHERE id='openrouter'").bind(targetHours,now).run();plan=planAdaptiveFunding({samples,now,availableEarnedComputeMicros:available,pending:false,destinationVerified:verified,targetHours});}
  }
  if(plan.action==="top_up")await db.prepare("INSERT INTO funding(id,owner,address,amount_usd,status,created_at) SELECT ?,'platform',?,?,'awaiting_executor',? WHERE NOT EXISTS (SELECT 1 FROM funding WHERE status IN ('awaiting_executor','awaiting_fee_claim','submitted','confirmed'))").bind(crypto.randomUUID(),destination,Number(plan.amountMicros)/1e6,now).run();
  const result=JSON.parse(JSON.stringify(plan,(_key,value)=>typeof value==="bigint"?value.toString():value)) as Record<string,unknown>;
  await db.prepare("UPDATE funding_monitor SET last_plan=? WHERE id='openrouter'").bind(JSON.stringify(result)).run();return result;
 }finally{await db.prepare("UPDATE funding_monitor SET lease_until=0 WHERE id='openrouter'").run();}
}
