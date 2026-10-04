import {database,HttpError} from "./server";
/** Lease token protects release; signed operation journal protects retries beyond lease expiry. */
export async function withLock<T>(id:string,fn:()=>Promise<T>,duration=180000){
 const token=crypto.randomUUID(),now=Date.now(),db=database();
 const lock=await db.prepare("INSERT INTO runtime_locks(id,token,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE runtime_locks.expires_at<?").bind(id,token,now+duration,now).run();
 if(!lock.meta.changes)throw new HttpError(409,"This operation is already running. Please wait for its result.");
 const heartbeat=setInterval(()=>{void db.prepare("UPDATE runtime_locks SET expires_at=? WHERE id=? AND token=?").bind(Date.now()+duration,id,token).run().catch(()=>{});},Math.floor(duration/3));heartbeat.unref();
 try{return await fn();}finally{clearInterval(heartbeat);await db.prepare("DELETE FROM runtime_locks WHERE id=? AND token=?").bind(id,token).run();}
}
