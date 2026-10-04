import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import assert from "node:assert/strict";
import {parseEnv} from "node:util";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {migrate} from "./migrate.mjs";

const directory=mkdtempSync(join(tmpdir(),"thicc-smoke-"));
const dbPath=join(directory,"test.sqlite");
migrate(dbPath,resolve("drizzle"));
const origin="https://thicc.money",base="http://127.0.0.1:3097";
// Keep the production artifact test isolated from configured live services.
const cleared={};
for(const file of [".env",".env.example"]){if(existsSync(file))for(const key of Object.keys(parseEnv(readFileSync(file,"utf8"))))cleared[key]="";}
const token=randomBytes(32).toString("hex");
const child=spawn(process.execPath,[resolve(".next-dokploy/standalone/server.js")],{
 env:{...process.env,...cleared,THICC_RUNTIME:"node",APP_ORIGIN:origin,SESSION_SECRET:randomBytes(32).toString("hex"),AGENT_CRON_TOKEN:token,DATABASE_PATH:dbPath,HOSTNAME:"127.0.0.1",PORT:"3097",NODE_ENV:"production"},
 stdio:["ignore","ignore","pipe"],
});
let diagnostic="";child.stderr.on("data",chunk=>{diagnostic+=chunk.toString();});
async function post(path,body,cookie="",requestOrigin=origin){return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:requestOrigin,Cookie:cookie},body:JSON.stringify(body)});}
try{
 let ready=false;
 for(let i=0;i<60;i++){try{if((await fetch(base+"/api/health")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.ok(ready,"Standalone server did not become healthy.");
 for(const path of ["/","/launch","/docs","/docs/funding","/token/ca","/?view=agents","/?view=my-coins"]){const r=await fetch(base+path);assert.equal(r.status,200,path);const html=await r.text();assert.ok(html.includes('aria-label="Main navigation"'),path+" shared navigation");assert.ok(html.includes('href="/docs"'),path+" Docs link");assert.ok(!html.includes("Preview full coin page"));if(path.includes("view=")){const query=path.split("view=")[1];assert.match(html,new RegExp(`<a[^>]*href="/\\?view=${query}"[^>]*aria-current="page"`),"Deep link must render the correct tab before hydration");}}
 const models=await (await fetch(base+"/api/models")).json();assert.deepEqual(models.models.map(m=>m.openrouterId),["anthropic/claude-fable-5.1","openai/gpt-6-astra","anthropic/claude-opus-5.5","openai/gpt-6.1-sol"]);
 assert.equal((await fetch(base+"/api/account",{headers:{"oai-authenticated-user-id":"forged"}})).status,401);
 const keypair=nacl.sign.keyPair(),wallet=bs58.encode(keypair.publicKey);
 assert.equal((await post("/api/wallet/challenge",{wallet},"","https://wrong.example")).status,403);
 const challenge=await post("/api/wallet/challenge",{wallet});assert.equal(challenge.status,200);
 const cookie=challenge.headers.get("set-cookie").split(";")[0];
 assert.ok(challenge.headers.get("set-cookie").includes("Secure"));
 const {message}=await challenge.json();assert.ok(message.includes(origin));
 const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),keypair.secretKey));
 const verified=await post("/api/wallet/verify",{wallet,signature},cookie);assert.equal(verified.status,200);
 const authenticated=verified.headers.get("set-cookie").split(";")[0];
 assert.equal((await (await fetch(base+"/api/account",{headers:{Cookie:authenticated}})).json()).wallet,wallet);
 assert.notEqual((await post("/api/wallet/verify",{wallet,signature},cookie)).status,200,"Nonce replay accepted");
 assert.equal((await fetch(base+"/api/account",{headers:{Cookie:authenticated+"x"}})).status,401);
 assert.equal((await fetch(base+"/api/internal/tick",{method:"POST"})).status,401);
 const tick=await fetch(base+"/api/internal/tick",{method:"POST",headers:{Authorization:`Bearer ${token}`}});assert.equal(tick.status,200);
 assert.equal((await tick.json()).buybacks.status,"awaiting_configuration");
 console.log("Standalone smoke passed: seven routes, correct initial tab rendering, pinned model IDs, database health, wallet signature login, cookie verification, origin checks, nonce replay rejection, worker authentication, pending buyback configuration.");
}catch(error){console.error(diagnostic);throw error;}
finally{
 if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once("exit",resolve));child.kill();await exited;}
 assert.equal(dirname(directory),resolve(tmpdir()));assert.ok(basename(directory).startsWith("thicc-smoke-"));
 rmSync(directory,{recursive:true,force:true});
}
