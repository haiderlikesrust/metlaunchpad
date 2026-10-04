import {DynamicBondingCurveClient,DAMM_V2_MIGRATION_FEE_ADDRESS,deriveDammV2PoolAddress,getPriceFromSqrtPrice} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {CpAmm} from "@meteora-ag/cp-amm-sdk";
import {getMint} from "@solana/spl-token";
import {database,HttpError,pubkey,rpc} from "./server";
export async function livePool(mint:string){
 const launch=await database().prepare("SELECT l.*,c.agent_id,c.wallet AS agent_wallet,c.dlmm_pool,c.graduated_pool FROM launches l JOIN agent_custody c ON c.base_mint=l.mint WHERE l.mint=? AND l.verified_at IS NOT NULL").bind(mint).first<{mint:string;pool_address:string;quote_mint:string;quote_decimals:number;graduation_quote:number;agent_id:string;agent_wallet:string;dlmm_pool:string|null;graduated_pool:string|null}>();if(!launch)throw new HttpError(404,"This token is not a verified THICC launch.");
 const connection=rpc(),dbc=new DynamicBondingCurveClient(connection,"finalized"),pool=await dbc.state.getPool(launch.pool_address);if(!pool||pool.poolState.baseMint.toBase58()!==mint)throw new HttpError(409,"Pool mint mismatch.");const curve=await dbc.state.getPoolConfig(pool.poolState.config);if(!curve||curve.quoteMint.toBase58()!==launch.quote_mint||curve.feeClaimer.toBase58()!==launch.agent_wallet)throw new HttpError(409,"Pool authority mismatch.");
 let graduated:string|null=null,dammState:Awaited<ReturnType<CpAmm["fetchPoolState"]>>|null=null;
 if(pool.poolState.isMigrated){graduated=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[curve.migrationFeeOption],pubkey(mint),curve.quoteMint).toBase58();dammState=await new CpAmm(connection).fetchPoolState(pubkey(graduated));if(dammState.tokenAMint.toBase58()!==mint||!dammState.tokenBMint.equals(curve.quoteMint))throw new HttpError(409,"Graduated pool mint mismatch.");await database().prepare("UPDATE agent_custody SET graduated_pool=? WHERE agent_id=?").bind(graduated,launch.agent_id).run();}
 const sqrt=dammState?.sqrtPrice??pool.poolState.sqrtPrice,priceQuote=getPriceFromSqrtPrice(sqrt,9,launch.quote_decimals).toNumber();
 return {launch,dbc,pool,curve,graduated,dammState,priceQuote};
}
export async function mintInfo(mint:string){const connection=rpc(),address=pubkey(mint),account=await connection.getAccountInfo(address);if(!account)throw new HttpError(409,"Token mint is unavailable.");return {mint:await getMint(connection,address,"confirmed",account.owner),program:account.owner};}
