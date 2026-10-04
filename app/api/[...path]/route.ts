import {z} from "zod";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {Transaction} from "@solana/web3.js";
import {account,boundWallet,config,database,event,HttpError,meteora,owner,poolData,pubkey,rpc,safeError,sameOrigin} from "@/lib/server";
import {publicModelOptions,resolveAgentModel} from "@/lib/model-routing";



import {runAgent,type AgentRow} from "@/lib/agent-runner";

function pathOf(r:Request){return new URL(r.url).pathname.replace(/^\/api\//,"");}
export async function GET(request:Request){try{const path=pathOf(request);const url=new URL(request.url);
 if(/^metadata\/[a-zA-Z0-9-]+(?:\/image)?$/.test(path)){const {launchMetadata}=await import("@/lib/launch-executor");return launchMetadata(path.split("/")[1],path.endsWith("/image"));}
 if(path==="agent-analytics"){const {agentAnalytics}=await import("@/lib/agent-analytics");return Response.json(await agentAnalytics(url.searchParams.get("window")||"24h"),{headers:{"Cache-Control":"no-store"}});}
 if(/^token\/[^/]+\/candles$/.test(path)){const {tokenCandles}=await import("@/lib/token-candles");return Response.json(await tokenCandles(path.split("/")[1],url.searchParams.get("interval")||"1m"),{headers:{"Cache-Control":"no-store"}});}
 if(path.startsWith("coin/")){const {coinDetail}=await import("@/lib/coin-detail");return Response.json(await coinDetail(path.slice(5)),{headers:{"Cache-Control":"private, max-age=15"}});}
 if(path==="coins"||path==="pools"){const {thiccCoins}=await import("@/lib/coins");return Response.json(await thiccCoins(url,url.searchParams.get("mine")==="1"?owner(request):undefined),{headers:{"Cache-Control":"private, max-age=15"}});}
 if(path==="sol-price"){const {solPrice}=await import("@/lib/sol-price");return Response.json(await solPrice(),{headers:{"Cache-Control":"no-store"}});}
 if(path==="quotes"){const {quoteTokens}=await import("@/lib/quote-tokens");return Response.json({quotes:await quoteTokens()},{headers:{"Cache-Control":"private, max-age=60"}});}
 if(path==="models")return Response.json({models:publicModelOptions()},{headers:{"Cache-Control":"private, max-age=300"}});
 if(path==="health"){await database().prepare("SELECT id FROM chain_operations LIMIT 1").first();return Response.json({rpc:!!config("QUICKNODE_RPC_URL"),openrouter:!!config("OPENROUTER_API_KEY"),credits:!!config("OPENROUTER_MANAGEMENT_KEY"),worker:!!config("AGENT_CRON_TOKEN"),database:!!database(),custody:Buffer.from(config("AGENT_WALLET_ENCRYPTION_KEY"),"base64").length===32,swaps:!!config("JUPITER_API_KEY"),executionPaused:config("EXECUTION_PAUSED")==="true",network:"mainnet-beta"});}
 const id=owner(request);
 if(path==="launch/resume"){const {continueLaunch}=await import("@/lib/launch-executor");return Response.json(await continueLaunch(url.searchParams.get("id")||"",id));}
 if(path==="launch/drafts"){const rows=await database().prepare("SELECT id,mint,input_json,stage,created_at FROM launch_drafts WHERE owner=? AND stage!='complete' ORDER BY created_at DESC LIMIT 5").bind(id).all();return Response.json({drafts:rows.results});}
 if(path==="account"){const acc=await account(id);return Response.json({wallet:acc?.wallet,});}
 if(path==="agents"){const rows=await database().prepare("SELECT a.*,(SELECT COALESCE(SUM(usd_micros),0) FROM fee_receipts r WHERE r.agent_id=a.id) AS claimed FROM agents a WHERE a.owner=? ORDER BY a.rowid DESC").bind(id).all<AgentRow&{claimed:number}>();return Response.json({agents:rows.results.map(r=>({id:r.id,poolAddress:r.pool_address,poolName:r.pool_name,wallet:r.wallet,positionAddress:r.position_address,model:r.model,policy:JSON.parse(r.policy),status:r.status==="active"&&r.claimed<20_000_000?"awaiting_fees":r.status,lastRun:r.last_run}))});}
 if(path==="events"){const rows=await database().prepare("SELECT id,agent_id AS agentId,kind,message,created_at AS createdAt FROM events WHERE owner=? ORDER BY created_at DESC LIMIT 30").bind(id).all();return Response.json({events:rows.results});}
 if(path==="positions"){const wallet=await boundWallet(id);const address=url.searchParams.get("pool")||"";const {ownedPositions}=await import("@/lib/transactions");const {positions,pool}=await ownedPositions(wallet,address);return Response.json({tokenX:pool.tokenX.publicKey.toBase58(),tokenY:pool.tokenY.publicKey.toBase58(),decimalsX:pool.tokenX.mint.decimals,decimalsY:pool.tokenY.mint.decimals,positions:positions.map(p=>({address:p.publicKey.toBase58(),amountX:p.positionData.totalXAmount,amountY:p.positionData.totalYAmount,feeX:p.positionData.feeX.toString(),feeY:p.positionData.feeY.toString()}))});}
 throw new HttpError(404,"Not found.");
 }catch(error){return safeError(error);}}

export async function POST(request:Request){try{sameOrigin(request);const path=pathOf(request);const {boundedRequest}=await import("@/lib/request-limit");request=await boundedRequest(request,path==="launch/prepare"?1_020_000:50000);if(Number(request.headers.get("content-length"))>(path==="launch/prepare"?1_020_000:50000))throw new HttpError(413,"Request too large.");
 if(path==="internal/tick"){const token=config("AGENT_CRON_TOKEN");if(!token||request.headers.get("authorization")!==`Bearer ${token}`)throw new HttpError(401,"Unauthorized worker.");const {workerCycle}=await import("@/lib/worker-cycle");return Response.json(await workerCycle());}
 if(config("THICC_RUNTIME")==="node"&&["wallet/challenge","wallet/verify","wallet/disconnect"].includes(path)){const {walletAuth}=await import("@/lib/wallet-auth");return walletAuth(request,path);}
 const id=owner(request);
 if(path==="launch/prepare"){const wallet=await boundWallet(id);const {createLaunch}=await import("@/lib/launch-executor");return Response.json(await createLaunch(id,wallet,await request.formData(),request.headers.get("idempotency-key")||""));}
 const body=await request.json() as Record<string,unknown>;
 if(path==="trade/prepare"){const input=z.object({mint:z.string(),side:z.enum(["buy","sell"]),amount:z.string().max(40),slippageBps:z.number().int().min(1).max(50)}).strict().parse(body);const {prepareTrade}=await import("@/lib/trading");return Response.json(await prepareTrade(id,await boundWallet(id),input.mint,input.side,input.amount,input.slippageBps));}
 if(path==="trade/submit"){const input=z.object({operationId:z.string(),transaction:z.string().max(5000)}).strict().parse(body);const {submitTrade}=await import("@/lib/trading");return Response.json(await submitTrade(id,input.operationId,input.transaction));}
 if(path==="launch/submit"){const input=z.object({id:z.string(),operationId:z.string(),transaction:z.string().max(5000)}).parse(body);const {continueLaunch}=await import("@/lib/launch-executor");return Response.json(await continueLaunch(input.id,id,input));}
 if(path==="wallet/challenge"){const address=z.string().parse(body.wallet);pubkey(address);await account(id);const message=`THICC wallet verification\nOrigin: ${new URL(request.url).origin}\nWallet: ${address}\nNonce: ${crypto.randomUUID()}\nExpires: ${Date.now()+300000}\nThis signature does not authorize transactions.`;await database().prepare("UPDATE accounts SET nonce=?,nonce_expires=? WHERE id=?").bind(message,Date.now()+300000,id).run();return Response.json({message});}
 if(path==="wallet/verify"){const input=z.object({wallet:z.string(),signature:z.string().max(128)}).parse(body);const acc=await account(id);if(!acc?.nonce||!acc.nonce_expires||acc.nonce_expires<Date.now()||!acc.nonce.includes(`Wallet: ${input.wallet}\n`))throw new HttpError(401,"Wallet challenge expired. Reconnect your wallet.");if(!nacl.sign.detached.verify(new TextEncoder().encode(acc.nonce),bs58.decode(input.signature),pubkey(input.wallet).toBytes()))throw new HttpError(401,"Invalid wallet signature.");const updated=await database().prepare("UPDATE accounts SET wallet=?,nonce=NULL,nonce_expires=NULL WHERE id=? AND nonce=?").bind(input.wallet,id,acc.nonce).run();if(!updated.meta.changes)throw new HttpError(409,"Challenge has already been used.");return Response.json({wallet:input.wallet});}
 if(path==="wallet/disconnect"){await database().prepare("UPDATE accounts SET wallet=NULL,nonce=NULL WHERE id=?").bind(id).run();return Response.json({ok:true});}
 if(path==="settings")throw new HttpError(403,"Platform settings are managed by the server environment.");
 if(path==="agents")throw new HttpError(403,"Agents are assigned automatically to verified THICC launches.");
 if(path==="agents/status")throw new HttpError(403,"Agent lifecycle is managed automatically by the protocol.");
 if(path==="agents/run"){throw new HttpError(403,"Agent execution is managed by the background worker.");}
 if(path==="funding/check")throw new HttpError(403,"Funding is managed by the authenticated background worker.");
 if(path.startsWith("tx/")){const {addLiquidity}=await import("@/lib/transactions");const wallet=await boundWallet(id);
  if(path==="tx/mint"||path==="tx/pool"){throw new HttpError(503,"Locked launch execution is not enabled: native fee-right assignment and executor integration must be verified first.");}
  if(path==="tx/liquidity"){const input=z.object({poolAddress:z.string(),amountX:z.string().max(40),amountY:z.string().max(40),width:z.number().int().min(2).max(34)}).parse(body);return Response.json(await addLiquidity(wallet,input));}
  if(path==="tx/submit"){const raw=z.string().max(5000).parse(body.transaction);const tx=Transaction.from(Buffer.from(raw,"base64"));if(!tx.feePayer?.equals(wallet)||!tx.verifySignatures())throw new HttpError(400,"Transaction is not fully signed by the connected wallet.");const signature=await rpc().sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:2});return Response.json({signature});}
  if(path==="tx/status"){const signature=z.string().min(70).max(100).parse(body.signature);const result=await rpc().getSignatureStatuses([signature],{searchTransactionHistory:true});return Response.json({status:result.value[0]});}
 }
 throw new HttpError(404,"Not found.");
 }catch(error){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")},{status:400});return safeError(error);}}
