import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {migrate} from "./migrate.mjs";
test("all deployment migrations apply once and retain records across startup",()=>{
 const directory=mkdtempSync(join(tmpdir(),"thicc-migration-test-")),path=join(directory,"test.sqlite");
 try{
  migrate(path,resolve("drizzle"));
  let db=new DatabaseSync(path);db.prepare("INSERT INTO accounts(id,wallet) VALUES('test','test-wallet')").run();db.close();
  migrate(path,resolve("drizzle"));
  db=new DatabaseSync(path);
  assert.equal(db.prepare("SELECT wallet FROM accounts WHERE id='test'").get().wallet,"test-wallet");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM _thicc_migrations").get().count,8);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='reserve_thicc_buyback_after_claim'").get());
  db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
