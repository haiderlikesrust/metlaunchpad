import test from "node:test";
import assert from "node:assert/strict";
import {Program,type Idl} from "@coral-xyz/anchor";
import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction,type VersionedTransactionResponse} from "@solana/web3.js";
import {DynamicBondingCurveIdl,DYNAMIC_BONDING_CURVE_PROGRAM_ID} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {CpAmmIdl,CP_AMM_PROGRAM_ID} from "@meteora-ag/cp-amm-sdk";
import {IDL,LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import BN from "bn.js";
import bs58 from "bs58";
import {chainEvents} from "./chain-events";
test("authenticated DBC and DAMM event CPI receipts decode using normalized SDK names",()=>{
 for(const [idl,programId,name,data] of [
  [DynamicBondingCurveIdl,DYNAMIC_BONDING_CURVE_PROGRAM_ID,"evtClaimTradingFee",{pool:Keypair.generate().publicKey,tokenBaseAmount:new BN(0),tokenQuoteAmount:new BN(12345)}],
  [CpAmmIdl,CP_AMM_PROGRAM_ID,"evtClaimPositionFee",{pool:Keypair.generate().publicKey,position:Keypair.generate().publicKey,owner:Keypair.generate().publicKey,feeAClaimed:new BN(22),feeBClaimed:new BN(33)}],
  [IDL,new PublicKey(LBCLMM_PROGRAM_IDS['mainnet-beta']),"claimFee2",{lbPair:Keypair.generate().publicKey,position:Keypair.generate().publicKey,owner:Keypair.generate().publicKey,feeX:new BN(22),feeY:new BN(33),activeBinId:0}],
 ] as const){const program=new Program(idl as unknown as Idl,{connection:new Connection("http://localhost:8899")}),discriminator=program.idl.events!.find(e=>e.name===name)!.discriminator,encoded=Buffer.concat([Buffer.from("e445a52e51cb9a1d","hex"),Buffer.from(discriminator),program.coder.types.encode(name,data)]);
  const message=new TransactionMessage({payerKey:programId,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message(),tx={transaction:{message},meta:{err:null,innerInstructions:[{index:0,instructions:[{programIdIndex:0,data:bs58.encode(encoded),accounts:[]}]}]}} as unknown as VersionedTransactionResponse;
  const decoded=chainEvents(tx)[0];assert.equal(decoded.name,name);assert.equal((decoded.data.pool??decoded.data.lbPair).toString(),('pool' in data?data.pool:data.lbPair).toBase58());
  // Stored JSON receipts must decode identically after a server restart.
  assert.equal(chainEvents(JSON.parse(JSON.stringify(tx)))[0].name,name);
  message.staticAccountKeys[0]=Keypair.generate().publicKey;assert.equal(chainEvents(tx).length,0,"Spoofed emitting program accepted");
 }
});
