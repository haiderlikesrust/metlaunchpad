import {createHash} from "node:crypto";
import {Keypair,Transaction,VersionedTransaction,type Connection} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {database,HttpError,rpc} from "./server";
import {gasBudget} from "./gas-budget";
import {SOL_MINT} from "./launch-economics";

export type Operation={id:string;agent_id:string|null;purpose:string;status:string;wire:string;message_hash:string;signature:string|null;last_valid_height:number;context_json:string;result_json:string|null;created_at:number};
type WireTransaction=Transaction|VersionedTransaction;
export const wireBytes=(tx:WireTransaction)=>Buffer.from(tx instanceof Transaction?tx.serialize({requireAllSignatures:false}):tx.serialize());
export const messageHash=(tx:WireTransaction)=>createHash("sha256").update(tx instanceof Transaction?tx.serializeMessage():tx.message.serialize()).digest("hex");
export async function operation(id:string){return database().prepare("SELECT * FROM chain_operations WHERE id=?").bind(id).first<Operation>();}
export async function prepareOperation(id:string,purpose:string,tx:WireTransaction,lastValidBlockHeight:number,context:unknown,agentId:string|null=null){
 const now=Date.now();await database().prepare("INSERT OR IGNORE INTO chain_operations(id,agent_id,purpose,status,wire,message_hash,last_valid_height,context_json,created_at,updated_at) VALUES(?,?,?,'prepared',?,?,?,?,?,?)").bind(id,agentId,purpose,wireBytes(tx).toString("base64"),messageHash(tx),lastValidBlockHeight,JSON.stringify(context),now,now).run();return (await operation(id))!;
}
/** Persist a fully signed wire before sending. A crash can only resend the SAME signature. */
export async function submitOperation(id:string,wire:string){
 const row=await operation(id);if(!row)throw new HttpError(404,"Prepared transaction not found.");
 if(row.status!=="prepared")return reconcileOperation(row);
 const tx=VersionedTransaction.deserialize(Buffer.from(wire,"base64"));
 if(messageHash(tx)!==row.message_hash||tx.signatures.length!==tx.message.header.numRequiredSignatures||!tx.signatures.every((s,i)=>nacl.sign.detached.verify(tx.message.serialize(),s,tx.message.staticAccountKeys[i].toBytes())))throw new HttpError(400,"Signed transaction does not match the prepared operation.");
 if(await rpc().getBlockHeight("finalized")>row.last_valid_height){await database().prepare("UPDATE chain_operations SET status='expired',updated_at=? WHERE id=? AND status='prepared'").bind(Date.now(),id).run();return (await operation(id))!;}
 const signature=bs58.encode(tx.signatures[0]);
 await database().prepare("UPDATE chain_operations SET wire=?,signature=?,status='submitted',updated_at=? WHERE id=? AND status='prepared'").bind(wire,signature,Date.now(),id).run();
 return reconcileOperation((await operation(id))!);
}
export async function reconcileOperation(row:Operation,connection:Connection=rpc()){
 if(["finalized","failed","expired"].includes(row.status)||!row.signature)return row;
 const status=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];
 if(status?.confirmationStatus==="finalized"){
  const transaction=await connection.getTransaction(row.signature,{commitment:"finalized",maxSupportedTransactionVersion:0});
  if(!transaction)return row;
  await database().prepare("UPDATE chain_operations SET status=?,result_json=?,error=?,updated_at=? WHERE id=?").bind(status.err?"failed":"finalized",JSON.stringify(transaction),status.err?"Transaction failed on-chain.":null,Date.now(),row.id).run();
 }else if(!status&&await connection.getBlockHeight("finalized")>row.last_valid_height){
  await database().prepare("UPDATE chain_operations SET status='expired',error='Blockhash expired without landing',updated_at=? WHERE id=?").bind(Date.now(),row.id).run();
 }else if(!status){
  // RPC timeout/ambiguous submission leaves the journal pending for reconciliation.
  try{const returned=await connection.sendRawTransaction(Buffer.from(row.wire,"base64"),{skipPreflight:false,maxRetries:2});if(returned!==row.signature)throw new Error("RPC returned an unexpected signature.");}catch{/* Reconcile before rebuilding, even when preflight returns an error. */}
 }
 return (await operation(row.id))!;
}
export async function signOperation(id:string,purpose:string,agentId:string,build:()=>Promise<{tx:WireTransaction;signers:Keypair[];context:unknown}>){
 let row=await operation(id);if(row)return row.status==="prepared"?submitOperation(id,row.wire):reconcileOperation(row);
 const {tx,signers,context}=await build(),connection=rpc(),latest=await connection.getLatestBlockhash("confirmed");
 if(tx instanceof Transaction){tx.feePayer=signers[0].publicKey;tx.recentBlockhash=latest.blockhash;tx.sign(...signers);}else{if(!tx.message.staticAccountKeys[0].equals(signers[0].publicKey))throw new Error("Invalid agent payer.");tx.message.recentBlockhash=latest.blockhash;tx.sign(signers);}
 const payer=signers[0].publicKey,before=await connection.getBalance(payer,"confirmed"),gas=await gasBudget(agentId);
 const simulation=await connection.simulateTransaction(VersionedTransaction.deserialize(tx.serialize()),{sigVerify:true,commitment:"confirmed",accounts:{encoding:"base64",addresses:[payer.toBase58()]}});
 if(simulation.value.err)throw new HttpError(409,"Agent transaction simulation failed. No funds were sent.");
 const after=simulation.value.accounts?.[0]?.lamports;if(after===undefined)throw new HttpError(409,"Agent balance simulation is unavailable.");
 const c=context as {inputMint?:string;amount?:string;amountY?:string;quoteMint?:string;address?:string};
 // Explicitly reserved SOL may leave only in its swap, LP deposit, or pinned compute payment.
 const principal=(purpose.endsWith(':swap')&&c.inputMint===SOL_MINT?BigInt(c.amount||'0'):0n)+(purpose.endsWith(':add')&&c.quoteMint===SOL_MINT?BigInt(c.amountY||'0'):0n)+(purpose.endsWith(':deposit')&&c.address?BigInt(c.amount||'0'):0n);
 if(BigInt(before)-BigInt(after)>gas+principal)throw new HttpError(409,"Accumulating network gas and account rent without spending reserved fees.");
 row=await prepareOperation(id,purpose,tx,latest.lastValidBlockHeight,context,agentId);return submitOperation(row.id,wireBytes(tx).toString("base64"));
}
