import {Program,type Idl} from "@coral-xyz/anchor";
import {DynamicBondingCurveIdl,DYNAMIC_BONDING_CURVE_PROGRAM_ID} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {CpAmmIdl,CP_AMM_PROGRAM_ID} from "@meteora-ag/cp-amm-sdk";
import {IDL,LBCLMM_PROGRAM_IDS} from "@meteora-ag/dlmm";
import bs58 from "bs58";
import {Connection,type VersionedTransactionResponse} from "@solana/web3.js";
import {transactionAccountKeys} from './transaction-accounts';
// Program normalizes raw IDL PascalCase/snake_case exactly as the SDK does.
// This provider is only used to construct local coders; no requests are made.
const provider={connection:new Connection("http://127.0.0.1:8899")};
const coders=new Map([[DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),new Program(DynamicBondingCurveIdl as unknown as Idl,provider).coder],[CP_AMM_PROGRAM_ID.toBase58(),new Program(CpAmmIdl as unknown as Idl,provider).coder]]);
coders.set(LBCLMM_PROGRAM_IDS["mainnet-beta"],new Program(IDL as unknown as Idl,provider).coder);
const eventInstruction=Buffer.from("e445a52e51cb9a1d","hex");
export type DecodedEvent={name:string;data:Record<string,any>;index:number;program:string};
/** Decode event-CPI payloads only under the actual deployed program ID. Text logs are not trusted. */
export function chainEvents(tx:VersionedTransactionResponse):DecodedEvent[]{
 if(!tx.meta||tx.meta.err)return [];
 const keys=transactionAccountKeys(tx);
 const result:DecodedEvent[]=[];let index=0;
 for(const group of tx.meta.innerInstructions||[])for(const ix of group.instructions){index++;const program=keys[ix.programIdIndex]?.toString(),coder=coders.get(program);if(!coder)continue;const bytes=Buffer.from(bs58.decode(ix.data));if(bytes.length<16||!bytes.subarray(0,8).equals(eventInstruction))continue;
  try{const decoded=coder.events.decode(bytes.subarray(8).toString("base64"));if(decoded)result.push({name:decoded.name,data:decoded.data,index,program});}catch{/* Unknown version does not become invented trade data. */}
 }return result;
}
