import {database,HttpError,pubkey} from "./server";
import {aggregateCandles,CHART_INTERVALS,type ChartInterval} from "./candles";
import {chartTrades,type ChartSwap} from './chart-trades';
import {indexMarket} from "./market-indexer";
export async function tokenCandles(mint:string,interval:string){
 pubkey(mint);if(!Object.hasOwn(CHART_INTERVALS,interval))throw new HttpError(400,"Choose a 1s, 1m, 5m, or 1h interval.");
 const db=database(),launch=await db.prepare("SELECT quote_mint,quote_decimals FROM launches WHERE mint=? AND verified_at IS NOT NULL LIMIT 1").bind(mint).first<{quote_mint:string;quote_decimals:number}>();if(!launch)throw new HttpError(404,"This contract is not a verified THICC token.");
 const latest=()=>db.prepare("SELECT MAX(at) at FROM raw_swaps WHERE mint=?").bind(mint).first<{at:number|null}>();let last=await latest();
 // Public reads may refresh verified market data, never sign or claim funds.
 const refresh=indexMarket(mint).catch(()=>null);
 if(!last?.at){await Promise.race([refresh,new Promise(resolve=>setTimeout(resolve,2500))]);last=await latest();}
 const now=Date.now(),step=CHART_INTERVALS[interval as ChartInterval]*1000,end=last?.at?Math.min(now,last.at+step):now,start=Math.floor(end/step)*step-step*239;
 const rows=await db.prepare("SELECT r.*,t.price_usd,t.volume_usd FROM raw_swaps r LEFT JOIN token_trades t ON t.id=r.id WHERE r.mint=? AND r.at>=? AND r.at<=? ORDER BY r.at,r.slot,r.transaction_index,r.instruction_index LIMIT 50001").bind(mint,start,now).all<{id:string;at:number;slot:number;transaction_index:number;instruction_index:number;base_amount:string;quote_amount:string;price_usd:number|null;volume_usd:number|null}>();
 if(rows.results.length>50000)throw new HttpError(503,"This range exceeds the chart trade limit. Choose a shorter interval.");
 const currentConversion=rows.results.some(r=>r.price_usd===null),quote=currentConversion?await db.prepare("SELECT usd_price,observed_at FROM price_observations WHERE mint=? ORDER BY observed_at DESC LIMIT 1").bind(launch.quote_mint).first<{usd_price:number;observed_at:number}>():null;
 const rate=quote&&now-quote.observed_at<=120000?quote.usd_price:null;
 const converted=chartTrades(rows.results as ChartSwap[],launch.quote_decimals,rate);if(!converted)throw new HttpError(503,'Waiting for a fresh quote/USD rate to display recorded swaps.');
 return {mint,interval,candles:aggregateCandles(converted.trades,interval as ChartInterval),source:"finalized-swaps",valuation:converted.valuation,quoteRateAsOf:quote?.observed_at??null,lastTradeAt:converted.trades.at(-1)?.at??null,fetchedAt:now,syncing:!converted.trades.length&&!!last?.at};
}
