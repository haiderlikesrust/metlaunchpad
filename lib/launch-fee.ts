/** Older drafts predate fee snapshots and were prepared at 1.5%. */
export function draftFeeBps(valuation:{initialFeeBps?:number}):number{
 const fee=valuation.initialFeeBps??150;
 if(fee!==150&&fee!==200)throw new Error('Unsupported launch fee policy.');
 return fee;
}
/** Read this coin's native configuration, never today's default for new coins. */
export function nativeLaunchFeeBps(curve:{poolFees:{baseFee:{cliffFeeNumerator:{toString():string}}}}):number{
 const numerator=BigInt(curve.poolFees.baseFee.cliffFeeNumerator.toString());
 if(numerator<=0n||numerator>=1_000_000_000n)throw new Error('Invalid native launch fee.');
 return Number(numerator)/100_000;
}
