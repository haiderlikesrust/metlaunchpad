/** Continuous monitoring is free of model spend. Paid decisions adapt to this
 * agent's earned compute budget; liquidity execution keeps its own risk limits. */
export function decisionCadence(earnedUsd:number,committedUsd:number,averageCallUsd:number,hourlyEarnedUsd:number){
 const remainingUsd=Math.max(0,earnedUsd-committedUsd);
 if(![earnedUsd,committedUsd,averageCallUsd,hourlyEarnedUsd].every(Number.isFinite)||remainingUsd<=0)return {mode:"paused" as const,remainingUsd:0,delayMs:300000};
 const cost=Math.max(.01,averageCallUsd),callsRemaining=remainingUsd/cost;
 // Preserve a day's runway at the current fee income when the budget is tight.
 const hourlyBudget=Math.max(remainingUsd/24,Math.max(0,hourlyEarnedUsd));
 const delayMs=Math.max(10000,Math.min(300000,Math.ceil(cost/hourlyBudget*3600000)));
 return {mode:delayMs>10000||callsRemaining<20?"economy" as const:"continuous" as const,remainingUsd,delayMs};
}
