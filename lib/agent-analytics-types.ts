export type AnalyticsWindow="24h"|"7d"|"30d";
export type Performance={liquidityUsd:number|null;feesUsd:number|null;gasUsd:number|null;computeUsd:number|null;compoundedUsd:number|null;slippageBps:number|null;rebalances:number|null;feeBps:number|null};
export type NormalPool={feesUsd:number;gasUsd:number;slippageBps:number|null;method:"native-position-observed-flow-v1";replayComplete:boolean};
export type AnalyticsCoin={mint:string;name:string;symbol:string;poolAddress:string;agentId:string|null;model:string|null;state:string;asOf:number|null;periodStart:number|null;periodEnd:number|null;actual:Performance|null;baseline:NormalPool|null;lastAction:{kind:string;at:number}|null};
export type AgentAnalytics={window:AnalyticsWindow;fetchedAt:number;coins:AnalyticsCoin[];totalCoins:number};
export function feeIncome(p:Performance|null){return p?.feesUsd!=null&&p.gasUsd!=null&&p.computeUsd!=null?p.feesUsd-p.gasUsd-p.computeUsd:null;}
export function comparison(coin:AnalyticsCoin){
 const p=coin.baseline,actual=feeIncome(coin.actual);
 if(actual===null||!p||!p.replayComplete||p.method!=="native-position-observed-flow-v1"||!coin.periodStart||!coin.periodEnd||coin.periodEnd<=coin.periodStart)return null;
 const baseline=p.feesUsd-p.gasUsd;
 return {actual,baseline,difference:actual-baseline,percent:baseline>0?(actual-baseline)/baseline*100:null};
}
