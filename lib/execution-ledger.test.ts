import {test,after} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {pathToFileURL} from "node:url";
import {Keypair,SystemProgram,Transaction,VersionedTransaction,type Connection} from "@solana/web3.js";
import bs58 from "bs58";
import {migrate} from "../deploy/migrate.mjs";
const directory=mkdtempSync(join(tmpdir(),"thicc-execution-test-"));
process.env.DATABASE_PATH=join(directory,"test.sqlite");process.env.THICC_RUNTIME="node";process.env.QUICKNODE_RPC_URL="https://rpc.invalid.test";
migrate(process.env.DATABASE_PATH,resolve("drizzle"));
registerHooks({resolve(specifier,context,next){return specifier==="cloudflare:workers"?{url:pathToFileURL(resolve("lib/dokploy-env.ts")).href,shortCircuit:true}:next(specifier,context);}});
const {nodeDatabase:db,closeNodeDatabase}=await import("./node-database");
const {recordAssetClaim,assetBalance,reserveJob}=await import("./asset-ledger");
const {prepareOperation,submitOperation,reconcileOperation,operation}=await import("./chain-journal");
const {reserveCollectionCheck}=await import('./collection-schedule');
const {withLock}=await import('./runtime-lock');
const {ingestClaim}=await import('./fee-claimer');
const {activationProgress}=await import('./fee-types');
const originalFetch=globalThis.fetch;

