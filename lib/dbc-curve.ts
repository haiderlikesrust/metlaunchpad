import {ActivationType,BaseFeeMode,CollectFeeMode,DammV2DynamicFeeMode,MigratedCollectFeeMode,MigrationFeeOption,MigrationOption,TokenAuthorityOption,TokenDecimal,TokenType,buildCurveWithMarketCap} from "@meteora-ag/dynamic-bonding-curve-sdk";
/** Curve parameters are created by the server; no creator-supplied economic fields. */
export function thiccCurve(quoteDecimals:number,initialCap:number,graduationCap:number){
 if(!Number.isInteger(quoteDecimals)||quoteDecimals<0||quoteDecimals>9||!Number.isFinite(initialCap)||initialCap<=0||!Number.isFinite(graduationCap)||graduationCap<=initialCap)throw new Error("Invalid quote valuation.");
 return buildCurveWithMarketCap({
  token:{tokenType:TokenType.SPLToken,tokenBaseDecimal:TokenDecimal.NINE,tokenQuoteDecimal:quoteDecimals,tokenAuthorityOption:TokenAuthorityOption.Immutable,totalTokenSupply:1_000_000_000,leftover:0},
  fee:{baseFeeParams:{baseFeeMode:BaseFeeMode.FeeSchedulerLinear,feeSchedulerParam:{startingFeeBps:150,endingFeeBps:150,numberOfPeriod:0,totalDuration:0}},dynamicFeeEnabled:false,collectFeeMode:CollectFeeMode.QuoteToken,creatorTradingFeePercentage:0,poolCreationFee:0,enableFirstSwapWithMinFee:false},
  migration:{migrationOption:MigrationOption.MET_DAMM_V2,migrationFeeOption:MigrationFeeOption.Customizable,migrationFee:{feePercentage:0,creatorFeePercentage:0},migratedPoolFee:{collectFeeMode:MigratedCollectFeeMode.QuoteToken,dynamicFee:DammV2DynamicFeeMode.Disabled,poolFeeBps:150}},
  liquidityDistribution:{partnerPermanentLockedLiquidityPercentage:100,partnerLiquidityPercentage:0,creatorPermanentLockedLiquidityPercentage:0,creatorLiquidityPercentage:0},
  lockedVesting:{totalLockedVestingAmount:0,numberOfVestingPeriod:0,cliffUnlockAmount:0,totalVestingDuration:0,cliffDurationFromMigrationTime:0},
  activationType:ActivationType.Timestamp,initialMarketCap:initialCap,migrationMarketCap:graduationCap,
 });
}
