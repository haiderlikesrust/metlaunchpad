import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";

test("claim receipt and 10% reservation commit together, once, before AI activation",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE fee_receipts(signature TEXT PRIMARY KEY,agent_id TEXT,recipient TEXT,usd_micros INTEGER,compute_micros INTEGER,verified_at INTEGER)");
  db.exec(readFileSync(new URL("../drizzle/0006_keen_red_wolf.sql",import.meta.url),"utf8"));
  const claim=db.prepare("INSERT OR IGNORE INTO fee_receipts VALUES(?,?,'agent-wallet',?,0,1)");
  for(let i=0;i<10;i++)claim.run(`claim-${i}`,"agent",1);
  claim.run("claim-9","agent",1);
  claim.run("other","other-agent",100);
  const result=db.prepare("SELECT COUNT(*) count,SUM(usd_micros) amount FROM fee_buybacks WHERE agent_id='agent'").get();
  assert.equal(result?.count,10);assert.equal(result?.amount,1);
  assert.equal(db.prepare("SELECT usd_micros FROM fee_buybacks WHERE claim_signature='other'").get()?.usd_micros,10);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM fee_buybacks WHERE burn_signature IS NOT NULL").get()?.count,0);
 }finally{db.close();}
});
