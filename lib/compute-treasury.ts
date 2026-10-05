import {database,event} from './server';
import {withLock} from './runtime-lock';
import {computeTargetPct,computeTransfer} from './compute-allocation';

/** Reassign only unreserved earned token units, atomically with their budget
 * grant. Previously funded/spent allocations are never clawed back. */
export async function rebalanceComputeTreasury(agent:string){return withLock(`agent:${agent}`,async()=>{
 const db=database(),now=Date.now();
 const claims=await db.prepare('SELECT mint,amount,usd_micros FROM asset_claims WHERE agent_id=?').bind(agent).all<{mint:string;amount:string;usd_micros:number|null}>();
 const totals=new Map<string,{amount:bigint;usd:number}>();
 for(const c of claims.results){if(c.usd_micros===null)continue;const old=totals.get(c.mint)||{amount:0n,usd:0};totals.set(c.mint,{amount:old.amount+BigInt(c.amount),usd:old.usd+c.usd_micros});}
 const entries=await db.prepare("SELECT mint,bucket,amount FROM asset_entries WHERE agent_id=? AND bucket NOT IN ('burn','recycle')").bind(agent).all<{mint:string;bucket:string;amount:string}>();
 const balances=new Map<string,Map<string,bigint>>(),assigned=new Map<string,bigint>();let treasuryUsd=0,claimedUsd=0;
 for(const e of entries.results){const balancesForMint=balances.get(e.mint)||new Map<string,bigint>();const n=BigInt(e.amount);balancesForMint.set(e.bucket,(balancesForMint.get(e.bucket)||0n)+n);balances.set(e.mint,balancesForMint);if(e.bucket==='compute'&&n>0n)assigned.set(e.mint,(assigned.get(e.mint)||0n)+n);}
 for(const [mint,t] of totals){claimedUsd+=t.usd/1e6;const balance=[...(balances.get(mint)?.values()||[])].reduce((s,n)=>s+n,0n);if(t.amount>0n)treasuryUsd+=Number(balance)*t.usd/Number(t.amount)/1e6;}
 const usage=await db.prepare('SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN created_at>? THEN COALESCE(cost_usd,reserved_usd) ELSE 0 END),0) usd FROM model_calls WHERE agent_id=?').bind(now-3600000,agent).first<{usd:number;count:number}>();
 const targetPct=computeTargetPct(Math.max(0,treasuryUsd),usage?.usd||0,claimedUsd,(usage?.count||0)>0);let allocatedMicros=0;
 for(const [mint,t] of totals){if(t.amount<=0n)continue;const b=balances.get(mint)||new Map<string,bigint>();const move=computeTransfer(t.amount,assigned.get(mint)||0n,b.get('compound')||0n,b.get('reserve')||0n,targetPct),amount=move.fromCompound+move.fromReserve;if(amount<=0n)continue;
  const usdMicros=Number(amount*BigInt(t.usd)/t.amount);if(!Number.isSafeInteger(usdMicros)||usdMicros<0)throw new Error('Compute budget valuation out of range.');
  const id=crypto.randomUUID();await db.batch([
   db.prepare('INSERT INTO compute_budget_grants(id,agent_id,usd_micros,created_at) VALUES(?,?,?,?)').bind(id,agent,usdMicros,now),
   ...([['compound',-move.fromCompound],['reserve',-move.fromReserve],['compute',amount]] as const).map(([bucket,n])=>db.prepare('INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(`${id}:${bucket}`,agent,mint,bucket,n.toString(),id,now))
  ]);allocatedMicros+=usdMicros;
 }
 if(allocatedMicros>0){const owner=await db.prepare('SELECT owner FROM agents WHERE id=?').bind(agent).first<{owner:string}>();if(owner)await event(owner.owner,agent,'compute_allocated',`Assigned $${(allocatedMicros/1e6).toFixed(2)} more in earned-fee budget to AI. Current target: ${targetPct.toFixed(1)}%; buyback and reserve allocations remain protected.`);}
 return {targetPct,treasuryUsd,allocatedMicros};
});}
