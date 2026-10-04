import {Keypair,SystemProgram,Transaction,type VersionedTransactionResponse} from "@solana/web3.js";
import {createAssociatedTokenAccountIdempotentInstruction,createBurnCheckedInstruction,createCloseAccountInstruction,createInitializeAccountInstruction,createTransferInstruction,getAssociatedTokenAddressSync,ACCOUNT_SIZE,TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {config,database,HttpError,pubkey,rpc} from "./server";
import {agentSigner} from "./custody";
import {assetBalance,creditEntry,reserveJob,type ExecutionJob} from "./asset-ledger";
import {operation,signOperation,type Operation} from "./chain-journal";
import {buildEarnedSwap} from "./jupiter-swap";
import {mintInfo} from "./pool-state";
import {SOL_MINT} from "./launch-economics";
import {gasBudget} from "./gas-budget";

export function receivedTokens(op:Operation){
 if(op.status!=="finalized"||!op.result_json)throw new Error("Finalized swap receipt required.");const tx=JSON.parse(op.result_json) as VersionedTransactionResponse,c=JSON.parse(op.context_json),keys=[...tx.transaction.message.staticAccountKeys,...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])].map(String),index=keys.indexOf(c.outputAta);
 const pre=tx.meta?.preTokenBalances?.find(b=>b.accountIndex===index),post=tx.meta?.postTokenBalances?.find(b=>b.accountIndex===index);if(!post||post.mint!==c.outputMint)throw new Error("Swap output account was not credited.");const amount=BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount||"0");if(amount<BigInt(c.minimumOut))throw new Error("Swap output below minimum.");return amount;
}
async function setStatus(id:string,status:string,amount?:bigint){await database().prepare("UPDATE execution_jobs SET status=?,output_amount=COALESCE(?,output_amount),updated_at=? WHERE id=?").bind(status,amount?.toString()??null,Date.now(),id).run();}
export async function stageOperation(job:ExecutionJob,stage:string,build:Parameters<typeof signOperation>[3]){
 const prefix=`${job.id}:${stage}`;const latest=await database().prepare("SELECT id,status,updated_at FROM chain_operations WHERE purpose=? ORDER BY created_at DESC LIMIT 1").bind(prefix).first<{id:string;status:string;updated_at:number}>();
 if(latest&&['failed','expired'].includes(latest.status)&&Date.now()-latest.updated_at<300000)throw new HttpError(409,"Waiting before retrying the previous transaction.");
 // Explicitly failed/expired signatures cannot land; only then may a new signed attempt be made.
 const id=latest&&!['failed','expired'].includes(latest.status)?latest.id:crypto.randomUUID();return signOperation(id,prefix,job.agent_id,build);
}
async function unwrap(job:ExecutionJob,amount:bigint){const signer=await agentSigner(job.agent_id);return stageOperation(job,"unwrap",async()=>{const temporary=Keypair.generate(),rent=await rpc().getMinimumBalanceForRentExemption(ACCOUNT_SIZE),source=getAssociatedTokenAddressSync(pubkey(SOL_MINT),signer.publicKey);const tx=new Transaction().add(SystemProgram.createAccount({fromPubkey:signer.publicKey,newAccountPubkey:temporary.publicKey,lamports:rent,space:ACCOUNT_SIZE,programId:TOKEN_PROGRAM_ID}),createInitializeAccountInstruction(temporary.publicKey,pubkey(SOL_MINT),signer.publicKey),createTransferInstruction(source,temporary.publicKey,signer.publicKey,amount),createCloseAccountInstruction(temporary.publicKey,signer.publicKey,signer.publicKey));return {tx,signers:[signer,temporary],context:{amount:amount.toString()}};});}
export async function executeFeeJob(job:ExecutionJob){
 const signer=await agentSigner(job.agent_id);
 let acquired=job.output_amount?BigInt(job.output_amount):BigInt(job.input_amount);
 if(job.input_mint!==job.output_mint&&job.status==="reserved"){
  const op=await stageOperation(job,"swap",async()=>{const swap=await buildEarnedSwap(signer.publicKey,job.input_mint,job.output_mint!,BigInt(job.input_amount));return {...swap,signers:[signer]};});
  if(op.status!=="finalized")return;acquired=receivedTokens(op);await setStatus(job.id,"acquired",acquired);job={...job,status:"acquired",output_amount:acquired.toString()};
 }
 if(job.kind==="buyback"){
  const token=await mintInfo(job.output_mint!),ata=getAssociatedTokenAddressSync(pubkey(job.output_mint!),signer.publicKey,false,token.program);
  const op=await stageOperation(job,"burn",async()=>({tx:new Transaction().add(createBurnCheckedInstruction(ata,pubkey(job.output_mint!),signer.publicKey,acquired,token.mint.decimals,[],token.program)),signers:[signer],context:{mint:job.output_mint,amount:acquired.toString(),job:job.id}}));
  if(op.status!=="finalized")return;await creditEntry(`${job.id}:burn`,job.agent_id,job.output_mint!,"burn",acquired,op.id);await setStatus(job.id,"complete",acquired);
 }else if(job.kind==="gas"){
  if(job.input_mint!==SOL_MINT){const op=await unwrap(job,acquired);if(op.status!=="finalized")return;}
  // Reserved fees have now been converted to spendable network gas, not a new fee allocation.
  await setStatus(job.id,"complete",acquired);
 }else if(job.kind==="compute"){
  const context=JSON.parse(job.context_json) as {address:string;fundingId:string};if(context.address!==config("SOLCARD_DEPOSIT_ADDRESS"))throw new Error("Funding destination changed while a deposit was pending.");
  if(job.input_mint!==SOL_MINT&&job.status!=="unwrapped"){const op=await unwrap(job,acquired);if(op.status!=="finalized")return;await setStatus(job.id,"unwrapped",acquired);}
  const op=await stageOperation(job,"deposit",async()=>({tx:new Transaction().add(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:pubkey(context.address),lamports:acquired})),signers:[signer],context:{address:context.address,amount:acquired.toString(),fundingId:context.fundingId}}));
  if(op.status!=="finalized")return;await setStatus(job.id,"complete",acquired);
 }else if(job.kind==="compound_swap"){
  if(job.output_mint===SOL_MINT){const op=await unwrap(job,acquired);if(op.status!=="finalized")return;}
  await creditEntry(`${job.id}:output`,job.agent_id,job.output_mint!,JSON.parse(job.context_json).bucket==="recycle"?"recycle":"compound",acquired,job.id);await setStatus(job.id,"complete",acquired);
 }
}
export async function queueBuybacks(){
 const mint=config("THICC_TOKEN_MINT");if(!mint)return {status:"awaiting_configuration"};pubkey(mint);
 const assets=await database().prepare("SELECT DISTINCT agent_id,mint FROM asset_entries WHERE bucket='buyback'").all<{agent_id:string;mint:string}>();
 for(const a of assets.results){const amount=await assetBalance(a.agent_id,a.mint,"buyback");if(amount<=0n)continue;
  const pending=await database().prepare("SELECT * FROM execution_jobs WHERE agent_id=? AND kind='buyback' AND input_mint=? AND status!='complete' ORDER BY created_at LIMIT 1").bind(a.agent_id,a.mint).first<ExecutionJob>();
  if(pending){
   // Combine dust only before a wire has ever been signed. Never change an in-flight purchase.
   const signed=await database().prepare("SELECT id FROM chain_operations WHERE agent_id=? AND substr(purpose,1,?)=? LIMIT 1").bind(a.agent_id,pending.id.length+1,`${pending.id}:`).first();
   if(pending.status==='reserved'&&!signed){const now=Date.now();await database().batch([
    database().prepare("UPDATE execution_jobs SET input_amount=?,updated_at=? WHERE id=?").bind((BigInt(pending.input_amount)+amount).toString(),now,pending.id),
    database().prepare("INSERT INTO asset_entries(id,agent_id,mint,bucket,amount,operation_id,created_at) VALUES(?,?,?,'buyback',?,?,?)").bind(crypto.randomUUID(),a.agent_id,a.mint,(-amount).toString(),pending.id,now)]);}
  }else await reserveJob(a.agent_id,"buyback",a.mint,amount,"buyback",mint);
 }
 return {status:"queued"};
}
export async function queueGas(agent:string,needsSetup=false){
 const signer=await agentSigner(agent),balance=Number(await gasBudget(agent)),custody=await database().prepare("SELECT graduated_pool,dlmm_pool FROM agent_custody WHERE agent_id=?").bind(agent).first<{graduated_pool:string|null;dlmm_pool:string|null}>();
 const bootstrapping=needsSetup||(!!custody?.graduated_pool&&!custody.dlmm_pool),desiredSol=bootstrapping?.15:.02;
 if(balance>=(bootstrapping?100_000_000:5_000_000))return;
 if(await database().prepare("SELECT id FROM execution_jobs WHERE agent_id=? AND kind='gas' AND status!='complete' LIMIT 1").bind(agent).first())return;
 const assets=await database().prepare("SELECT DISTINCT mint FROM asset_entries WHERE agent_id=? AND bucket='reserve'").bind(agent).all<{mint:string}>();
 const {assetPrice}=await import("./asset-price"),sol=await assetPrice(SOL_MINT);
 for(const a of assets.results){const earned=await database().prepare("SELECT amount FROM asset_claims WHERE agent_id=? AND mint=?").bind(agent,a.mint).all<{amount:string}>(),floor=earned.results.reduce((s,r)=>s+BigInt(r.amount),0n)*20n/100n;const available=await assetBalance(agent,a.mint,"reserve")-floor;if(available<=0n)continue;const token=await mintInfo(a.mint),price=await assetPrice(a.mint),target=BigInt(Math.ceil(desiredSol*sol.usdPrice/price.usdPrice*10**token.mint.decimals));const amount=available<target?available:target;await reserveJob(agent,"gas",a.mint,amount,"reserve",SOL_MINT);return;}
}
