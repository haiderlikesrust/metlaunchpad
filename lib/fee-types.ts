export type FeeAmount={usd:number|null;tokens:{mint:string;symbol:string;amount:string}[]};
export type AgentFees={held:FeeAmount;pending:FeeAmount;claimed:FeeAmount;total:FeeAmount;activation:{claimedUsd:number;targetUsd:number;percent:number;active:boolean};collection:{intervalSeconds:number;status:string;lastCheckedAt:number|null;nextCheckAt:number|null;lastClaimAt:number|null;signature:string|null;message:string|null};observedAt:number};
export function activationProgress(claimedUsd:number){const amount=Math.max(0,claimedUsd);return {claimedUsd:amount,targetUsd:20,percent:Math.min(100,amount/20*100),active:amount>=20};}
export const COLLECTION_INTERVAL_MS=30_000;
