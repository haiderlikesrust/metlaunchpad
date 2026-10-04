import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import nextEnv from "@next/env";
import {migrate} from "../deploy/migrate.mjs";

nextEnv.loadEnvConfig(process.cwd(),true);
process.env.THICC_RUNTIME="node";
process.env.APP_ORIGIN=process.env.DEV_APP_ORIGIN||"http://localhost:5173";
process.env.DATABASE_PATH=process.env.DEV_DATABASE_PATH||resolve(".data/thicc.sqlite");
if(!process.env.SESSION_SECRET){
 mkdirSync(".secrets",{recursive:true});
 const file=resolve(".secrets/dev-session");
 if(!existsSync(file))writeFileSync(file,randomBytes(32).toString("hex"),{mode:0o600,flag:"wx"});
 process.env.SESSION_SECRET=readFileSync(file,"utf8");
}
migrate(process.env.DATABASE_PATH,resolve("drizzle"));
const child=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port","5173"],{stdio:"inherit",env:process.env});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code??0));
