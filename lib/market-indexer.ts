import {getAccount} from "@solana/spl-token";
import {database,pubkey,rpc} from "./server";
import {livePool,mintInfo} from "./pool-state";
import {assetPrice,historicalPrice} from "./asset-price";
import {poolSwapEvents} from "./market-events";
import {liveCache} from "./live-cache";
import {swapAmounts} from "./swap-event";
import DLMM from "@meteora-ag/dlmm";
type Cursor={newest_signature:string|null;before_signature:string|null;target_signature:string|null};
const blockOrder=new Map<number,string[]>();
export async function observePool(mint:string){
 const state=await livePool(mint),quote=await assetPrice(state.launch.quote_mint),connection=rpc(),now=Date.now(),slot=await connection.getSlot("finalized");
 let base=state.pool.poolState.baseReserve.toString(),reserve=state.pool.poolState.quoteReserve.toString();
 if(state.dammState){const [a,b]=await Promise.all([mintInfo(mint),mintInfo(state.launch.quote_mint)]);base=(await getAccount(connection,state.dammState.tokenAVault,"finalized",a.program)).amount.toString();reserve=(await getAccount(connection,state.dammState.tokenBVault,"finalized",b.program)).amount.toString();}
 const usd=state.priceQuote*quote.usdPrice,liquidity=Number(reserve)/10**state.launch.quote_decimals*quote.usdPrice+(state.graduated?Number(base)/1e9*usd:0);
 const db=database();await db.batch([
 db.prepare("INSERT OR IGNORE INTO price_observations(mint,observed_at,usd_price) VALUES(?,?,?)").bind(mint,now,usd),
 db.prepare("INSERT OR IGNORE INTO pool_observations(pool,observed_at,slot,price_quote,price_usd,liquidity_usd,quote_reserve,base_reserve) VALUES(?,?,?,?,?,?,?,?)").bind(state.graduated||state.launch.pool_address,now,slot,state.priceQuote,usd,liquidity,reserve,base)]);
 if(state.launch.dlmm_pool){const pool=await DLMM.create(connection,pubkey(state.launch.dlmm_pool)),active=await pool.getActiveBin(),price=Number(pool.fromPricePerLamport(Number(active.price)));if(pool.tokenX.publicKey.toBase58()!==mint||pool.tokenY.publicKey.toBase58()!==state.launch.quote_mint)throw new Error("Companion mint mismatch.");
  const tvl=Number(pool.tokenX.amount)/1e9*usd+Number(pool.tokenY.amount)/10**state.launch.quote_decimals*quote.usdPrice;await db.prepare("INSERT OR IGNORE INTO pool_observations(pool,observed_at,slot,price_quote,price_usd,liquidity_usd,quote_reserve,base_reserve) VALUES(?,?,?,?,?,?,?,?)").bind(state.launch.dlmm_pool,now,slot,price,price*quote.usdPrice,tvl,pool.tokenY.amount.toString(),pool.tokenX.amount.toString()).run();
 }
 return state;
}
async function indexPool(address:string,mint:string,quoteMint:string,quoteDecimals:number){
 const db=database(),connection=rpc();await db.prepare("INSERT OR IGNORE INTO pool_cursors(pool) VALUES(?)").bind(address).run();const cursor=(await db.prepare("SELECT * FROM pool_cursors WHERE pool=?").bind(address).first<Cursor>())!;
 const rows=await connection.getSignaturesForAddress(pubkey(address),{limit:100,before:cursor.before_signature||undefined,until:cursor.newest_signature||undefined},"finalized");
 const target=cursor.target_signature||rows[0]?.signature||cursor.newest_signature;
 // Keep the latest trades visible while walking an older backlog. The durable
 // cursor advances only after the complete page; inserts are idempotent on retry.
 const head=cursor.before_signature?await connection.getSignaturesForAddress(pubkey(address),{limit:25,until:cursor.target_signature||undefined},'finalized'):[];
 const unique=[...new Map([...head,...rows].map(r=>[r.signature,r])).values()];
 for(let offset=0;offset<unique.length;offset+=6){
 const batch=await Promise.all(unique.slice(offset,offset+6).filter(r=>!r.err).map(async row=>({row,tx:await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:1})})));
 for(const {row,tx} of batch){
  if(!tx)throw new Error("Finalized transaction not yet available; cursor remains unchanged.");
  if(!tx.blockTime)continue;
  const events=poolSwapEvents(tx,address);if(!events.length)continue;
  const reportedIndex=(tx as typeof tx & {transactionIndex?:number}).transactionIndex;
  let transactionIndex:number;
  if(Number.isSafeInteger(reportedIndex)&&reportedIndex!>=0)transactionIndex=reportedIndex!;
  else{if(!blockOrder.has(tx.slot)){const block=await connection.getBlockSignatures(tx.slot,"finalized");blockOrder.set(tx.slot,block.signatures);if(blockOrder.size>200)blockOrder.delete(blockOrder.keys().next().value!);}transactionIndex=blockOrder.get(tx.slot)!.indexOf(row.signature);}
  if(transactionIndex<0)throw new Error("Trade missing from finalized block.");
  for(const e of events){const amounts=swapAmounts(e);if(!amounts)continue;const {sell,base,quote,fee}=amounts;
   await db.prepare("INSERT OR IGNORE INTO raw_swaps(id,mint,quote_mint,quote_decimals,pool,signature,at,slot,transaction_index,instruction_index,side,base_amount,quote_amount,fee_quote) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(`${row.signature}:${e.index}`,mint,quoteMint,quoteDecimals,address,row.signature,tx.blockTime*1000,tx.slot,transactionIndex,e.index,sell?"sell":"buy",base.toString(),quote.toString(),fee.toString()).run();
  }
 }}
 if(rows.length===100)await db.prepare("UPDATE pool_cursors SET before_signature=?,target_signature=? WHERE pool=?").bind(rows.at(-1)!.signature,target,address).run();
 else await db.prepare("UPDATE pool_cursors SET newest_signature=?,before_signature=NULL,target_signature=NULL,last_indexed_at=? WHERE pool=?").bind(target,Date.now(),address).run();
}
async function readMarket(mint:string){
 const state=await observePool(mint);for(const pool of [state.launch.pool_address,state.graduated,state.launch.dlmm_pool].filter(Boolean) as string[])await indexPool(pool,mint,state.launch.quote_mint,state.launch.quote_decimals);
 const db=database(),pending=await db.prepare("SELECT r.* FROM raw_swaps r LEFT JOIN token_trades t ON t.id=r.id WHERE r.mint=? AND t.id IS NULL ORDER BY r.at DESC LIMIT 500").bind(mint).all<{id:string;quote_mint:string;quote_decimals:number;pool:string;signature:string;at:number;slot:number;transaction_index:number;instruction_index:number;side:string;base_amount:string;quote_amount:string;fee_quote:string}>();
 for(const r of pending.results){const price=await historicalPrice(r.quote_mint,r.at);if(price===null)continue;const volume=Number(BigInt(r.quote_amount))/10**r.quote_decimals*price,tokenPrice=volume/(Number(BigInt(r.base_amount))/1e9);if(!Number.isFinite(tokenPrice)||tokenPrice<=0)continue;
  await db.prepare("INSERT OR IGNORE INTO token_trades(id,mint,at,slot,transaction_index,instruction_index,price_usd,volume_usd,verified_at,side,quote_amount,base_amount,signature,pool,fee_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.id,mint,r.at,r.slot,r.transaction_index,r.instruction_index,tokenPrice,volume,Date.now(),r.side,r.quote_amount,r.base_amount,r.signature,r.pool,Number(BigInt(r.fee_quote))/10**r.quote_decimals*price).run();
 }
 return {mint,indexed:pending.results.length,bootstrap:!state.launch.dlmm_pool&&(!!state.graduated||state.pool.poolState.quoteReserve.gte(state.curve.migrationQuoteThreshold))};
}

const cachedMarket=liveCache<Awaited<ReturnType<typeof readMarket>>>(2000);
export function indexMarket(mint:string){return cachedMarket(mint,()=>readMarket(mint));}
