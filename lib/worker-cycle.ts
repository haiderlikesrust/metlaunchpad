import {config,database,event,HttpError} from "./server";
import {withLock} from "./runtime-lock";
import {reconcileOperation,submitOperation,type Operation} from "./chain-journal";
import {continueLaunch} from "./launch-executor";
import {indexMarket} from "./market-indexer";
import {claimFees,ingestClaim} from "./fee-claimer";
import {claimCompanionFees,executeLiquidityJob} from "./dlmm-executor";
import {executeFeeJob,queueBuybacks,queueGas} from "./fee-jobs";
import {runAgent,type AgentRow} from "./agent-runner";
import {monitorComputeFunding} from "./credit-monitor";
import {executeFunding} from "./funding-executor";
import {writeAnalytics} from "./analytics-writer";
import type {ExecutionJob} from "./asset-ledger";
import {graduatePool} from "./migration-executor";
import {reconcileModelUsage} from "./openrouter";
async function busy(agent:string){return !!await database().prepare("SELECT id FROM chain_operations WHERE agent_id=? AND status IN ('prepared','submitted') LIMIT 1").bind(agent).first();}
async function claimAvailable(agent:AgentRow&{base_mint:string}){
 await claimFees(agent.base_mint);
 if(!await busy(agent.id))await claimCompanionFees(agent.base_mint);
 await queueBuybacks();
}
export async function workerCycle(){return withLock("worker",async()=>{
 const db=database(),started=Date.now(),results:unknown[]=[];
 const pending=await db.prepare("SELECT * FROM chain_operations WHERE status='submitted' OR (status='prepared' AND agent_id IS NOT NULL) ORDER BY updated_at LIMIT 20").all<Operation>();
 for(const op of pending.results){try{const result=op.status==='prepared'?await submitOperation(op.id,op.wire):await reconcileOperation(op);if(result.purpose==="claim")await ingestClaim(result);}catch{/* The journal preserves the exact wire across outages. */}}
 const claims=await db.prepare("SELECT o.* FROM chain_operations o LEFT JOIN fee_receipts r ON r.signature=o.signature WHERE o.purpose='claim' AND o.status='finalized' AND r.signature IS NULL ORDER BY o.created_at DESC LIMIT 20").all<Operation>();
 for(const c of claims.results)try{await ingestClaim(c);}catch{/* Retry each receipt independently. */}
 const drafts=await db.prepare("SELECT DISTINCT d.id,d.owner FROM launch_drafts d JOIN chain_operations o ON o.purpose=('launch:'||d.id||':'||d.stage) WHERE d.stage!='complete' AND o.status='finalized' LIMIT 3").all<{id:string;owner:string}>();
 for(const d of drafts.results)try{await continueLaunch(d.id,d.owner);}catch{/* The creator can resume their launch. */}
 let funding:unknown={action:"hold"},buybacks:unknown={status:"awaiting_configuration"};
 if(config("EXECUTION_PAUSED")==="true")return {results,funding,buybacks,paused:true};
 try{await reconcileModelUsage();}catch{/* Usage remains reserved until verified. */}
 try{buybacks=await queueBuybacks();}catch{buybacks={status:"unavailable"};}
 try{funding=await monitorComputeFunding();await executeFunding();}catch{funding={action:"hold",reason:"Credit or funding service unavailable."};}
 const agents=await db.prepare("SELECT a.*,c.base_mint FROM agents a JOIN agent_custody c ON c.agent_id=a.id WHERE a.status='active' ORDER BY COALESCE(a.last_tick,0),a.id LIMIT 3").all<AgentRow&{base_mint:string}>();
 for(const agent of agents.results){
  if(Date.now()-started>110000)break;
  await db.prepare("UPDATE agents SET last_tick=? WHERE id=?").bind(Date.now(),agent.id).run();
  let job:ExecutionJob|null=null;
  try{
   const market=await indexMarket(agent.base_mint);
   if(await busy(agent.id)){results.push({id:agent.id,status:"confirming"});continue;}
   await queueGas(agent.id,market.bootstrap);
   // Acquired assets finish their workflow before another swap can touch them.
   job=await db.prepare("SELECT * FROM execution_jobs WHERE agent_id=? AND status!='complete' AND (status!='reserved' OR retry_at<=?) ORDER BY CASE WHEN status!='reserved' THEN 0 WHEN kind='gas' THEN 1 WHEN kind='buyback' THEN 2 ELSE 3 END,created_at LIMIT 1").bind(agent.id,Date.now()).first<ExecutionJob>();
   if(job){
    if((job.retry_at||0)>Date.now()){results.push({id:agent.id,status:"retry_wait"});continue;}
    if(job.kind.startsWith("dlmm_"))await executeLiquidityJob(job);else await executeFeeJob(job);
   }else{
    await claimAvailable(agent);
    const queued=await db.prepare("SELECT id FROM execution_jobs WHERE agent_id=? AND status!='complete' LIMIT 1").bind(agent.id).first();
    if(!await busy(agent.id)&&!queued){await graduatePool(agent.base_mint);if(!await busy(agent.id)&&(!agent.last_run||Date.now()-agent.last_run>=300000))await runAgent(agent);}
   }
   await writeAnalytics(agent.id);results.push({id:agent.id,status:"processed"});
  }catch(error){
   const message=error instanceof HttpError?error.message:"Execution paused while a dependency or transaction is checked.";
   if(job){const row=await db.prepare("SELECT attempts FROM execution_jobs WHERE id=?").bind(job.id).first<{attempts:number}>();const attempts=(row?.attempts||0)+1;await db.prepare("UPDATE execution_jobs SET retry_at=?,attempts=?,last_error=? WHERE id=?").bind(Date.now()+Math.min(3600000,300000*2**Math.min(attempts-1,4)),attempts,message,job.id).run();
    if(attempts===1||attempts%12===0)await event(agent.owner,agent.id,"execution_waiting",message,{jobId:job.id,kind:job.kind});
   }
   results.push({id:agent.id,status:"retry_pending"});
  }
 }
 return {results,funding,buybacks};
},240000);}
