import {test} from "node:test";
import assert from "node:assert/strict";
import {clearSessionCookie,readSession,sessionCookie} from "./wallet-session";

test("wallet sessions reject tampering and duplicate cookies; production cookies are secure",()=>{
 const testEnvironment=process.env as Record<string,string|undefined>;
 const previousSecret=process.env.SESSION_SECRET,previousMode=testEnvironment.NODE_ENV;
 process.env.SESSION_SECRET="test-only-session-key-never-used-in-production";
 testEnvironment.NODE_ENV="production";
 try{
  const cookie=sessionCookie("wallet:test",true),header=cookie.split(";")[0];
  assert.ok(cookie.includes("HttpOnly"));assert.ok(cookie.includes("Secure"));assert.ok(cookie.includes("SameSite=Lax"));
  const request=(cookie:string)=>new Request("https://thicc.money/api/account",{headers:{cookie}});
  assert.equal(readSession(request(header))?.id,"wallet:test");
  assert.equal(readSession(request(header+"x")),null);
  assert.equal(readSession(request(`${header}; ${header}`)),null);
  assert.equal(readSession(new Request("https://thicc.money/api/account",{headers:{"oai-authenticated-user-id":"forged"}})),null);
  assert.ok(clearSessionCookie().includes("Max-Age=0"));
 }finally{if(previousSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=previousSecret;if(previousMode===undefined)delete testEnvironment.NODE_ENV;else testEnvironment.NODE_ENV=previousMode;}
});
