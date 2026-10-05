import {liveCache} from "./live-cache";
import {getMint} from "@solana/spl-token";
import {config,database,HttpError,pubkey,rpc,poolData} from "./server";
import {solPrice} from "./sol-price";
import {SOL_MINT} from "./launch-economics";
import {curveProgress,EMPTY_COIN,type CoinDetail} from "./coin-types";
import {nativeAgentState} from "./native-agent";
import {nativeLaunchFeeBps} from "./launch-fee";
async function readCoinDetail(mint:string):Promise<CoinDetail>{
 pubkey(mint);
 const r=await database().prepare("SELECT * FROM launches WHERE mint=? AND verified_at IS NOT NULL LIMIT 1").bind(mint).first<{name:string;symbol:string;mint:string;pool_address:string;pool_kind:string;description:string|null;image_url:string|null;socials_json:string|null;model:string|null;quote_mint:string|null}>();
 if(!r)throw new HttpError(404,"This coin is not a verified THICC launch.");
 let socials:Record<string,string>={};try{socials=JSON.parse(r.socials_json||"{}");}catch{}
 const url=(value:unknown)=>typeof value==="string"&&value.startsWith("https://")?value:"";
 const detail:CoinDetail={...EMPTY_COIN,mint:r.mint,poolAddress:r.pool_address,name:r.name,symbol:r.symbol,description:r.description||"",imageUrl:url(r.image_url)||null,website:url(socials.website)||`${config("APP_ORIGIN")||"https://thicc.money"}/token/${r.mint}`,twitter:url(socials.twitter),telegram:url(socials.telegram),model:r.model||"fable",quoteMint:r.quote_mint||SOL_MINT,quoteSymbol:r.quote_mint&&r.quote_mint!==SOL_MINT?"Quote":"SOL",status:"unavailable"};
 const custody=await database().prepare("SELECT c.wallet,c.agent_id,a.position_address FROM agent_custody c JOIN agents a ON a.id=c.agent_id WHERE c.base_mint=? AND a.pool_address=? LIMIT 1").bind(mint,r.pool_address).first<{wallet:string;agent_id:string;position_address:string}>();
 if(custody){
  detail.agentWallet=pubkey(custody.wallet).toBase58();detail.agentWalletVerified=false;
  try{await nativeAgentState(custody.agent_id,r.pool_address,custody.position_address);detail.agentWalletVerified=true;}catch{/* Keep the registered address visible, with verification explicitly pending. */}
 }
 try{
  const sol=await solPrice();detail.graduationUsd=250*sol.solPrice;
  if(r.pool_kind==="dbc"){
   const {livePool}=await import("./pool-state"),{assetPrice}=await import("./asset-price");const state=await livePool(mint),quote=await assetPrice(state.launch.quote_mint);
   detail.initialFeeBps=nativeLaunchFeeBps(state.curve);
   const progress=curveProgress(BigInt(state.pool.poolState.quoteReserve.toString()),BigInt(state.curve.migrationQuoteThreshold.toString()),!!state.graduated);
   detail.poolAddress=state.graduated||state.launch.pool_address;detail.bondingPct=progress.percent;detail.status=progress.status;detail.quoteMint=state.launch.quote_mint;detail.quoteSymbol=detail.quoteMint===SOL_MINT?"SOL":"Quote";
   detail.priceUsd=state.priceQuote*quote.usdPrice;detail.marketCapUsd=1_000_000_000*detail.priceUsd;detail.graduationUsd=state.launch.graduation_quote*quote.usdPrice;
   const observation=await database().prepare("SELECT liquidity_usd,observed_at FROM pool_observations WHERE pool=? ORDER BY observed_at DESC LIMIT 1").bind(state.graduated||state.launch.pool_address).first<{liquidity_usd:number;observed_at:number}>();
   if(observation&&Date.now()-observation.observed_at<120000)detail.liquidityUsd=observation.liquidity_usd;
   const stats=await database().prepare("SELECT COALESCE(SUM(volume_usd),0) volume,COALESCE(SUM(fee_usd),0) fees FROM token_trades WHERE mint=? AND at>?").bind(mint,Date.now()-86400000).first<{volume:number;fees:number}>();
   const coverage=await database().prepare("SELECT last_indexed_at FROM pool_cursors WHERE pool=?").bind(state.graduated||state.launch.pool_address).first<{last_indexed_at:number|null}>();
   const unpriced=await database().prepare("SELECT COUNT(*) n FROM raw_swaps r LEFT JOIN token_trades t ON t.id=r.id WHERE r.mint=? AND r.at>? AND t.id IS NULL").bind(mint,Date.now()-86400000).first<{n:number}>();
   if(coverage?.last_indexed_at&&Date.now()-coverage.last_indexed_at<120000&&!unpriced?.n){detail.volume24hUsd=stats?.volume??0;detail.fees24hUsd=stats?.fees??0;}detail.observedAt=Date.now();
  }else{
   const p=await poolData(r.pool_address);if(p.token_x.address!==mint&&p.token_y.address!==mint)throw new Error("Coin mint mismatch");const token=p.token_x.address===mint?p.token_x:p.token_y;
   detail.priceUsd=token.price;detail.liquidityUsd=p.tvl;detail.volume24hUsd=p.volume["24h"]??null;detail.fees24hUsd=p.fees["24h"]??null;detail.observedAt=Date.now();
   // A live AMM is not proof that a bonding curve graduated. Graduation awaits the verified indexer.
  }
 }catch{detail.dataError="Some live market data is temporarily unavailable.";}
 return detail;
}

const cachedCoin=liveCache<CoinDetail>(2000);
export function coinDetail(mint:string){return cachedCoin(mint,()=>readCoinDetail(mint));}
