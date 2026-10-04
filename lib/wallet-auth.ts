import nacl from "tweetnacl";
import bs58 from "bs58";
import {z} from "zod";
import {account,database,HttpError,pubkey} from "./server";
import {clearSessionCookie,pendingSession,readSession,sessionCookie} from "./wallet-session";

/** Standalone wallet authentication does not trust identity headers supplied by
 * a browser or reverse proxy. Challenges belong to an HttpOnly signed session.
 */
export async function walletAuth(request:Request,path:string){
 const db=database();
 if(path==="wallet/disconnect")return Response.json({ok:true},{headers:{"Set-Cookie":clearSessionCookie()}});
 const body=await request.json() as Record<string,unknown>;
 if(path==="wallet/challenge"){
  const address=pubkey(z.string().parse(body.wallet)).toBase58();
  const session=pendingSession(),expires=Date.now()+300000;
  const origin=process.env.APP_ORIGIN||new URL(request.url).origin;
  const message=`THICC wallet verification\nOrigin: ${origin}\nWallet: ${address}\nNonce: ${crypto.randomUUID()}\nExpires: ${expires}\nThis signature does not authorize transactions.`;
  await account(session);
  await db.prepare("UPDATE accounts SET nonce=?,nonce_expires=? WHERE id=?").bind(message,expires,session).run();
  // Expired anonymous challenges carry no wallet or application data.
  await db.prepare("DELETE FROM accounts WHERE id LIKE 'pending:%' AND nonce_expires<?").bind(Date.now()).run();
  return Response.json({message},{headers:{"Set-Cookie":sessionCookie(session,false),"Cache-Control":"no-store"}});
 }
 const input=z.object({wallet:z.string(),signature:z.string().max(128)}).parse(body);
 const session=readSession(request);
 if(!session||session.verified)throw new HttpError(401,"Request a new wallet challenge.");
 const challenge=await account(session.id);
 if(!challenge?.nonce||!challenge.nonce_expires||challenge.nonce_expires<Date.now()||!challenge.nonce.includes(`Wallet: ${input.wallet}\n`))throw new HttpError(401,"Wallet challenge expired or mismatched.");
 let valid=false;try{valid=nacl.sign.detached.verify(new TextEncoder().encode(challenge.nonce),bs58.decode(input.signature),pubkey(input.wallet).toBytes());}catch{}
 if(!valid)throw new HttpError(401,"Invalid wallet signature.");
 const used=await db.prepare("UPDATE accounts SET nonce=NULL,nonce_expires=NULL WHERE id=? AND nonce=?").bind(session.id,challenge.nonce).run();
 if(!used.meta.changes)throw new HttpError(409,"Challenge already used.");
 const id=`wallet:${input.wallet}`;
 await db.prepare("INSERT INTO accounts(id,wallet) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet").bind(id,input.wallet).run();
 await db.prepare("DELETE FROM accounts WHERE id=?").bind(session.id).run();
 return Response.json({wallet:input.wallet},{headers:{"Set-Cookie":sessionCookie(id,true),"Cache-Control":"no-store"}});
}
