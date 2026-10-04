import type {VersionedTransactionResponse} from "@solana/web3.js";
export function tokenDelta(tx:VersionedTransactionResponse,wallet:string,mint:string){
 const sum=(rows:NonNullable<VersionedTransactionResponse["meta"]>["preTokenBalances"])=>rows?.filter(r=>r.owner===wallet&&r.mint===mint).reduce((s,r)=>s+BigInt(r.uiTokenAmount.amount),0n)||0n;
 return sum(tx.meta?.postTokenBalances)-sum(tx.meta?.preTokenBalances);
}
