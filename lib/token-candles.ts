import {database,HttpError,pubkey} from "./server";
import {aggregateCandles,CHART_INTERVALS,type ChartInterval,type TradePoint} from "./candles";
export async function tokenCandles(mint:string,interval:string){
 pubkey(mint);if(!Object.hasOwn(CHART_INTERVALS,interval))throw new HttpError(400,"Choose a 1s, 1m, 5m, or 1h interval.");
 const launch=await database().prepare("SELECT mint FROM launches WHERE mint=? AND verified_at IS NOT NULL LIMIT 1").bind(mint).first();if(!launch)throw new HttpError(404,"This contract is not a verified THICC token.");
 const end=Date.now(),step=CHART_INTERVALS[interval as ChartInterval]*1000,start=Math.floor(end/step)*step-step*239;
 const result=await database().prepare("SELECT id,at,price_usd AS priceUsd,volume_usd AS volumeUsd,slot,transaction_index AS transactionIndex,instruction_index AS instructionIndex FROM token_trades WHERE mint=? AND verified_at IS NOT NULL AND at>=? AND at<=? ORDER BY at,slot,transaction_index,instruction_index LIMIT 50001").bind(mint,start,end).all<TradePoint>();
 if(result.results.length>50000)throw new HttpError(503,"This range requires indexed candles before it can be displayed completely.");
 return {mint,interval,candles:aggregateCandles(result.results,interval as ChartInterval),source:"verified-recorded-swaps",lastTradeAt:result.results.at(-1)?.at??null,fetchedAt:end};
}
