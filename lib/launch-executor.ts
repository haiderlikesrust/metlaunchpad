import {Keypair,PublicKey,SystemProgram,Transaction,VersionedTransaction} from "@solana/web3.js";
import {getMint,TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {DynamicBondingCurveClient,deriveDbcPoolAddress,deriveTokenBadgeAddress} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {z} from "zod";
import {launchInput} from "./launch-input";
import {config,database,HttpError,pubkey,rpc} from "./server";
import {encryptKeys,decryptKeys} from "./custody";
import {operation,prepareOperation,reconcileOperation,submitOperation} from "./chain-journal";
import {withLock} from "./runtime-lock";
import {requireQuoteToken} from "./quote-tokens";
import {assetPrice} from "./asset-price";
import {solPrice} from "./sol-price";
import {LAUNCH_ECONOMICS,FIXED_SUPPLY_ATOMS,launchValuation} from "./launch-economics";
import {thiccCurve} from "./dbc-curve";
import {DEFAULT_POLICY} from "./engine";
import {draftFeeBps,nativeLaunchFeeBps} from "./launch-fee";
import {devBuyQuote} from './dev-buy';

type Input=z.infer<typeof launchInput>;
type Draft={id:string;owner:string;wallet:string;input_json:string;mint:string;config_address:string;pool_address:string;agent_wallet:string;encrypted_keys:string;curve_json:string;stage:string;metadata_json:string;image_type:string;image_base64:string;created_at:number};
async function draftFor(id:string,owner:string){const row=await database().prepare("SELECT * FROM launch_drafts WHERE id=? AND owner=?").bind(id,owner).first<Draft>();if(!row)throw new HttpError(404,"Launch not found.");return row;}
function checkImage(bytes:Buffer,type:string){const valid=type==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==="image/webp"?bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP":false;if(!valid)throw new HttpError(400,"Image content does not match its file type.");}
export async function createLaunch(owner:string,wallet:PublicKey,form:FormData,id:string){
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(id))throw new HttpError(400,"A launch request ID is required.");
 return withLock(`launch:${id}`,async()=>{
  if(await database().prepare("SELECT id FROM launch_drafts WHERE id=?").bind(id).first())return prepareLaunchStage(await draftFor(id,owner));
  const input=launchInput.parse(Object.fromEntries([...form.entries()].filter(([key])=>key!=="image"))),image=form.get("image");
  if(!(image instanceof File)||image.size===0||image.size>1_000_000)throw new HttpError(400,"Choose an image under 1 MB.");const bytes=Buffer.from(await image.arrayBuffer());checkImage(bytes,image.type);
  const count=await database().prepare("SELECT COUNT(*) n FROM launch_drafts WHERE owner=? AND stage!='complete' AND created_at>?").bind(owner,Date.now()-86400000).first<{n:number}>();if((count?.n??0)>=5)throw new HttpError(429,"Resume an existing launch before creating another.");
  const base=Keypair.generate(),agent=Keypair.generate(),configKey=Keypair.generate();
  // Validate key material before any on-chain spending or storing uploaded content.
  const encrypted=encryptKeys({base:Array.from(base.secretKey),agent:Array.from(agent.secretKey),config:Array.from(configKey.secretKey)},`launch:${id}`);
  const quote=await requireQuoteToken(input.quoteMint),connection=rpc(),account=await connection.getAccountInfo(pubkey(quote.mint));if(!account)throw new HttpError(409,"Quote mint was not found.");
  const quoteMint=await getMint(connection,pubkey(quote.mint),"confirmed",account.owner);if(quoteMint.decimals!==quote.decimals||quoteMint.decimals>9)throw new HttpError(409,"Quote mint decimals are not compatible with this launch.");
  const valuation=launchValuation(await solPrice(),await assetPrice(quote.mint)),curve=thiccCurve(quote.decimals,valuation.initialMarketCapQuote,valuation.graduationMarketCapQuote);
  try{devBuyQuote(new DynamicBondingCurveClient(connection,'confirmed'),curve,input.devBuyAmount,quote.decimals);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Dev buy could not be quoted.');}
  const pool=deriveDbcPoolAddress(pubkey(quote.mint),base.publicKey,configKey.publicKey),origin=config("APP_ORIGIN");if(!origin)throw new HttpError(503,"Public metadata origin is not configured.");
  const metadata={name:input.name,symbol:input.symbol,description:input.description,image:`${origin}/api/metadata/${id}/image`,external_url:input.website||`${origin}/token/${base.publicKey.toBase58()}`,extensions:{website:input.website||`${origin}/token/${base.publicKey.toBase58()}`,twitter:input.twitter,telegram:input.telegram}};
  await database().prepare("INSERT INTO launch_drafts(id,owner,wallet,input_json,mint,config_address,pool_address,agent_wallet,encrypted_keys,curve_json,image_type,image_base64,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,owner,wallet.toBase58(),JSON.stringify(input),base.publicKey.toBase58(),configKey.publicKey.toBase58(),pool.toBase58(),agent.publicKey.toBase58(),encrypted,JSON.stringify({...valuation,quoteDecimals:quote.decimals,initialFeeBps:LAUNCH_ECONOMICS.initialFeeBps}),image.type,bytes.toString("base64"),JSON.stringify(metadata),Date.now()).run();
  return prepareLaunchStage(await draftFor(id,owner));
 });
}
async function prepareLaunchStage(draft:Draft):Promise<Record<string,unknown>>{
 if(draft.stage==="complete")return {id:draft.id,initialFeeBps:draftFeeBps(JSON.parse(draft.curve_json)),status:"complete",mint:draft.mint};
 const db=database();let prior=await db.prepare("SELECT id FROM chain_operations WHERE purpose=? ORDER BY created_at DESC LIMIT 1").bind(`launch:${draft.id}:${draft.stage}`).first<{id:string}>();
 if(prior){let op=(await operation(prior.id))!;if(op.status==="submitted")op=await reconcileOperation(op);if(op.status==="finalized")return advanceLaunch(draft,op.signature!);if(op.status==="submitted")return {id:draft.id,initialFeeBps:draftFeeBps(JSON.parse(draft.curve_json)),status:"confirming",signature:op.signature};if(op.status==="prepared"&&await rpc().getBlockHeight("confirmed")<=op.last_valid_height)return {id:draft.id,initialFeeBps:draftFeeBps(JSON.parse(draft.curve_json)),status:"signature_required",stage:draft.stage,operationId:op.id,transaction:op.wire,mint:draft.mint,devBuy:JSON.parse(op.context_json).devBuy||null};}
 const keys=decryptKeys<{base:number[];agent:number[];config:number[]}>(draft.encrypted_keys,`launch:${draft.id}`),signer=(name:keyof typeof keys)=>Keypair.fromSecretKey(Uint8Array.from(keys[name]));
 const input=JSON.parse(draft.input_json) as Input,valuation=JSON.parse(draft.curve_json),payer=pubkey(draft.wallet),client=new DynamicBondingCurveClient(rpc(),"confirmed"),curve=thiccCurve(valuation.quoteDecimals,valuation.initialMarketCapQuote,valuation.graduationMarketCapQuote,draftFeeBps(valuation));
 let tx:Transaction,signers:Keypair[];
 const tokenBadge=deriveTokenBadgeAddress(pubkey(input.quoteMint));
 const buy=devBuyQuote(client,curve,input.devBuyAmount,valuation.quoteDecimals);
 const devBuy=buy?{amount:input.devBuyAmount,quoteMint:input.quoteMint,expectedTokens:buy.expectedOut.toString(),minimumTokens:buy.minimumAmountOut.toString(),slippageBps:50}:null;
 if(draft.stage==="config"){
  tx=await client.partner.createConfig({...curve,config:pubkey(draft.config_address),feeClaimer:pubkey(draft.agent_wallet),leftoverReceiver:pubkey(draft.agent_wallet),quoteMint:pubkey(input.quoteMint),payer,tokenBadge});
  tx.add(SystemProgram.transfer({fromPubkey:payer,toPubkey:pubkey(draft.agent_wallet),lamports:20_000_000}));signers=[signer("config")];
 }else{const createPoolParam={name:input.name,symbol:input.symbol,uri:`${config("APP_ORIGIN")}/api/metadata/${draft.id}`,payer,poolCreator:pubkey(draft.agent_wallet),config:pubkey(draft.config_address),baseMint:pubkey(draft.mint),tokenBadge};tx=buy?await client.creator.createPoolWithFirstBuy({createPoolParam,firstBuyParam:{buyer:payer,receiver:payer,buyAmount:buy.amount,minimumAmountOut:buy.minimumAmountOut,referralTokenAccount:null}}):await client.creator.createPool(createPoolParam);signers=[signer("base"),signer("agent")];}
 const latest=await rpc().getLatestBlockhash("confirmed");tx.feePayer=payer;tx.recentBlockhash=latest.blockhash;tx.partialSign(...signers);
 const wire=tx.serialize({requireAllSignatures:false});if(wire.length>1232)throw new HttpError(409,"Launch transaction exceeds the network size limit.");
 const simulation=await rpc().simulateTransaction(VersionedTransaction.deserialize(wire),{sigVerify:false,commitment:"confirmed"});if(simulation.value.err)throw new HttpError(409,"Launch simulation failed. Check SOL balance and quote-token compatibility. No transaction was sent.");
 const op=await prepareOperation(crypto.randomUUID(),`launch:${draft.id}:${draft.stage}`,tx,latest.lastValidBlockHeight,{launchId:draft.id,stage:draft.stage,devBuy});
 return {id:draft.id,initialFeeBps:draftFeeBps(JSON.parse(draft.curve_json)),status:"signature_required",stage:draft.stage,operationId:op.id,transaction:op.wire,mint:draft.mint,devBuy};
}
async function advanceLaunch(draft:Draft,signature:string):Promise<Record<string,unknown>>{
 if(draft.stage==="config"){await database().prepare("UPDATE launch_drafts SET stage='pool' WHERE id=? AND stage='config'").bind(draft.id).run();return prepareLaunchStage({...draft,stage:"pool"});}
 const client=new DynamicBondingCurveClient(rpc(),"finalized"),pool=await client.state.getPool(draft.pool_address),c=await client.state.getPoolConfig(draft.config_address),mint=await getMint(rpc(),pubkey(draft.mint),"finalized",TOKEN_PROGRAM_ID);
 if(!pool||!c||pool.poolState.baseMint.toBase58()!==draft.mint||pool.poolState.config.toBase58()!==draft.config_address||c.feeClaimer.toBase58()!==draft.agent_wallet||c.creatorTradingFeePercentage!==0||c.partnerPermanentLockedLiquidityPercentage!==100||mint.mintAuthority!==null||mint.freezeAuthority!==null||mint.supply!==FIXED_SUPPLY_ATOMS||mint.decimals!==9)throw new HttpError(409,"Launch could not be verified against the fixed token policy.");
 if(nativeLaunchFeeBps(c)!==draftFeeBps(JSON.parse(draft.curve_json))||c.migratedPoolFeeBps!==draftFeeBps(JSON.parse(draft.curve_json)))throw new HttpError(409,"Launch fee does not match its prepared configuration.");
 const input=JSON.parse(draft.input_json) as Input,keys=decryptKeys<{agent:number[]}>(draft.encrypted_keys,`launch:${draft.id}`),now=Date.now(),valuation=JSON.parse(draft.curve_json),db=database();
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO agents(id,owner,pool_address,pool_name,wallet,position_address,model,policy,status) VALUES(?,?,?,?,?,'',?,?,'active')").bind(draft.id,draft.owner,draft.pool_address,`${input.symbol} / quote`,draft.agent_wallet,input.model,JSON.stringify(DEFAULT_POLICY)),
  db.prepare("INSERT OR IGNORE INTO agent_custody(agent_id,base_mint,wallet,encrypted_key,pool_kind,config_address,created_at) VALUES(?,?,?,?,'dbc',?,?)").bind(draft.id,draft.mint,draft.agent_wallet,encryptKeys(keys.agent,`agent:${draft.id}`),draft.config_address,now),
  db.prepare("INSERT OR IGNORE INTO launches(id,owner,name,symbol,mint,signature,pool_address,pool_kind,description,image_url,socials_json,model,quote_mint,verified_at,created_at,graduation_quote,quote_decimals) VALUES(?,?,?,?,?,?,?,'dbc',?,?,?,?,?,?,?,?,?)").bind(draft.id,draft.owner,input.name,input.symbol,draft.mint,signature,draft.pool_address,input.description,`${config("APP_ORIGIN")}/api/metadata/${draft.id}/image`,JSON.stringify({website:input.website||`${config("APP_ORIGIN")}/token/${draft.mint}`,twitter:input.twitter,telegram:input.telegram}),input.model,input.quoteMint,now,now,valuation.graduationMarketCapQuote,valuation.quoteDecimals),
  db.prepare("UPDATE launch_drafts SET stage='complete',encrypted_keys='' WHERE id=?").bind(draft.id),
 ]);return {id:draft.id,initialFeeBps:draftFeeBps(JSON.parse(draft.curve_json)),status:"complete",mint:draft.mint,signature};
}
export async function continueLaunch(id:string,owner:string,submission?:{operationId:string;transaction:string}){return withLock(`launch:${id}`,async()=>{const draft=await draftFor(id,owner);if(submission){const op=await operation(submission.operationId);if(!op||op.purpose!==`launch:${id}:${draft.stage}`)throw new HttpError(400,"Transaction does not belong to this launch stage.");await submitOperation(op.id,submission.transaction);}return prepareLaunchStage(draft);});}
export async function launchMetadata(id:string,image=false){
 const row=await database().prepare("SELECT metadata_json,image_type,image_base64 FROM launch_drafts WHERE id=?").bind(id).first<Pick<Draft,"metadata_json"|"image_type"|"image_base64">>();if(!row)throw new HttpError(404,"Metadata not found.");
 return image?new Response(Buffer.from(row.image_base64,"base64"),{headers:{"Content-Type":row.image_type,"X-Content-Type-Options":"nosniff","Cache-Control":"public, max-age=31536000, immutable"}}):new Response(row.metadata_json,{headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=31536000, immutable"}});
}
