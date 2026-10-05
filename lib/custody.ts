import {Keypair} from "@solana/web3.js";
import {config,database,HttpError} from "./server";
import {seal,unseal} from "./custody-crypto";
export function encryptKeys(value:unknown,context:string){return seal(JSON.stringify(value),context,config("AGENT_WALLET_ENCRYPTION_KEY"));}
export function decryptKeys<T>(value:string,context:string):T{return JSON.parse(unseal(value,context,config("AGENT_WALLET_ENCRYPTION_KEY"))) as T;}
export async function agentSigner(id:string){
 const state=await database().prepare("SELECT status FROM agents WHERE id=?").bind(id).first<{status:string}>();
 if(state?.status==='recovery_hold')throw new HttpError(409,"Agent paused after an operator test-fee recovery.");
 const row=await database().prepare("SELECT wallet,encrypted_key FROM agent_custody WHERE agent_id=?").bind(id).first<{wallet:string;encrypted_key:string}>();
 if(!row)throw new HttpError(409,"Agent custody is unavailable.");
 const signer=Keypair.fromSecretKey(Uint8Array.from(decryptKeys<number[]>(row.encrypted_key,`agent:${id}`)));
 if(signer.publicKey.toBase58()!==row.wallet)throw new Error("Custody key does not match registered wallet.");return signer;
}
