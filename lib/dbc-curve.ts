import {ActivationType,BaseFeeMode,CollectFeeMode,DammV2DynamicFeeMode,MigratedCollectFeeMode,MigrationFeeOption,MigrationOption,TokenAuthorityOption,TokenDecimal,TokenType,buildCurveWithMarketCap} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {LAUNCH_ECONOMICS} from './launch-economics';
/** Curve parameters are created by the server; no creator-supplied economic fields. */
export function thiccCurve(quoteDecimals:number,initialCap:number,graduationCap:number,feeBps:number=LAUNCH_ECONOMICS.initialFeeBps){
 if(!Number.isInteger(quoteDecimals)||quoteDecimals<0||quoteDecimals>9||!Number.isFinite(initialCap)||initialCap<=0||!Number.isFinite(graduationCap)||graduationCap<=initialCap)throw new Error("Invalid quote valuation.");
 if(feeBps!==150&&feeBps!==200)throw new Error('Unsupported launch fee policy.');
 return buildCurveWithMarketCap({
  token:{tokenType:TokenType.SPLToken,tokenBaseDecimal:TokenDecimal.NINE,tokenQuoteDecimal:quoteDecimals,tokenAuthorityOption:TokenAuthorityOption.Immutable,totalTokenSupply:1_000_000_000,leftover:0},
  fee:{baseFeeParams:{baseFeeMode:BaseFeeMode.FeeSchedulerLinear,feeSchedulerParam:{startingFeeBps:feeBps,endingFeeBps:feeBps,numberOfPeriod:0,totalDuration:0}},dynamicFeeEnabled:false,collectFeeMode:CollectFeeMode.QuoteToken,creatorTradingFeePercentage:0,poolCreationFee:0,enableFirstSwapWithMinFee:false},
  migration:{migrationOption:MigrationOption.MET_DAMM_V2,migrationFeeOption:MigrationFeeOption.Customizable,migrationFee:{feePercentage:0,creatorFeePercentage:0},migratedPoolFee:{collectFeeMode:MigratedCollectFeeMode.QuoteToken,dynamicFee:DammV2DynamicFeeMode.Disabled,poolFeeBps:feeBps}},
  liquidityDistribution:{partnerPermanentLockedLiquidityPercentage:100,partnerLiquidityPercentage:0,creatorPermanentLockedLiquidityPercentage:0,creatorLiquidityPercentage:0},
  lockedVesting:{totalLockedVestingAmount:0,numberOfVestingPeriod:0,cliffUnlockAmount:0,totalVestingDuration:0,cliffDurationFromMigrationTime:0},
  activationType:ActivationType.Timestamp,initialMarketCap:initialCap,migrationMarketCap:graduationCap,
 });
}
