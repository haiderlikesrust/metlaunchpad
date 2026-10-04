import {paidJson} from "./openrouter";
import {hourlyUsage,type CreditSample} from "./adaptive-funding";
/** AI forecasts runway; it cannot choose a destination or bypass the earned-fee budget. */
export async function forecastCreditRunway(modelId:string,agentId:string,samples:CreditSample[],now=Date.now()){
 const fallback={targetHours:24,source:"measured_fallback" as const},usage=hourlyUsage(samples,now);
 if(usage===null||usage===0n)return fallback;
 const latest=[...samples].sort((a,b)=>a.at-b.at).at(-1)!;if(latest.remainingMicros<=0n)return fallback;
 try{
  const output=await paidJson(modelId,agentId,"Estimate credit runway from observed OpenRouter usage. Return only JSON {targetHours: integer from 3 to 72}. Default 24 hours. Choose longer coverage when usage accelerates to avoid repeated deposits. You cannot select recipients, spend amounts, or change budgets.",{remainingUsd:Number(latest.remainingMicros)/1e6,spentLastHourUsd:Number(usage)/1e6,samples:samples.map(s=>({at:s.at,usedUsd:Number(s.usedMicros)/1e6}))},120,15000) as {targetHours:number};
  if(!Number.isSafeInteger(output.targetHours)||output.targetHours<3||output.targetHours>72)return fallback;
  return {targetHours:output.targetHours,source:"ai_forecast" as const};
 }catch{return fallback;}
}
