import {config,database,pubkey} from "./server";
import {assetBalance,reserveJob} from "./asset-ledger";
import {assetPrice} from "./asset-price";
import {mintInfo} from "./pool-state";
import {SOL_MINT} from "./launch-economics";
import {getCredits} from "./openrouter";
export async function executeFunding(){
 const db=database(),credits=await getCredits().catch(()=>null),totalCredits=credits?credits.remaining+credits.used:null;
 const requests=await db.prepare("SELECT * FROM funding WHERE status IN ('awaiting_executor','awaiting_fee_claim','submitted','confirmed') ORDER BY created_at LIMIT 1").all<{id:string;owner:string;address:string;amount_usd:number;status:string;baseline_credits:number|null}>();
 for(const request of requests.results){
  if(request.address!==config("SOLCARD_DEPOSIT_ADDRESS"))throw new Error("Pending funding destination differs from configuration.");pubkey(request.address);
  if(request.baseline_credits===null&&totalCredits!==null){await db.prepare("UPDATE funding SET baseline_credits=? WHERE id=? AND baseline_credits IS NULL").bind(totalCredits,request.id).run();request.baseline_credits=totalCredits;}
  let jobs=(await db.prepare("SELECT status,context_json FROM execution_jobs WHERE kind='compute' AND status!='cancelled' AND json_extract(context_json,'$.fundingId')=?").bind(request.id).all<{status:string;context_json:string}>()).results;
  let remaining=request.amount_usd-jobs.reduce((s,j)=>s+Number(JSON.parse(j.context_json).allocatedUsd),0);
  if(remaining>.01){const assets=await db.prepare("SELECT DISTINCT e.agent_id,e.mint FROM asset_entries e JOIN agents a ON a.id=e.agent_id WHERE e.bucket='compute' AND a.status='active' AND (?='platform' OR e.agent_id=?) AND (SELECT COALESCE(SUM(usd_micros),0) FROM fee_receipts WHERE agent_id=e.agent_id)>=20000000").bind(request.owner,request.owner).all<{agent_id:string;mint:string}>();
   for(const a of assets.results){const available=await assetBalance(a.agent_id,a.mint,"compute");if(available<=0n)continue;const [price,info]=await Promise.all([assetPrice(a.mint),mintInfo(a.mint)]),desired=BigInt(Math.floor(remaining/price.usdPrice*10**info.mint.decimals)),amount=desired<available?desired:available,allocatedUsd=Number(amount)/10**info.mint.decimals*price.usdPrice;if(allocatedUsd<.01)continue;
    await reserveJob(a.agent_id,"compute",a.mint,amount,"compute",SOL_MINT,{fundingId:request.id,address:request.address,allocatedUsd});remaining-=allocatedUsd;if(remaining<=.01)break;
   }
  }
  jobs=(await db.prepare("SELECT status,context_json FROM execution_jobs WHERE kind='compute' AND status!='cancelled' AND json_extract(context_json,'$.fundingId')=?").bind(request.id).all<{status:string;context_json:string}>()).results;
  const allocated=jobs.reduce((s,j)=>s+Number(JSON.parse(j.context_json).allocatedUsd),0),complete=jobs.length>0&&jobs.every(j=>j.status==='complete');
  if(complete)await db.prepare("UPDATE funding SET status='deposit_confirmed',amount_usd=?,reconciled_at=? WHERE id=?").bind(allocated,Date.now(),request.id).run();
  else await db.prepare("UPDATE funding SET status=? WHERE id=?").bind(complete?"confirmed":allocated>=request.amount_usd-.01?"submitted":"awaiting_fee_claim",request.id).run();
 }
 return {pending:requests.results.length};
}
