import {config,database,HttpError,pubkey,rpc} from "./server";
import {solPrice} from "./sol-price";
import {SOL_MINT} from "./launch-economics";
export async function assetPrice(mint:string){
 pubkey(mint);let usdPrice:number,asOfTimestamp:number;
 if(mint===SOL_MINT){const p=await solPrice();usdPrice=p.solPrice;asOfTimestamp=p.asOfTimestamp;}
 else{
  const key=config("JUPITER_API_KEY");if(!key)throw new HttpError(503,"Quote-token pricing requires the Jupiter service connection.");
  const response=await fetch(`https://api.jup.ag/price/v3?ids=${mint}`,{headers:{"x-api-key":key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new HttpError(503,"Quote pricing is temporarily unavailable.");
  const item=(await response.json() as Record<string,{usdPrice:number;blockId:number}>)[mint];
  if(!item||!Number.isFinite(item.usdPrice)||item.usdPrice<=0||!Number.isSafeInteger(item.blockId))throw new HttpError(409,"This quote token has no reliable live price.");
  const blockTime=await rpc().getBlockTime(item.blockId);if(!blockTime||Date.now()-blockTime*1000>60000||blockTime*1000>Date.now()+5000)throw new HttpError(409,"Quote-token price is stale.");
  usdPrice=item.usdPrice;asOfTimestamp=blockTime*1000;
 }
 await database().prepare("INSERT OR IGNORE INTO price_observations(mint,observed_at,usd_price) VALUES(?,?,?)").bind(mint,asOfTimestamp,usdPrice).run();return {mint,usdPrice,asOfTimestamp};
}
export async function historicalPrice(mint:string,at:number){
 const row=await database().prepare("SELECT usd_price FROM price_observations WHERE mint=? AND observed_at BETWEEN ? AND ? ORDER BY ABS(observed_at-?) LIMIT 1").bind(mint,at-60000,at+60000,at).first<{usd_price:number}>();return row?.usd_price??null;
}
