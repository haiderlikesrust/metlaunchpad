import {test,after} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {mkdtempSync,rmSync} from "node:fs";
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
const originalFetch=globalThis.fetch;
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
