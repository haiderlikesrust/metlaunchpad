import type { Policy } from "./engine";
export type TokenInfo = {address:string;name:string;symbol:string;decimals:number;price:number;is_verified:boolean};
export type Pool = {bonding?:{status:"bonding"|"graduating"|"bonded"|"unavailable";percent:number|null};address:string;name:string;token_x:TokenInfo;token_y:TokenInfo;created_at:number;current_price:number;tvl:number;volume:Record<string,number>;fees:Record<string,number>;dynamic_fee_pct:number;pool_config:{bin_step:number;base_fee_pct:number};is_blacklisted:boolean};
export type Agent = {id:string;poolAddress:string;poolName:string;wallet:string;positionAddress:string;model:string;policy:Policy;status:string;lastRun:number|null};
export type AgentEvent = {id:string;agentId:string;kind:string;message:string;createdAt:number};
export type Settings = {solcardAddress:string;creditThreshold:number;topUpUsd:number;dailyFundingCapUsd:number;modelOpus:string;modelSol:string;modelAstra:string};
export const DEFAULT_SETTINGS:Settings={solcardAddress:"",creditThreshold:5,topUpUsd:10,dailyFundingCapUsd:25,modelOpus:"",modelSol:"",modelAstra:""};
export const money=(n:number|null|undefined,compact=true)=>n==null||!Number.isFinite(n)?"—":"$"+(compact&&n>=1e6?(n/1e6).toFixed(2)+"M":compact&&n>=1000?(n/1000).toFixed(1)+"K":n.toLocaleString("en-US",{maximumFractionDigits:2}));
export const short=(v:string)=>v.length>12?`${v.slice(0,5)}…${v.slice(-5)}`:v;
