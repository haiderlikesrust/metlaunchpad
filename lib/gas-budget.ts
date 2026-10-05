import {database,rpc} from "./server";
import {agentSigner} from "./custody";
import {SOL_MINT} from "./launch-economics";
/** SOL held for buybacks, compounding, reserves or deposits is not spendable gas. */
export async function gasBudget(agent:string){
 const signer=await agentSigner(agent),balance=BigInt(await rpc().getBalance(signer.publicKey)),db=database();
 const entries=await db.prepare("SELECT amount FROM asset_entries WHERE agent_id=? AND mint=? AND bucket!='burn'").bind(agent,SOL_MINT).all<{amount:string}>();let liabilities=entries.results.reduce((s,r)=>s+BigInt(r.amount),0n);
 const jobs=await db.prepare("SELECT kind,status,input_mint,input_amount,output_mint,output_amount,context_json FROM execution_jobs WHERE agent_id=? AND status NOT IN ('complete','cancelled')").bind(agent).all<{kind:string;status:string;input_mint:string;input_amount:string;output_mint:string|null;output_amount:string|null;context_json:string}>();
 for(const job of jobs.results){if(job.status==="reserved"&&job.input_mint===SOL_MINT)liabilities+=BigInt(job.input_amount);if(job.status==="unwrapped"&&job.output_mint===SOL_MINT)liabilities+=BigInt(job.output_amount||"0");if(job.kind==="dlmm_add"){const c=JSON.parse(job.context_json);if(c.quoteMint===SOL_MINT)liabilities+=BigInt(c.amountY);}}
 return balance-liabilities;
}
