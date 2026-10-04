import {env} from "cloudflare:workers";
import {Connection,PublicKey} from "@solana/web3.js";
import type {Pool} from "./types";
import {readSession} from "./wallet-session";
export function config(key:string):string {return String((env as unknown as Record<string,unknown>)[key]||process.env[key]||"");}
export function database(){if(!env.DB)throw new Error("Database unavailable. Deploy the D1 migration.");return env.DB;}
export function owner(request:Request){if(config("THICC_RUNTIME")==="node"){const session=readSession(request);if(!session?.verified)throw new HttpError(401,"Connect and verify your wallet first.");return session.id;}const id=request.headers.get("oai-authenticated-user-id");if(!id)throw new HttpError(401,"Sign in to THICC to manage your pools.");return id;}
export function sameOrigin(request:Request){const origin=request.headers.get("origin"),expected=config("APP_ORIGIN")||new URL(request.url).origin;if(origin&&origin!==expected)throw new HttpError(403,"Cross-origin writes are not allowed.");if(config("THICC_RUNTIME")==="node"&&!origin&&!new URL(request.url).pathname.startsWith("/api/internal/"))throw new HttpError(403,"An Origin header is required.");}
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function rpc(){const url=config("QUICKNODE_RPC_URL");if(!url)throw new HttpError(503,"QuickNode is not configured. Add QUICKNODE_RPC_URL to the server environment.");return new Connection(url,{commitment:"confirmed",disableRetryOnRateLimit:true,fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})});}
export function pubkey(value:string){try{return new PublicKey(value);}catch{throw new HttpError(400,"Invalid Solana address.");}}
export async function meteora(path:string){const r=await fetch(`https://dlmm.datapi.meteora.ag${path}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new HttpError(502,`Meteora data is temporarily unavailable (${r.status}).`);return r.json() as Promise<Record<string,unknown>>;}
export async function poolData(address:string):Promise<Pool>{pubkey(address);const data=await meteora(`/pools/${address}`);return (data.data??data) as Pool;}
export async function account(id:string){await database().prepare("INSERT OR IGNORE INTO accounts(id) VALUES (?)").bind(id).run();return await database().prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<{id:string;wallet:string|null;settings:string;nonce:string|null;nonce_expires:number|null}>();}
export async function boundWallet(id:string){const acc=await account(id);if(!acc?.wallet)throw new HttpError(401,"Connect and verify your wallet first.");return pubkey(acc.wallet);}
export async function event(ownerId:string,agentId:string,kind:string,message:string,payload?:unknown){await database().prepare("INSERT INTO events(id,owner,agent_id,kind,message,payload,created_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),ownerId,agentId,kind,message,payload?JSON.stringify(payload):null,Date.now()).run();}
export function safeError(error:unknown){if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status});console.error("THICC request failed",error instanceof Error?error.name:"unknown");return Response.json({error:"The request could not be completed. Check service configuration and try again."},{status:503});}
