import {getMint} from "@solana/spl-token";
import {database,HttpError,pubkey,rpc,poolData} from "./server";
import {solPrice} from "./sol-price";
import {SOL_MINT} from "./launch-economics";
import {curveProgress,EMPTY_COIN,type CoinDetail} from "./coin-types";
import {nativeAgentState} from "./native-agent";
export async function coinDetail(mint:string):Promise<CoinDetail>{
 pubkey(mint);
 const r=await database().prepare("SELECT * FROM launches WHERE mint=? AND verified_at IS NOT NULL LIMIT 1").bind(mint).first<{name:string;symbol:string;mint:string;pool_address:string;pool_kind:string;description:string|null;image_url:string|null;socials_json:string|null;model:string|null;quote_mint:string|null}>();
 if(!r)throw new HttpError(404,"This coin is not a verified THICC launch.");
 let socials:Record<string,string>={};try{socials=JSON.parse(r.socials_json||"{}");}catch{}
 const url=(value:unknown)=>typeof value==="string"&&value.startsWith("https://")?value:"";
 const detail:CoinDetail={...EMPTY_COIN,mint:r.mint,poolAddress:r.pool_address,name:r.name,symbol:r.symbol,description:r.description||"",imageUrl:url(r.image_url)||null,website:url(socials.website),twitter:url(socials.twitter),telegram:url(socials.telegram),model:r.model||"fable",quoteMint:r.quote_mint||SOL_MINT,quoteSymbol:r.quote_mint&&r.quote_mint!==SOL_MINT?"Quote":"SOL",status:"unavailable"};
 const custody=await database().prepare("SELECT c.wallet,c.agent_id,a.position_address FROM agent_custody c JOIN agents a ON a.id=c.agent_id WHERE c.base_mint=? AND a.pool_address=? LIMIT 1").bind(mint,r.pool_address).first<{wallet:string;agent_id:string;position_address:string}>();
 if(custody){
  detail.agentWallet=pubkey(custody.wallet).toBase58();detail.agentWalletVerified=false;
  try{await nativeAgentState(custody.agent_id,r.pool_address,custody.position_address);detail.agentWalletVerified=true;}catch{/* Keep the registered address visible, with verification explicitly pending. */}
 }
 try{
  const sol=await solPrice();detail.graduationUsd=250*sol.solPrice;
  if(r.pool_kind==="dbc"){
   const {DynamicBondingCurveClient,getPriceFromSqrtPrice}=await import("@meteora-ag/dynamic-bonding-curve-sdk");
   const connection=rpc(),client=new DynamicBondingCurveClient(connection,"finalized"),pool=await client.state.getPool(r.pool_address);
   if(!pool||pool.poolState.baseMint.toBase58()!==mint)throw new Error("Coin mint mismatch");const config=await client.state.getPoolConfig(pool.poolState.config);if(!config)throw new Error("Curve configuration unavailable");
   const progress=curveProgress(BigInt(pool.poolState.quoteReserve.toString()),BigInt(config.migrationQuoteThreshold.toString()),pool.poolState.isMigrated!==0);
   detail.bondingPct=progress.percent;detail.status=progress.status;detail.quoteMint=config.quoteMint.toBase58();detail.quoteSymbol=detail.quoteMint===SOL_MINT?"SOL":"Quote";
   if(detail.quoteMint===SOL_MINT){const priceQuote=getPriceFromSqrtPrice(pool.poolState.sqrtPrice,config.tokenDecimal,9).toNumber();detail.priceUsd=priceQuote*sol.solPrice;const mintInfo=await connection.getAccountInfo(pubkey(mint),"finalized");if(mintInfo){const token=await getMint(connection,pubkey(mint),"finalized",mintInfo.owner);detail.marketCapUsd=Number(token.supply)/10**token.decimals*detail.priceUsd;}}
   detail.observedAt=Date.now();
  }else{
   const p=await poolData(r.pool_address);if(p.token_x.address!==mint&&p.token_y.address!==mint)throw new Error("Coin mint mismatch");const token=p.token_x.address===mint?p.token_x:p.token_y;
   detail.priceUsd=token.price;detail.liquidityUsd=p.tvl;detail.volume24hUsd=p.volume["24h"]??null;detail.fees24hUsd=p.fees["24h"]??null;detail.observedAt=Date.now();
   // A live AMM is not proof that a bonding curve graduated. Graduation awaits the verified indexer.
  }
 }catch{detail.dataError="Some live market data is temporarily unavailable.";}
 return detail;
}
