import {database} from "./server";
import {distributeClaim} from "./fee-distribution";
export type Bucket="compound"|"compute"|"reserve"|"buyback"|"burn"|"recycle";
export async function assetBalance(agent:string,mint:string,bucket:Bucket){const rows=await database().prepare("SELECT amount FROM asset_entries WHERE agent_id=? AND mint=? AND bucket=?").bind(agent,mint,bucket).all<{amount:string}>();return rows.results.reduce((s,r)=>s+BigInt(r.amount),0n);}
export async function recordAssetClaim(agent:string,signature:string,mint:string,amount:bigint,decimals:number,usdMicros:number|null,at:number){
 const db=database(),id=`${signature}:${mint}`;if(amount<=0n||await db.prepare("SELECT id FROM asset_claims WHERE id=?").bind(id).first())return;
 const previous=await db.prepare("SELECT amount FROM asset_claims WHERE agent_id=? AND mint=?").bind(agent,mint).all<{amount:string}>();
 const split=distributeClaim(amount,previous.results.reduce((s,r)=>s+BigInt(r.amount),0n));
 await db.batch([db.prepare("INSERT INTO asset_claims(id,agent_id,signature,mint,amount,decimals,usd_micros,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,agent,signature,mint,amount.toString(),decimals,usdMicros,at),
 ...([['buyback',split.buybackBurn],['compound',split.compound],['compute',split.compute],['reserve',split.reserve]] as [Bucket,bigint][]).map(([bucket,n])=>db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,created_at) VALUES(?,?,?,?,?,?)").bind(`${id}:${bucket}`,agent,mint,bucket,n.toString(),at))]);
}
export async function creditEntry(id:string,agent:string,mint:string,bucket:Bucket,amount:bigint,operationId:string){await database().prepare("INSERT OR IGNORE INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,agent,mint,bucket,amount.toString(),operationId,Date.now()).run();}
export type ExecutionJob={id:string;agent_id:string;kind:string;status:string;input_mint:string;input_amount:string;output_mint:string|null;output_amount:string|null;context_json:string;created_at:number;retry_at?:number};
export async function reserveJob(agent:string,kind:string,mint:string,amount:bigint,bucket:Bucket,outputMint:string|null,context:unknown={}){
 if(amount<=0n||amount>await assetBalance(agent,mint,bucket))throw new Error("Job exceeds its earned asset allocation.");
 const id=crypto.randomUUID(),now=Date.now(),db=database();await db.batch([
 db.prepare("INSERT INTO execution_jobs(id,agent_id,kind,status,input_mint,input_amount,output_mint,context_json,created_at,updated_at) VALUES(?,?,?,'reserved',?,?,?,?,?,?)").bind(id,agent,kind,mint,amount.toString(),outputMint,JSON.stringify(context),now,now),
 db.prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${id}:reserve`,agent,mint,bucket,(-amount).toString(),id,now)]);return id;
}
