import {config,database,pubkey} from "./server";

/** The receipt trigger reserves 10% in the same DB transaction as each verified
 * fee receipt, before any agent can act. This monitor has no model dependency.
 * Reservations are accounting records, never evidence of a swap or a burn.
 */
export async function monitorBuybacks(){
 const value=config("THICC_TOKEN_MINT");
 if(!value)return {status:"awaiting_configuration",reason:"The main THICC mint has not been set."};
 const mint=pubkey(value).toBase58(),db=database();
 // Snapshot the mint once per reservation. Changing environment configuration
 // cannot redirect already assigned purchases to another token.
 await db.prepare("UPDATE fee_buybacks SET target_mint=?,status='awaiting_execution' WHERE target_mint IS NULL AND status='awaiting_configuration'").bind(mint).run();
 const pending=await db.prepare("SELECT COUNT(*) AS count FROM fee_buybacks WHERE status IN ('awaiting_configuration','awaiting_execution')").first<{count:number}>();
 return {status:"awaiting_execution",pending:pending?.count||0,reason:"Purchase and burn execution requires the verified token-unit claim indexer and custody executor."};
}
