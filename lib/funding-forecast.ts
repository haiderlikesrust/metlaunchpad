import {config} from "./server";
import {resolveAgentModel} from "./model-routing";
import {hourlyUsage,type CreditSample} from "./adaptive-funding";
/** AI can forecast runway; it cannot change the destination, fee budget, or duplicate-payment guard. */
export async function forecastCreditRunway(modelId:string,samples:CreditSample[],now=Date.now()){
 const usage=hourlyUsage(samples,now),key=config("OPENROUTER_API_KEY");
 if(usage===null||usage===0n||!key)return {targetHours:24,source:"measured_fallback" as const};
 const latest=[...samples].sort((a,b)=>a.at-b.at).at(-1)!;
 if(latest.remainingMicros<=0n)return {targetHours:24,source:"measured_fallback" as const};
 try{
  const model=resolveAgentModel(modelId);
  const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","X-Title":"THICC credit forecast"},body:JSON.stringify({model,max_tokens:120,response_format:{type:"json_object"},messages:[{role:"system",content:"Estimate credit runway for autonomous liquidity agents from observed OpenRouter usage. Return only JSON {targetHours: integer from 3 to 72}. Default 24 hours. Choose longer coverage when usage is accelerating to avoid repeated deposits. You cannot select payment recipients, spend amounts, or change any budget. This is a forecast, not a transfer instruction."},{role:"user",content:JSON.stringify({remainingUsd:Number(latest.remainingMicros)/1e6,spentLastHourUsd:Number(usage)/1e6,samples:samples.map(s=>({at:s.at,usedUsd:Number(s.usedMicros)/1e6}))})}]}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("Forecast unavailable");const d=await r.json() as {choices:{message:{content:string}}[]};const output=JSON.parse(d.choices[0].message.content) as {targetHours:number};
  if(!Number.isSafeInteger(output.targetHours)||output.targetHours<3||output.targetHours>72)throw new Error("Invalid forecast");return {targetHours:output.targetHours,source:"ai_forecast" as const};
 }catch{return {targetHours:24,source:"measured_fallback" as const};}
}
