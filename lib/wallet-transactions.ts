import {Transaction} from "@solana/web3.js";
type Provider={publicKey?:{toString:()=>string};signTransaction:(tx:Transaction)=>Promise<Transaction>};
export async function signWalletTransaction(wire:string,expectedWallet:string){
 const w=window as unknown as {phantom?:{solana?:Provider};solana?:Provider},provider=w.phantom?.solana||w.solana;
 if(!provider||provider.publicKey?.toString()!==expectedWallet)throw new Error("Reconnect the wallet that started this transaction.");
 const bytes=Uint8Array.from(atob(wire),c=>c.charCodeAt(0)),tx=Transaction.from(bytes),signed=await provider.signTransaction(tx);
 return btoa(String.fromCharCode(...signed.serialize()));
}
