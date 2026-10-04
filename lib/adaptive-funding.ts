export type CreditSample={at:number;remainingMicros:bigint;usedMicros:bigint};
export type FundingPlan={action:"hold";reason:string}|{action:"top_up";amountMicros:bigint;hourlyUsageMicros:bigint;targetHours:number;remainingMicros:bigint;limitedByEarnedFees:boolean};
const HOUR=3_600_000;
/** Cumulative OpenRouter usage avoids confusing a credit purchase with spend. */
export function hourlyUsage(samples:CreditSample[],now:number):bigint|null{
 const sorted=[...samples].sort((a,b)=>a.at-b.at),last=sorted.at(-1);
 if(!last||last.at>now+5000||now-last.at>120000||sorted.some((s,i)=>s.usedMicros<0n||s.remainingMicros<0n||!Number.isSafeInteger(s.at)||(i>0&&(s.at<=sorted[i-1].at||s.usedMicros<sorted[i-1].usedMicros))))return null;
 const cutoff=last.at-HOUR,before=sorted.filter(s=>s.at<=cutoff).at(-1),after=sorted.find(s=>s.at>=cutoff);
 if(!before||!after||cutoff-before.at>300000||after.at-cutoff>300000)return null;
 const usedAtCutoff=before.at===after.at?before.usedMicros:before.usedMicros+(after.usedMicros-before.usedMicros)*BigInt(cutoff-before.at)/BigInt(after.at-before.at);
 return last.usedMicros-usedAtCutoff;
}
export function planAdaptiveFunding(input:{samples:CreditSample[];now:number;availableEarnedComputeMicros:bigint;pending:boolean;destinationVerified:boolean;targetHours?:number;triggerHours?:number}):FundingPlan{
 if(input.pending)return {action:"hold",reason:"A deposit is pending credit reconciliation."};
 if(!input.destinationVerified)return {action:"hold",reason:"A verified permanent deposit destination is required."};
 const rate=hourlyUsage(input.samples,input.now);
 if(rate===null)return {action:"hold",reason:"A complete hour of fresh credit usage is required."};
 if(rate===0n)return {action:"hold",reason:"No credit usage was measured in the last hour."};
 const targetHours=input.targetHours??24,triggerHours=input.triggerHours??2;
 if(!Number.isSafeInteger(targetHours)||targetHours<1||targetHours>72||!Number.isFinite(triggerHours)||triggerHours<=0||triggerHours>=targetHours)return {action:"hold",reason:"Invalid credit-runway forecast."};
 const latest=[...input.samples].sort((a,b)=>a.at-b.at).at(-1)!;
 const triggerMicros=rate*BigInt(Math.ceil(triggerHours*1000))/1000n;
 if(latest.remainingMicros>triggerMicros)return {action:"hold",reason:"Credits cover the current refill runway."};
 const required=rate*BigInt(targetHours)-latest.remainingMicros;
 // Round the requested amount upward to a cent, then cap at actual earned compute fees.
 const rounded=((required+9999n)/10000n)*10000n;
 const available=input.availableEarnedComputeMicros/10000n*10000n;
 const amount=rounded>available?available:rounded;
 if(amount<=0n)return {action:"hold",reason:"No earned compute fees are available. LP principal cannot fund inference."};
 return {action:"top_up",amountMicros:amount,hourlyUsageMicros:rate,targetHours,remainingMicros:latest.remainingMicros,limitedByEarnedFees:amount<rounded};
}
