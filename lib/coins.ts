import {database,poolData,HttpError} from "./server";
import {coinDetail} from "./coin-detail";
export async function thiccCoins(url:URL){
 const q=(url.searchParams.get("q")||"").trim().slice(0,100),page=Math.max(1,Math.min(100,Math.floor(Number(url.searchParams.get("page"))||1)));
 const filter="verified_at IS NOT NULL AND pool_address IS NOT NULL AND (instr(lower(name),lower(?))>0 OR instr(lower(symbol),lower(?))>0 OR mint=? OR pool_address=?)";
 const count=await database().prepare(`SELECT count(*) AS total FROM launches WHERE ${filter}`).bind(q,q,q,q).first<{total:number}>();
 const rows=await database().prepare(`SELECT mint,pool_address,pool_kind FROM launches WHERE ${filter} ORDER BY created_at DESC LIMIT 12 OFFSET ?`).bind(q,q,q,q,(page-1)*12).all<{mint:string;pool_address:string;pool_kind:string}>();
 // Never fall back to the global Meteora directory. Only confirmed THICC records can enter this feed.
 const coins=await Promise.all(rows.results.map(row=>coinDetail(row.mint)));
 const data=await Promise.all(rows.results.filter(row=>row.pool_kind==="dlmm").map(async row=>{const p=await poolData(row.pool_address);if(p.token_x.address!==row.mint&&p.token_y.address!==row.mint)throw new HttpError(502,"Launch registry and pool mint do not match.");return p;}));
 const sort=url.searchParams.get("sort");if(sort==="tvl:desc")data.sort((a,b)=>b.tvl-a.tvl);else if(sort==="volume_24h:desc")data.sort((a,b)=>(b.volume["24h"]||0)-(a.volume["24h"]||0));else if(sort==="fee_24h:desc")data.sort((a,b)=>(b.fees["24h"]||0)-(a.fees["24h"]||0));
 const metric=sort==="tvl:desc"?"liquidityUsd":sort==="volume_24h:desc"?"volume24hUsd":sort==="fee_24h:desc"?"fees24hUsd":null;if(metric)coins.sort((a,b)=>(b[metric]??-1)-(a[metric]??-1));
 return {data,coins,total:count?.total||0,fetchedAt:Date.now(),scope:"verified-thicc-launches",sortScope:"page"};
}
