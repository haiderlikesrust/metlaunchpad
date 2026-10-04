export const CHART_INTERVALS={"1s":1,"1m":60,"5m":300,"1h":3600} as const;
export type ChartInterval=keyof typeof CHART_INTERVALS;
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type TradePoint={id:string;at:number;priceUsd:number;volumeUsd:number;slot:number;transactionIndex:number;instructionIndex:number};
export function aggregateCandles(trades:TradePoint[],interval:ChartInterval):Candle[]{
 const step=CHART_INTERVALS[interval]*1000;if(!step)throw new Error("Unsupported candle interval.");
 const seen=new Set<string>(),buckets=new Map<number,Candle>();
 const sorted=[...trades].sort((a,b)=>a.at-b.at||a.slot-b.slot||a.transactionIndex-b.transactionIndex||a.instructionIndex-b.instructionIndex||a.id.localeCompare(b.id));
 for(const trade of sorted){
  if(seen.has(trade.id))continue;seen.add(trade.id);
  if(!Number.isSafeInteger(trade.at)||trade.at<0||!Number.isFinite(trade.priceUsd)||trade.priceUsd<=0||!Number.isFinite(trade.volumeUsd)||trade.volumeUsd<0)throw new Error("Invalid verified trade.");
  const time=Math.floor(trade.at/step)*step/1000,candle=buckets.get(time);
  if(candle){candle.high=Math.max(candle.high,trade.priceUsd);candle.low=Math.min(candle.low,trade.priceUsd);candle.close=trade.priceUsd;candle.volume+=trade.volumeUsd;}
  else buckets.set(time,{time,open:trade.priceUsd,high:trade.priceUsd,low:trade.priceUsd,close:trade.priceUsd,volume:trade.volumeUsd});
 }
 return [...buckets.values()];
}
