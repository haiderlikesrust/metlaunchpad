import type {PublicKey,VersionedTransactionResponse} from '@solana/web3.js';

/** Legacy Message.staticAccountKeys is a getter, so JSON storage only retains accountKeys. */
export function transactionAccountKeys(tx:VersionedTransactionResponse):string[]{
 const message=tx.transaction.message as unknown as {staticAccountKeys?:Array<PublicKey|string>;accountKeys?:Array<PublicKey|string>};
 const keys=message.staticAccountKeys??message.accountKeys;
 if(!Array.isArray(keys))throw new Error('Transaction account keys are unavailable.');
 return [...keys,...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])].map(String);
}
