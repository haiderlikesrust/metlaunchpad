/** Unreflected card funding is an estimate for deposit deduplication, never an
 * assertion that OpenRouter credits arrived. Rows must be chronological. */
export function cardFundingBuffer(rows:{amount_usd:number;baseline_credits:number|null}[],totalCredits:number){
 if(!Number.isFinite(totalCredits)||totalCredits<0)return null;
 let balance=0,baseline:number|null=null;
 for(const row of rows){if(!Number.isFinite(row.amount_usd)||row.amount_usd<0||row.baseline_credits===null||!Number.isFinite(row.baseline_credits)||row.baseline_credits<0||totalCredits<row.baseline_credits||(baseline!==null&&row.baseline_credits<baseline))return null;
  if(baseline!==null)balance=Math.max(0,balance-Math.max(0,row.baseline_credits-baseline));
  balance+=row.amount_usd;baseline=row.baseline_credits;
 }
 return baseline===null?0:Math.max(0,balance-Math.max(0,totalCredits-baseline));
}
