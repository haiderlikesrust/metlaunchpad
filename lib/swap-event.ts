import type {DecodedEvent} from "./chain-events";
export function swapAmounts(event:DecodedEvent){
 const d=event.data,dlmm=event.name==="swap"||event.name==="swap2Evt",sell=dlmm?!!d.swapForY:d.tradeDirection===0,s=dlmm?d:d.swapResult;
 if(!s)return null;
 const integer=(v:unknown)=>BigInt(String(v??0)),input=integer(dlmm?d.amountIn:s.includedFeeInputAmount??s.actualInputAmount),output=integer(dlmm?d.amountOut:s.outputAmount),base=sell?input:output,quote=sell?output:input;
 if(base<=0n||quote<=0n)return null;
 let fee=dlmm?integer(d.fee??d.mmFee)+integer(d.fee===undefined?d.protocolFee:0):integer(s.tradingFee??s.claimingFee)+integer(s.compoundingFee)+integer(s.protocolFee)+integer(s.referralFee);
 if(dlmm&&(d.feesOnTokenX??sell))fee=fee*quote/base;
 return {sell,base,quote,fee};
}
