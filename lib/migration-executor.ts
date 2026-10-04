import {DAMM_V2_MIGRATION_FEE_ADDRESS} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {livePool} from "./pool-state";
import {agentSigner} from "./custody";
import {gasBudget} from "./gas-budget";
import {stageOperation} from "./fee-jobs";
import {pubkey} from "./server";
import type {ExecutionJob} from "./asset-ledger";
export async function graduatePool(mint:string){
 const state=await livePool(mint);if(state.graduated||state.pool.poolState.quoteReserve.lt(state.curve.migrationQuoteThreshold))return;
 // The public Meteora keeper can graduate independently. This is a permissionless fallback.
 if(await gasBudget(state.launch.agent_id)<100_000_000n)return;
 const signer=await agentSigner(state.launch.agent_id),job:ExecutionJob={id:`migration:${state.launch.agent_id}`,agent_id:state.launch.agent_id,kind:"migration",status:"reserved",input_mint:"",input_amount:"0",output_mint:null,output_amount:null,context_json:"{}",created_at:Date.now()};
 return stageOperation(job,"graduate",async()=>{const built=await state.dbc.migration.migrateToDammV2({payer:signer.publicKey,pool:pubkey(state.launch.pool_address),dammConfig:DAMM_V2_MIGRATION_FEE_ADDRESS[state.curve.migrationFeeOption]});return {tx:built.transaction,signers:[signer,built.firstPositionNftKeypair,built.secondPositionNftKeypair],context:{mint,pool:state.launch.pool_address}};});
}