test('replays the real legacy claim exactly once, excluding launch gas and awaiting historical valuation',async()=>{
 const tx=JSON.parse(readFileSync(new URL('./fixtures/dbc-legacy-claim.json',import.meta.url),'utf8'));
 const signature=tx.transaction.signatures[0],wallet='8ci26pPM1kzNDwRDrhFPKo45FauVt19is2UNJkgUve8h',quote='So11111111111111111111111111111111111111112',at=tx.blockTime*1000;
 const context={pool:'EzJDWosWjvABsiDkYcFLR6P33FEj9rg3YGfDsyp3kw8F',baseMint:'2898GyK3eJBjHS97oZeZvnAacu7JHzD8PY6oCTqWu7Tj',quoteMint:quote,quoteDecimals:9,wallet};
 const op={id:'claim-recovery',agent_id:'claim-agent',purpose:'claim',status:'finalized',signature,result_json:JSON.stringify(tx),context_json:JSON.stringify(context),created_at:at,wire:'',message_hash:'',last_valid_height:0};
 await ingestClaim({...op,context_json:JSON.stringify({...context,pool:Keypair.generate().publicKey.toBase58()})});
 assert.equal(await db.prepare('SELECT id FROM asset_claims WHERE signature=?').bind(signature).first(),null,'Another pool must not credit this agent');
 await ingestClaim(op);await ingestClaim(op);
 const unpriced=await db.prepare('SELECT amount,usd_micros FROM asset_claims WHERE signature=?').bind(signature).first<{amount:string;usd_micros:number|null}>();
 assert.deepEqual({...unpriced},{amount:'147017046',usd_micros:null});
 assert.equal(await db.prepare('SELECT signature FROM fee_receipts WHERE signature=?').bind(signature).first(),null,'Missing claim-time price must not activate the agent');
 // Controlled historical-price fixture, not a claim about the production USD valuation.
 await db.prepare('INSERT INTO price_observations(mint,observed_at,usd_price) VALUES(?,?,?)').bind(quote,at,121.427227584).run();
 await ingestClaim(op);await ingestClaim(op);
 const receipt=await db.prepare('SELECT usd_micros,recipient FROM fee_receipts WHERE signature=?').bind(signature).first<{usd_micros:number;recipient:string}>();
 assert.deepEqual({...receipt},{usd_micros:17_851_872,recipient:wallet});assert.equal(activationProgress(receipt!.usd_micros/1e6).active,false);
 const balances=await Promise.all((['compound','compute','reserve','buyback'] as const).map(b=>assetBalance('claim-agent',quote,b)));
 assert.equal(balances.reduce((sum,n)=>sum+n,0n),147017046n);assert.equal(balances[3],14_701_704n);
 const counts=await db.prepare('SELECT COUNT(*) n FROM asset_entries WHERE agent_id=?').bind('claim-agent').first<{n:number}>();assert.equal(counts!.n,4,'Receipt replay must not allocate funds twice');
});
test('collection scheduling survives repeated worker calls and agent locks exclude concurrent signing',async()=>{
 const attempts=await Promise.all([reserveCollectionCheck('cadence',1000),reserveCollectionCheck('cadence',1000)]);assert.equal(attempts.filter(Boolean).length,1);
 assert.equal(await reserveCollectionCheck('cadence',30999),false);assert.equal(await reserveCollectionCheck('cadence',31000),true);
 await withLock('agent:cadence',async()=>{await assert.rejects(withLock('agent:cadence',async()=>{}),/already running/);});
 assert.equal(await withLock('agent:cadence',async()=>true),true);
});
after(()=>{globalThis.fetch=originalFetch;closeNodeDatabase();assert.equal(dirname(directory),resolve(tmpdir()));assert.ok(basename(directory).startsWith("thicc-execution-test-"));rmSync(directory,{recursive:true,force:true});});
test("claim allocation is idempotent, conserves bigint units, and prevents overspending",async()=>{
 const amount=123456789012345678n;await recordAssetClaim("agent-a","signature-a","mint-a",amount,9,1_000_000,1000);await recordAssetClaim("agent-a","signature-a","mint-a",amount,9,1_000_000,1000);
 const buckets=await Promise.all((["compound","compute","reserve","buyback"] as const).map(b=>assetBalance("agent-a","mint-a",b)));assert.equal(buckets.reduce((s,v)=>s+v,0n),amount);assert.equal(buckets[3],amount/10n);
 await assert.rejects(()=>reserveJob("agent-a","buyback","mint-a",buckets[3]+1n,"buyback","thicc"));
 await reserveJob("agent-a","buyback","mint-a",buckets[3],"buyback","thicc");assert.equal(await assetBalance("agent-a","mint-a","buyback"),0n);
});
test("SQLite batch rolls back every write if a later statement fails",async()=>{
 await assert.rejects(()=>db.batch([db.prepare("INSERT INTO accounts(id) VALUES('rollback-user')"),db.prepare("INSERT INTO missing_table(id) VALUES('fail')")]));assert.equal(await db.prepare("SELECT id FROM accounts WHERE id='rollback-user'").first(),null);
});
test("signed journal rejects modified instructions and reuses a signature after ambiguous broadcast",async()=>{
 const payer=Keypair.generate(),tx=new Transaction({feePayer:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:123}));
 const row=await prepareOperation("journal-a","test",tx,100,{owner:"test"});
 const bad=Transaction.from(Buffer.from(row.wire,"base64"));bad.instructions[0]=SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:999});bad.sign(payer);await assert.rejects(()=>submitOperation(row.id,bad.serialize().toString("base64")),/does not match/);
 tx.sign(payer);const signature=bs58.encode(tx.signature!),wires:string[]=[];
 globalThis.fetch=async(_url,init)=>{const request=JSON.parse(String(init?.body));let result:unknown;if(request.method==="getBlockHeight")result=50;else if(request.method==="getSignatureStatuses")result={context:{slot:50},value:[null]};else if(request.method==="sendTransaction"){wires.push(request.params[0]);throw new Error("Ambiguous network timeout");}else throw new Error("Unexpected RPC method");return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result}),{headers:{"Content-Type":"application/json"}});};
 const first=await submitOperation(row.id,tx.serialize().toString("base64"));assert.equal(first.status,"submitted");assert.equal(first.signature,signature);await submitOperation(row.id,tx.serialize().toString("base64"));assert.equal(wires.length,2);assert.equal(wires[0],wires[1]);
 const completed=await reconcileOperation(first,{getSignatureStatuses:async()=>({value:[{confirmationStatus:"finalized",err:null}]}),getTransaction:async()=>({blockTime:1,meta:{err:null}})} as unknown as Connection);assert.equal(completed.status,"finalized");
});
test("an unlanded signature becomes retryable only after finalized block height passes expiry",async()=>{
 const payer=Keypair.generate(),tx=new Transaction({feePayer:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));tx.sign(payer);await prepareOperation("expired-a","test",tx,5,{});await db.prepare("UPDATE chain_operations SET signature=?,status='submitted' WHERE id='expired-a'").bind(bs58.encode(tx.signature!)).run();
 const expired=await reconcileOperation((await operation("expired-a"))!,{getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>6} as unknown as Connection);assert.equal(expired.status,"expired");
});
