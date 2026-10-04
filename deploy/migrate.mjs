import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";

export function migrate(path=process.env.DATABASE_PATH||"/data/thicc.sqlite",migrationDir=resolve("drizzle")){
 mkdirSync(dirname(path),{recursive:true});
 const existed=existsSync(path),db=new DatabaseSync(path);
 try{
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS _thicc_migrations (tag TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)");
  const journal=JSON.parse(readFileSync(resolve(migrationDir,"meta/_journal.json"),"utf8"));
  let backedUp=false;
  for(const entry of journal.entries){
   const sql=readFileSync(resolve(migrationDir,entry.tag+".sql"),"utf8");
   const checksum=createHash("sha256").update(sql).digest("hex");
   const applied=db.prepare("SELECT checksum FROM _thicc_migrations WHERE tag=?").get(entry.tag);
   if(applied){if(applied.checksum!==checksum)throw new Error(`Applied migration changed: ${entry.tag}`);continue;}
   if(existed&&!backedUp){const backup=resolve(dirname(path),"backups",`before-migration-${Date.now()}.sqlite`);mkdirSync(dirname(backup),{recursive:true});db.prepare("VACUUM INTO ?").run(backup);backedUp=true;}
   db.exec("BEGIN IMMEDIATE");
   try{db.exec(sql);db.prepare("INSERT INTO _thicc_migrations VALUES (?,?,?)").run(entry.tag,checksum,Date.now());db.exec("COMMIT");console.log(`Applied migration ${entry.tag}`);}
   catch(error){db.exec("ROLLBACK");throw error;}
  }
 }finally{db.close();}
}
