import {config,database,HttpError} from './server';
import {withLock} from './runtime-lock';
import {claimFees,ingestClaim} from './fee-claimer';
import {claimCompanionFees} from './dlmm-executor';
import {reconcileOperation,submitOperation,type Operation} from './chain-journal';
import {reserveCollectionCheck} from './collection-schedule';
export async function claimCycle(){return withLock('claim-cycle',async()=>{
 if(config('EXECUTION_PAUSED')==='true')return {paused:true};
 const db=database(),now=Date.now(),rows=await db.prepare("SELECT a.id,c.base_mint FROM agents a JOIN agent_custody c ON c.agent_id=a.id LEFT JOIN fee_collection_state f ON f.agent_id=a.id WHERE a.status='active' AND COALESCE(f.next_check_at,0)<=? ORDER BY COALESCE(f.next_check_at,0) LIMIT 48").bind(now).all<{id:string;base_mint:string}>();
 const results:unknown[]=[];
 for(let i=0;i<rows.results.length;i+=4)await Promise.all(rows.results.slice(i,i+4).map(async agent=>{
  try{await withLock(`agent:${agent.id}`,async()=>{
   if(!await reserveCollectionCheck(agent.id))return;
   const operations=await db.prepare("SELECT * FROM chain_operations WHERE agent_id=? AND status IN ('prepared','submitted')").bind(agent.id).all<Operation>();
   for(const op of operations.results){const r=op.status==='prepared'?await submitOperation(op.id,op.wire):await reconcileOperation(op);if(r.purpose==='claim')await ingestClaim(r);}
   const busy=async()=>!!await db.prepare("SELECT id FROM chain_operations WHERE agent_id=? AND status IN ('prepared','submitted') LIMIT 1").bind(agent.id).first();
   const acquired=await db.prepare("SELECT id FROM execution_jobs WHERE agent_id=? AND status NOT IN ('complete','reserved','cancelled') LIMIT 1").bind(agent.id).first();
   if(await busy()||acquired){await db.prepare("UPDATE fee_collection_state SET status='confirming' WHERE agent_id=?").bind(agent.id).run();return;}
   await claimFees(agent.base_mint);
   if(!await busy())await claimCompanionFees(agent.base_mint);
   await db.prepare("UPDATE fee_collection_state SET status=? WHERE agent_id=?").bind(await busy()?'confirming':'checked',agent.id).run();
  },120000);results.push({id:agent.id,status:'checked'});}catch(error){
   if(error instanceof HttpError&&error.message.startsWith('This operation is already')){results.push({id:agent.id,status:'busy'});return;}
   await db.prepare("UPDATE fee_collection_state SET status='retry_pending',last_error=? WHERE agent_id=?").bind(error instanceof HttpError?error.message:'Collection delayed; retrying after the next check.',agent.id).run();results.push({id:agent.id,status:'retry_pending'});
  }
 }));return {results,intervalSeconds:30};
},180000);}
