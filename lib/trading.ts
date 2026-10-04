import BN from "bn.js";
import {CpAmm} from "@meteora-ag/cp-amm-sdk";
import {PublicKey,VersionedTransaction} from "@solana/web3.js";
import {database,HttpError,pubkey,rpc} from "./server";
import {livePool,mintInfo} from "./pool-state";
import {operation,prepareOperation,submitOperation} from "./chain-journal";
import {atomic} from "./transactions";

export async function prepareTrade(owner:string,wallet:PublicKey,mint:string,side:"buy"|"sell",amount:string,slippageBps:number){
 const state=await livePool(mint),connection=rpc(),inputMint=side==="buy"?state.launch.quote_mint:mint,outputMint=side==="buy"?mint:state.launch.quote_mint,amountIn=atomic(amount,side==="buy"?state.launch.quote_decimals:9);
 let tx,minimumAmountOut:BN,expectedOut:BN;
 if(state.graduated&&state.dammState){
  const sdk=new CpAmm(connection),p=state.dammState,[a,b,epoch,slot]=await Promise.all([mintInfo(mint),mintInfo(state.launch.quote_mint),connection.getEpochInfo(),connection.getSlot()]);
  const quote=sdk.getQuote({inAmount:amountIn,inputTokenMint:pubkey(inputMint),slippage:slippageBps/100,poolState:p,currentTime:Math.floor(Date.now()/1000),currentSlot:slot,tokenADecimal:9,tokenBDecimal:b.mint.decimals,inputTokenInfo:{mint:side==="buy"?b.mint:a.mint,currentEpoch:epoch.epoch},outputTokenInfo:{mint:side==="buy"?a.mint:b.mint,currentEpoch:epoch.epoch}});
  minimumAmountOut=quote.minSwapOutAmount;expectedOut=quote.swapOutAmount;
  tx=await sdk.swap({payer:wallet,pool:pubkey(state.graduated),inputTokenMint:pubkey(inputMint),outputTokenMint:pubkey(outputMint),amountIn,minimumAmountOut,tokenAMint:p.tokenAMint,tokenBMint:p.tokenBMint,tokenAVault:p.tokenAVault,tokenBVault:p.tokenBVault,tokenAProgram:a.program,tokenBProgram:b.program,referralTokenAccount:null,poolState:p});
 }else{
  if(state.pool.poolState.quoteReserve.gte(state.curve.migrationQuoteThreshold))throw new HttpError(409,"Graduation is in progress. Trading resumes once migration finalizes.");
  const quote=state.dbc.pool.swapQuote({virtualPool:state.pool,config:state.curve,swapBaseForQuote:side==="sell",amountIn,slippageBps,hasReferral:false,eligibleForFirstSwapWithMinFee:false,currentPoint:new BN(Math.floor(Date.now()/1000))});
  minimumAmountOut=quote.minimumAmountOut;expectedOut=quote.outputAmount;
  tx=await state.dbc.pool.swap({owner:wallet,pool:pubkey(state.launch.pool_address),amountIn,minimumAmountOut,swapBaseForQuote:side==="sell",referralTokenAccount:null});
 }
 const latest=await connection.getLatestBlockhash();tx.feePayer=wallet;tx.recentBlockhash=latest.blockhash;
 const simulation=await connection.simulateTransaction(VersionedTransaction.deserialize(tx.serialize({requireAllSignatures:false})),{sigVerify:false});if(simulation.value.err)throw new HttpError(409,"Trade simulation failed. Check your balance or try a smaller amount.");
 const op=await prepareOperation(crypto.randomUUID(),"user_swap",tx,latest.lastValidBlockHeight,{owner,wallet:wallet.toBase58(),mint,side,inputMint,outputMint,amountIn:amountIn.toString(),minimumAmountOut:minimumAmountOut.toString()});
 return {operationId:op.id,transaction:op.wire,expectedOut:expectedOut.toString(),minimumOut:minimumAmountOut.toString(),outputDecimals:side==="buy"?9:state.launch.quote_decimals};
}
export async function submitTrade(owner:string,id:string,wire:string){const op=await operation(id);if(!op||op.purpose!=="user_swap"||JSON.parse(op.context_json).owner!==owner)throw new HttpError(404,"Trade not found.");const result=await submitOperation(id,wire);return {status:result.status,signature:result.signature};}
