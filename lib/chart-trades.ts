import type {TradePoint} from './candles';
export type ChartSwap={id:string;at:number;slot:number;transaction_index:number;instruction_index:number;base_amount:string;quote_amount:string;price_usd:number|null;volume_usd:number|null};
/** Use one consistent FX basis across a chart; never label today's rate as historical USD. */
export function chartTrades(rows:ChartSwap[],quoteDecimals:number,currentQuoteUsd:number|null){
 const currentConversion=rows.some(r=>r.price_usd===null||r.volume_usd===null);
 if(currentConversion&&(currentQuoteUsd===null||!Number.isFinite(currentQuoteUsd)||currentQuoteUsd<=0))return null;
 const trades:TradePoint[]=rows.map(r=>{const volume=currentConversion?Number(BigInt(r.quote_amount))/10**quoteDecimals*currentQuoteUsd!:r.volume_usd!,price=currentConversion?volume/(Number(BigInt(r.base_amount))/1e9):r.price_usd!;return {id:r.id,at:r.at,slot:r.slot,transactionIndex:r.transaction_index,instructionIndex:r.instruction_index,priceUsd:price,volumeUsd:volume};});
 return {trades,valuation:currentConversion?'current-quote-usd':'historical-usd'};
}
