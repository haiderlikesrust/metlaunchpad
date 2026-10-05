import type {DynamicBondingCurveClient} from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import {thiccCurve} from './dbc-curve';

export function devBuyAtoms(value:string|undefined,decimals:number):BN|null{
 const amount=(value||'').trim();if(!amount||/^0+(\.0+)?$/.test(amount))return null;
 if(amount.length>40||!/^\d+(\.\d+)?$/.test(amount)||!Number.isInteger(decimals)||decimals<0||decimals>9)throw new Error('Enter a valid optional dev buy amount.');
 const [whole,fraction='']=amount.split('.');if(fraction.length>decimals)throw new Error(`Dev buy supports at most ${decimals} decimal places for this quote token.`);
 const atoms=new BN(whole+fraction.padEnd(decimals,'0'));if(atoms.isZero()||atoms.gt(new BN('18446744073709551615')))throw new Error('Dev buy amount is out of range.');return atoms;
}
export function devBuyQuote(client:DynamicBondingCurveClient,curve:ReturnType<typeof thiccCurve>,value:string|undefined,decimals:number){
 const amount=devBuyAtoms(value,decimals);if(!amount)return null;
 const quote=client.pool.getQuoteFromInputAmount({config:curve,swapBaseForQuote:false,amountIn:amount,slippageBps:50,eligibleForFirstSwapWithMinFee:false});
 if(!quote.minimumAmountOut||quote.minimumAmountOut.isZero()||!quote.includedFeeInputAmount.eq(amount))throw new Error('Dev buy must fit within the launch curve. Choose a smaller amount.');
 return {amount,minimumAmountOut:quote.minimumAmountOut,expectedOut:quote.outputAmount};
}
