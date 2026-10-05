import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {REQUEST,quoteAmount,allocate,journal,saveRecovery,finish,settle} from './recover-test-fees.mjs';

const SOL='So11111111111111111111111111111111111111112';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`
 CREATE TABLE agents(id TEXT PRIMARY KEY,status TEXT,lease_until INTEGER);
 CREATE TABLE asset_entries(id TEXT PRIMARY KEY,agent_id TEXT,mint TEXT,bucket TEXT,amount TEXT,operation_id TEXT,created_at INTEGER);
 CREATE TABLE events(id TEXT,owner TEXT,agent_id TEXT,kind TEXT,message TEXT,created_at INTEGER);
 CREATE TABLE execution_jobs(id TEXT PRIMARY KEY,agent_id TEXT,kind TEXT,status TEXT,input_mint TEXT,input_amount TEXT,context_json TEXT,last_error TEXT,updated_at INTEGER);
 CREATE TABLE funding(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE compute_budget_grants(id TEXT PRIMARY KEY,agent_id TEXT,usd_micros INTEGER,created_at INTEGER);
 INSERT INTO agents VALUES('agent','active',0);
 INSERT INTO asset_entries VALUES('earned','agent','${SOL}','compound','6000000000',NULL,0);
 `);journal(db);return db;
}
const agent={id:'agent',owner:'operator',wallet:Keypair.generate().publicKey.toBase58()};
const record={amount:'5000000000',price:120,wire:'unused',signature:'test-signature',height:10,debits:[{bucket:'compound',amount:'5000000000'}]};
const balance=db=>db.prepare('SELECT amount FROM asset_entries').all().reduce((s,r)=>s+BigInt(r.amount),0n);

test('recovery pins requested destination and USD amount and rejects stale prices or insufficient fees',()=>{
 assert.equal(REQUEST.destination,'3eZ3dsnUHp7aHrAA5FZPuiy8yXSq5wPuwNVzvn1gQzE4');assert.equal(REQUEST.usd,600);
 assert.equal(quoteAmount({solPrice:120,stale:false,asOfTimestamp:100000},100000),5000000000n);
 assert.throws(()=>quoteAmount({solPrice:120,stale:false,asOfTimestamp:0},100000));
 assert.throws(()=>quoteAmount({solPrice:NaN,stale:false,asOfTimestamp:100000},100000));
 assert.throws(()=>allocate(5n,new Map([['compound',4n],['recycle',100n],['burn',100n]])));
 assert.deepEqual(allocate(5n,new Map([['compound',3n],['compute',4n]])),[{bucket:'compound',amount:'3'},{bucket:'compute',amount:'2'}]);
});
test('recovery reservation is atomic, leaves an audit event, holds the agent and cannot double debit',()=>{
 const db=fixture();try{saveRecovery(db,agent,record,[]);assert.equal(balance(db),1000000000n);assert.equal(db.prepare('SELECT status FROM agents').get().status,'recovery_hold');assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,1);assert.throws(()=>saveRecovery(db,agent,record,[]));assert.equal(balance(db),1000000000n);}finally{db.close();}
});
test('unsigned compute cancellation refunds the allocation and cancels its funding request atomically',()=>{
 const db=fixture();try{
  db.exec(`INSERT INTO funding VALUES('fund','awaiting_executor');INSERT INTO execution_jobs VALUES('job','agent','compute','reserved','${SOL}','100000000','{"fundingId":"fund"}',NULL,0);INSERT INTO asset_entries VALUES('reservation','agent','${SOL}','compute','-100000000','job',0);INSERT INTO asset_entries VALUES('compute-income','agent','${SOL}','compute','100000000',NULL,0);`);
  const job=db.prepare('SELECT * FROM execution_jobs').get();saveRecovery(db,agent,record,[job]);assert.equal(db.prepare('SELECT status FROM execution_jobs').get().status,'cancelled');assert.equal(db.prepare('SELECT status FROM funding').get().status,'cancelled');assert.equal(balance(db),1100000000n);
 }finally{db.close();}
});
test('shared funding cancellation rolls back the whole recovery',()=>{
 const db=fixture();try{
  db.exec(`INSERT INTO funding VALUES('fund','awaiting_executor');INSERT INTO execution_jobs VALUES('job','agent','compute','reserved','${SOL}','100','{"fundingId":"fund"}',NULL,0);INSERT INTO execution_jobs VALUES('other','other-agent','compute','reserved','${SOL}','100','{"fundingId":"fund"}',NULL,0);`);
  assert.throws(()=>saveRecovery(db,agent,record,[db.prepare("SELECT * FROM execution_jobs WHERE id='job'").get()]));assert.equal(db.prepare('SELECT COUNT(*) n FROM operator_recoveries').get().n,0);assert.equal(db.prepare("SELECT status FROM execution_jobs WHERE id='job'").get().status,'reserved');assert.equal(balance(db),6000000000n);
 }finally{db.close();}
});
test('withdrawn compute budget is removed and only restored if recovery fails',()=>{
 const db=fixture();try{
  db.exec("INSERT INTO asset_entries VALUES('compute','agent','"+SOL+"','compute','1000000000',NULL,0)");
  const value={...record,debits:[{bucket:'compute',amount:'1000000000',usdMicros:120000000},{bucket:'compound',amount:'4000000000'}]};saveRecovery(db,agent,value,[]);
  assert.equal(db.prepare('SELECT SUM(usd_micros) amount FROM compute_budget_grants').get().amount,-120000000);
  const row=db.prepare('SELECT * FROM operator_recoveries').get();finish(db,agent,row,'failed');finish(db,agent,row,'failed');assert.equal(db.prepare('SELECT SUM(usd_micros) amount FROM compute_budget_grants').get().amount,0);
 }finally{db.close();}
});
test('finalized recovery never resends; failed or expired recovery releases fees only once',async()=>{
 for(const status of ['finalized','failed','expired']){const db=fixture();try{saveRecovery(db,agent,record,[]);const row=db.prepare('SELECT * FROM operator_recoveries').get();finish(db,agent,row,status);finish(db,agent,row,status);assert.equal(balance(db),status==='finalized'?1000000000n:6000000000n);assert.equal(await settle(db,agent,db.prepare('SELECT * FROM operator_recoveries').get(),{}),status);}finally{db.close();}}
});
test('ambiguous submission retries exactly the same signed transaction and verifies finality before success',async()=>{
 const db=fixture(),signer=Keypair.generate(),source={...agent,wallet:signer.publicKey.toBase58()};
 try{
  const tx=new Transaction({feePayer:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:new (signer.publicKey.constructor)(REQUEST.destination),lamports:5000000000n}));tx.sign(signer);
  saveRecovery(db,source,{...record,wire:tx.serialize().toString('base64'),signature:bs58.encode(tx.signature)},[]);let finalized=false;const sent=[];
  const rpc={getSignatureStatuses:async()=>({value:[finalized?{confirmationStatus:'finalized',err:null}:null]}),getBlockHeight:async()=>1,sendRawTransaction:async wire=>{sent.push(Buffer.from(wire).toString('base64'));throw new Error('timeout');},getTransaction:async()=>({meta:{err:null}})};
  for(let i=0;i<2;i++)assert.equal(await settle(db,source,db.prepare('SELECT * FROM operator_recoveries').get(),rpc),'submitted');
  assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);finalized=true;assert.equal(await settle(db,source,db.prepare('SELECT * FROM operator_recoveries').get(),rpc),'finalized');assert.equal(sent.length,2);assert.equal(balance(db),1000000000n);
 }finally{db.close();}
});
