// Local operator CLI only. Never expose this through an HTTP route.
import {DatabaseSync} from 'node:sqlite';
import {createDecipheriv,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';

export const REQUEST=Object.freeze({id:'thicc-test-recovery-2026-10-05-600',mint:'3QEbHMK6ceYevtaCdLmBQMJgcPb9PJQpgyFBP6f6x6Rg',destination:'3eZ3dsnUHp7aHrAA5FZPuiy8yXSq5wPuwNVzvn1gQzE4',usd:600});
const SOL='So11111111111111111111111111111111111111112',KEEP=20_000_000n;
const BUCKETS=['compound','compute','reserve','buyback'];
export function quoteAmount(p,now=Date.now()) {
 if(!p||!Number.isFinite(p.solPrice)||p.solPrice<=0||p.stale!==false||!Number.isSafeInteger(p.asOfTimestamp)||now-p.asOfTimestamp>60000||p.asOfTimestamp>now+5000)throw new Error('Fresh SOL/USD price unavailable. No transfer prepared.');
 const amount=Math.floor(REQUEST.usd/p.solPrice*1e9);
 if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Invalid recovery amount.');
 return BigInt(amount);
}
export function allocate(amount,balances) {
 let left=amount;const parts=[];
 for(const bucket of BUCKETS){const available=balances.get(bucket)||0n;if(available<0n)throw new Error('Negative fee allocation; reconcile accounting first.');const n=left<available?left:available;if(n>0n)parts.push({bucket,amount:n.toString()});left-=n;}
 if(left>0n)throw new Error('Insufficient unspent earned fees for $600. No transfer prepared.');
 return parts;
}
function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function event(db,agent,message){db.prepare('INSERT INTO events(id,owner,agent_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),agent.owner,agent.id,'test_fee_recovery',message,Date.now());}
export function journal(db){db.exec(`CREATE TABLE IF NOT EXISTS operator_recoveries(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,destination TEXT NOT NULL,amount TEXT NOT NULL,price REAL NOT NULL,wire TEXT NOT NULL,signature TEXT NOT NULL,last_valid_height INTEGER NOT NULL,status TEXT NOT NULL,debits TEXT NOT NULL,created_at INTEGER NOT NULL)`);}
export function saveRecovery(db,agent,record,cancellations){
 atomic(db,()=>{
  if(db.prepare('SELECT id FROM operator_recoveries WHERE id=?').get(REQUEST.id))throw new Error('Recovery already exists; rerun to reconcile it.');
  for(const job of cancellations){
   const bucket=JSON.parse(job.context_json).bucket|| (job.kind==='compute'?'compute':job.kind==='buyback'?'buyback':job.kind==='gas'?'reserve':null);
   if(!BUCKETS.includes(bucket))throw new Error('Unsupported pending job; reconcile it before recovery.');
   db.prepare("UPDATE execution_jobs SET status='cancelled',last_error='Cancelled before signing for operator test-fee recovery',updated_at=? WHERE id=? AND status='reserved'").run(Date.now(),job.id);
   db.prepare('INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)').run(`${REQUEST.id}:cancel:${job.id}`,agent.id,job.input_mint,bucket,job.input_amount,REQUEST.id,Date.now());
   if(job.kind==='compute'){
    const fundingId=JSON.parse(job.context_json).fundingId;
    if(db.prepare("SELECT id FROM execution_jobs WHERE kind='compute' AND json_extract(context_json,'$.fundingId')=? AND id!=? AND status!='cancelled'").get(fundingId,job.id))throw new Error('Shared funding request needs reconciliation before recovery.');
    db.prepare("UPDATE funding SET status='cancelled' WHERE id=?").run(fundingId);
   }
  }
  db.prepare('INSERT INTO operator_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(REQUEST.id,agent.id,REQUEST.destination,record.amount,record.price,record.wire,record.signature,record.height,'prepared',JSON.stringify(record.debits),Date.now());
  for(const part of record.debits)db.prepare('INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)').run(`${REQUEST.id}:${part.bucket}`,agent.id,SOL,part.bucket,(-BigInt(part.amount)).toString(),REQUEST.id,Date.now());
  const compute=record.debits.find(p=>p.bucket==='compute');
  if(compute?.usdMicros>0)db.prepare('INSERT INTO compute_budget_grants(id,agent_id,usd_micros,created_at) VALUES(?,?,?,?)').run(`${REQUEST.id}:budget`,agent.id,-compute.usdMicros,Date.now());
  db.prepare("UPDATE agents SET status='recovery_hold',lease_until=0 WHERE id=?").run(agent.id);
  event(db,agent,`Operator prepared a $600 test-fee recovery to ${REQUEST.destination}. Agent paused; locked LP untouched.`);
 });
}
export function finish(db,agent,row,status){
 atomic(db,()=>{
  const current=db.prepare('SELECT status FROM operator_recoveries WHERE id=?').get(row.id);
  if(['finalized','failed','expired'].includes(current.status))return;
  db.prepare('UPDATE operator_recoveries SET status=? WHERE id=?').run(status,row.id);
  if(status!=='finalized')for(const part of JSON.parse(row.debits))db.prepare('INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,?,?,?,?)').run(`${row.id}:release:${part.bucket}`,agent.id,SOL,part.bucket,part.amount,row.id,Date.now());
  const compute=JSON.parse(row.debits).find(p=>p.bucket==='compute');
  if(status!=='finalized'&&compute?.usdMicros>0)db.prepare('INSERT INTO compute_budget_grants(id,agent_id,usd_micros,created_at) VALUES(?,?,?,?)').run(`${row.id}:budget-release`,agent.id,compute.usdMicros,Date.now());
  event(db,agent,`Test-fee recovery ${status}: ${row.signature}. Agent remains paused.`);
 });
}
export async function settle(db,agent,row,rpc){
 if(['finalized','failed','expired'].includes(row.status))return row.status;
 const status=(await rpc.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];
 if(status?.confirmationStatus==='finalized'){
  const receipt=await rpc.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!receipt)return 'submitted';
  const state=receipt.meta?.err?'failed':'finalized';if(!receipt.meta)return 'submitted';
  finish(db,agent,row,state);return state;
 }
 if(status)return 'submitted';
 if(await rpc.getBlockHeight('finalized')>row.last_valid_height){finish(db,agent,row,'expired');return 'expired';}
 // Only the persisted, fully signed wire is ever broadcast on a retry.
 const tx=Transaction.from(Buffer.from(row.wire,'base64'));
 if(!tx.verifySignatures()||bs58.encode(tx.signature)!==row.signature||tx.instructions.length!==1)throw new Error('Recovery journal signature mismatch.');
 const ix=SystemProgram.programId.equals(tx.instructions[0].programId)&&tx.instructions[0];
 if(!ix||ix.keys[0].pubkey.toBase58()!==agent.wallet||ix.keys[1].pubkey.toBase58()!==REQUEST.destination||ix.data.readUInt32LE(0)!==2||ix.data.readBigUInt64LE(4)!==BigInt(row.amount))throw new Error('Recovery journal instruction mismatch.');
 db.prepare("UPDATE operator_recoveries SET status='submitted' WHERE id=?").run(row.id);
 try{const signature=await rpc.sendRawTransaction(Buffer.from(row.wire,'base64'),{skipPreflight:false,maxRetries:2});if(signature!==row.signature)throw new Error('Unexpected signature.');}catch{console.log('Submission unresolved. Rerun the same command; it will check/reuse the same transaction.');}
 return 'submitted';
}
export async function main(args=process.argv.slice(2)){
 if(args.some(v=>v!=='--send'))throw new Error('Usage: node deploy/recover-test-fees.bundle.cjs [--send]');
 const send=args.includes('--send'),path=process.env.DATABASE_PATH||'/data/thicc.sqlite';
 if(!existsSync(path))throw new Error('Production database not found. Run inside the Dokploy web container.');
 if(!process.env.QUICKNODE_RPC_URL)throw new Error('QuickNode RPC is not configured in this container.');
 const db=new DatabaseSync(path,{readOnly:!send});db.exec('PRAGMA busy_timeout=5000');
 const rpc=new Connection(process.env.QUICKNODE_RPC_URL,'finalized'),locks=[],token=randomUUID();let heartbeat;
 try{
  const agent=db.prepare('SELECT a.id,a.owner,a.status,a.lease_until,c.wallet,c.encrypted_key FROM agents a JOIN agent_custody c ON c.agent_id=a.id JOIN launches l ON l.mint=c.base_mint AND l.pool_address=a.pool_address WHERE c.base_mint=? AND l.verified_at IS NOT NULL LIMIT 1').get(REQUEST.mint);
  if(!agent)throw new Error('Verified THICC test agent not found.');
  if(agent.wallet===REQUEST.destination)throw new Error('Source equals destination.');
  if(send){
   if(process.env.EXECUTION_PAUSED!=='true')throw new Error('Set EXECUTION_PAUSED=true in Dokploy and redeploy web + worker before sending.');
   if(agent.lease_until>Date.now())throw new Error('An AI cycle is still active. Wait and rerun.');
   atomic(db,()=>{for(const id of ['worker','claim-cycle',`agent:${agent.id}`]){const now=Date.now();const r=db.prepare('INSERT INTO runtime_locks(id,token,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE runtime_locks.expires_at<?').run(id,token,now+180000,now);if(!r.changes)throw new Error('Worker is still finishing a cycle. Wait and rerun.');locks.push(id);}});
   heartbeat=setInterval(()=>{for(const id of locks)db.prepare('UPDATE runtime_locks SET expires_at=? WHERE id=? AND token=?').run(Date.now()+180000,id,token);},30000);heartbeat.unref();
  }
  const hasJournal=db.prepare("SELECT name FROM sqlite_master WHERE name='operator_recoveries'").get();
  const existing=hasJournal&&db.prepare('SELECT * FROM operator_recoveries WHERE id=?').get(REQUEST.id);
  if(existing){
   if(existing.agent_id!==agent.id||existing.destination!==REQUEST.destination)throw new Error('Recovery request mismatch.');
   const state=send?await settle(db,agent,existing,rpc):existing.status;
   console.log(JSON.stringify({status:state,destination:existing.destination,sol:Number(existing.amount)/1e9,signature:existing.signature,explorer:`https://solscan.io/tx/${existing.signature}`},null,2));return;
  }
  if(db.prepare("SELECT id FROM chain_operations WHERE agent_id=? AND status IN ('prepared','submitted') LIMIT 1").get(agent.id))throw new Error('An earlier agent transaction is unresolved. Let the worker reconcile it before pausing and recovering.');
  const jobs=db.prepare("SELECT * FROM execution_jobs WHERE agent_id=? AND status NOT IN ('complete','cancelled')").all(agent.id);
  for(const job of jobs)if(job.status!=='reserved'||job.input_mint!==SOL||!['compute','buyback','gas','compound_swap'].includes(job.kind)||db.prepare('SELECT id FROM chain_operations WHERE agent_id=? AND substr(purpose,1,?)=? LIMIT 1').get(agent.id,job.id.length+1,`${job.id}:`))throw new Error('A pending job already started. Let the worker finish/reconcile it before recovery.');
  const balances=new Map();for(const e of db.prepare('SELECT bucket,amount FROM asset_entries WHERE agent_id=? AND mint=?').all(agent.id,SOL))balances.set(e.bucket,(balances.get(e.bucket)||0n)+BigInt(e.amount));
  for(const job of jobs){const b=JSON.parse(job.context_json).bucket||(job.kind==='compute'?'compute':job.kind==='buyback'?'buyback':job.kind==='gas'?'reserve':null);if(!BUCKETS.includes(b))throw new Error('Unrecognized job allocation.');balances.set(b,(balances.get(b)||0n)+BigInt(job.input_amount));}
  const response=await fetch('https://frontend-api-v3.pump.fun/sol-price',{signal:AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok)throw new Error('SOL price unavailable.');
  const price=await response.json(),amount=quoteAmount(price),debits=allocate(amount,balances),source=new PublicKey(agent.wallet),destination=new PublicKey(REQUEST.destination);
  const compute=debits.find(p=>p.bucket==='compute');
  if(compute){
   const budget=db.prepare('SELECT (SELECT COALESCE(SUM(compute_micros),0) FROM fee_receipts WHERE agent_id=?)+(SELECT COALESCE(SUM(usd_micros),0) FROM compute_budget_grants WHERE agent_id=?)-(SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0)*1000000 FROM model_calls WHERE agent_id=?) AS remaining').get(agent.id,agent.id,agent.id);
   compute.usdMicros=Math.max(0,Math.min(Math.floor(budget.remaining),Math.floor(Number(compute.amount)/1e9*price.solPrice*1e6)));
   if(!Number.isSafeInteger(compute.usdMicros))throw new Error('Compute accounting exceeds safe precision.');
  }
  if(!PublicKey.isOnCurve(destination.toBytes()))throw new Error('Recipient must be a normal Solana wallet.');
  const recipient=await rpc.getAccountInfo(destination,'finalized');
  if(recipient&&(recipient.executable||!recipient.owner.equals(SystemProgram.programId)||recipient.data.length!==0))throw new Error('Recipient is not a native SOL wallet account.');
  const balance=BigInt(await rpc.getBalance(source,'finalized'));
  const latest=await rpc.getLatestBlockhash('confirmed'),tx=new Transaction({feePayer:source,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight}).add(SystemProgram.transfer({fromPubkey:source,toPubkey:destination,lamports:amount}));
  const fee=(await rpc.getFeeForMessage(tx.compileMessage(),'confirmed')).value;if(fee===null)throw new Error('Network fee unavailable.');
  if(balance<amount+KEEP+BigInt(fee))throw new Error(`Insufficient native SOL. Balance ${(Number(balance)/1e9).toFixed(9)} SOL; need ${(Number(amount+KEEP+BigInt(fee))/1e9).toFixed(9)} SOL including gas reserve. No LP will be withdrawn.`);
  console.log(JSON.stringify({mode:send?'send':'preview',mint:REQUEST.mint,source:agent.wallet,destination:REQUEST.destination,usd:REQUEST.usd,sol:Number(amount)/1e9,solPrice:price.solPrice,remainingSol:Number(balance-amount-BigInt(fee))/1e9,unsignedJobsToCancel:jobs.length,agentWillRemainPaused:true,lpUntouched:true},null,2));
  if(!send){console.log('Preview only. No key decrypted and no funds moved.');return;}
  const key=Buffer.from(process.env.AGENT_WALLET_ENCRYPTION_KEY||'','base64');if(key.length!==32)throw new Error('Invalid agent encryption key configuration.');
  const [version,iv,tag,data,...extra]=agent.encrypted_key.split('.');if(version!=='v1'||extra.length)throw new Error('Invalid custody envelope.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(`agent:${agent.id}`));decipher.setAuthTag(Buffer.from(tag,'base64'));
  const secret=Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]);const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret.toString())));secret.fill(0);key.fill(0);
  if(!signer.publicKey.equals(source))throw new Error('Agent signing key does not match the source wallet.');tx.sign(signer);signer.secretKey.fill(0);
  const simulation=await rpc.simulateTransaction(VersionedTransaction.deserialize(tx.serialize()),{sigVerify:true,commitment:'confirmed'});if(simulation.value.err)throw new Error('Recovery simulation failed. No funds sent.');
  quoteAmount(price); // Refuse stale pricing after a slow RPC/simulation.
  const backupDir=join(dirname(path),'backups');mkdirSync(backupDir,{recursive:true});db.prepare('VACUUM INTO ?').run(join(backupDir,`before-test-recovery-${Date.now()}.sqlite`));
  journal(db);saveRecovery(db,agent,{amount:amount.toString(),price:price.solPrice,wire:tx.serialize().toString('base64'),signature:bs58.encode(tx.signature),height:latest.lastValidBlockHeight,debits},jobs);
  const row=db.prepare('SELECT * FROM operator_recoveries WHERE id=?').get(REQUEST.id);const status=await settle(db,agent,row,rpc);
  console.log(JSON.stringify({status,signature:row.signature,explorer:`https://solscan.io/tx/${row.signature}`,next:'Rerun the same --send command until finalized. Never change the recovery ID.'},null,2));
 }finally{clearInterval(heartbeat);for(const id of locks)db.prepare('DELETE FROM runtime_locks WHERE id=? AND token=?').run(id,token);db.close();}
}
