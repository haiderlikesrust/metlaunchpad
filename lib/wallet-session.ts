import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
const COOKIE="thicc_session";
type Session={id:string;verified:boolean;expires:number};
function secret(){const value=process.env.SESSION_SECRET||"";if(value.length<32)throw new Error("SESSION_SECRET must contain at least 32 characters.");return value;}
function mac(payload:string){return createHmac("sha256",secret()).update(payload).digest("base64url");}
export function readSession(request:Request):Session|null{
 const matches=(request.headers.get("cookie")||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+"="));
 if(matches.length!==1)return null;
 const [payload,signature,...extra]=matches[0].slice(COOKIE.length+1).split(".");
 if(!payload||!signature||extra.length||payload.length>1000)return null;
 const expected=Buffer.from(mac(payload)),actual=Buffer.from(signature);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
 try{const value=JSON.parse(Buffer.from(payload,"base64url").toString()) as Session;
  return typeof value.id==="string"&&value.id.length<150&&typeof value.verified==="boolean"&&Number.isSafeInteger(value.expires)&&value.expires>Date.now()?value:null;
 }catch{return null;}
}
export function sessionCookie(id:string,verified:boolean){
 const seconds=verified?86400:300;
 const payload=Buffer.from(JSON.stringify({id,verified,expires:Date.now()+seconds*1000})).toString("base64url");
 return `${COOKIE}=${payload}.${mac(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${process.env.NODE_ENV==="production"?"; Secure":""}`;
}
export function pendingSession(){return `pending:${randomUUID()}`;}
export function clearSessionCookie(){return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==="production"?"; Secure":""}`;}
