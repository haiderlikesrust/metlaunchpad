/** Bootstrap at 50%. Once there is measured spend, target a day's runway as a
 * share of earned treasury, with no fixed treasury-dollar cutoff. */
export function computeTargetPct(treasuryUsd:number,hourlySpendUsd=0,claimedUsd=treasuryUsd,hasUsageHistory=hourlySpendUsd>0){
 if(![treasuryUsd,hourlySpendUsd,claimedUsd].every(n=>Number.isFinite(n)&&n>=0))throw new Error('Invalid compute treasury valuation.');
 if(!hasUsageHistory)return 50;
 const demand=treasuryUsd>0?hourlySpendUsd*24/treasuryUsd*100:70;
 return Math.min(70,Math.max(10,demand));
}
export function computeTransfer(total:bigint,assigned:bigint,compound:bigint,reserve:bigint,pct:number){
 if([total,assigned,compound,reserve].some(n=>n<0n)||!Number.isFinite(pct)||pct<10||pct>70)throw new Error('Invalid compute allocation.');
 const target=total*BigInt(Math.floor(pct*100))/10000n,needed=target>assigned?target-assigned:0n;
 const fromCompound=compound<needed?compound:needed,remaining=needed-fromCompound;
 const reserveFloor=(total*20n+99n)/100n,excess=reserve>reserveFloor?reserve-reserveFloor:0n;
 return {fromCompound,fromReserve:excess<remaining?excess:remaining};
}
