import {LAUNCH_POLICY} from "./launch-policy";

/** Split actual token units, independently of the agent's activation or model.
 * Carry cumulative totals per wallet + fee mint so tiny claims cannot round the
 * 10% allocation away. Callers must persist the cursor with the claim receipt.
 */
export function distributeClaim(amount:bigint,previousClaimed=0n){
 if(amount<0n||previousClaimed<0n)throw new Error("Claim amounts must be non-negative.");
 const cumulative=previousClaimed+amount;
 const delta=(bps:number)=>cumulative*BigInt(bps)/10000n-previousClaimed*BigInt(bps)/10000n;
 const buybackBurn=delta(LAUNCH_POLICY.buybackBurnBps);
 // Reserve buybacks first. Separate rounding of all four cumulative buckets
 // could otherwise overdraw a very small claim at a rounding boundary.
 const remaining=amount-buybackBurn;
 const compound=remaining*BigInt(LAUNCH_POLICY.compoundBps)/9000n;
 const compute=remaining*BigInt(LAUNCH_POLICY.computeBps)/9000n;
 return {buybackBurn,compound,compute,reserve:remaining-compound-compute,cumulative};
}

export type BuybackState="awaiting_mint"|"awaiting_execution"|"swap_submitted"|"awaiting_burn"|"burn_submitted"|"burned";
export type BuybackJob={state:BuybackState;targetMint:string|null;inputMint:string;inputAmount:bigint;acquiredAmount:bigint;swapSignature:string|null;burnSignature:string|null};
/** No model response is accepted by this state machine. A submitted swap must
 * be reconciled before another purchase is allowed; a burn failure retries only
 * the burn. Submission alone never counts as a completed burn.
 */
export function nextBuybackAction(job:BuybackJob){
 if(job.inputAmount<=0n)return "accumulate_dust" as const;
 if(!job.targetMint||job.state==="awaiting_mint")return "await_mint" as const;
 if(job.state==="burned")return "complete" as const;
 if(job.state==="burn_submitted"){
  if(!job.burnSignature)throw new Error("Missing submitted burn signature.");
  return "reconcile_burn" as const;
 }
 if(job.state==="awaiting_burn"){
  if(job.acquiredAmount<=0n)throw new Error("A verified acquired amount is required before burning.");
  return "burn" as const;
 }
 if(job.state==="swap_submitted"){
  if(!job.swapSignature)throw new Error("Missing submitted swap signature.");
  return "reconcile_swap" as const;
 }
 return job.inputMint===job.targetMint?"burn_claimed_thicc":"swap";
}
