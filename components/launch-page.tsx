"use client";
import SiteNav from "./site-nav";

import {useEffect,useState} from "react";
import {ArrowLeft,Wallet} from "lucide-react";
import LaunchForm from "./launch-form";
import {short} from "@/lib/types";
type Phantom={publicKey?:{toString:()=>string};connect:()=>Promise<{publicKey:{toString:()=>string}}>;signMessage:(message:Uint8Array)=>Promise<{signature:Uint8Array}>};
async function request(path:string,body:unknown){const r=await fetch(`/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json() as {error?:string;message:string};if(!r.ok)throw new Error(d.error||"Wallet verification failed.");return d;}
export default function LaunchPage(){
 const [wallet,setWallet]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{fetch("/api/account").then(async r=>{if(r.ok){const d=await r.json() as {wallet?:string};setWallet(d.wallet||"");}}).catch(()=>{});},[]);
 async function connect(){setBusy(true);setError("");try{const phantom=(window as unknown as {phantom?:{solana?:Phantom}}).phantom?.solana;if(!phantom)throw new Error("Open THICC in a browser with Phantom installed.");const result=await phantom.connect();const address=result.publicKey.toString();const challenge=await request("wallet/challenge",{wallet:address});const signed=await phantom.signMessage(new TextEncoder().encode(challenge.message));const {default:bs58}=await import("bs58");await request("wallet/verify",{wallet:address,signature:bs58.encode(signed.signature)});setWallet(address);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="app-shell"><SiteNav active="Launch" wallet={wallet} onWallet={connect} busy={busy}/><main className="launch-page"><div className="breadcrumb">CREATE SOMETHING THICC <span>/</span> LAUNCH</div><section className="page-heading"><div><h1>Give your coin a brain<span className="orange-text">.</span></h1><p>A coin of your own. Liquidity that thinks for itself.</p></div></section>{error&&<div className="callout negative" role="alert">{error}</div>}<LaunchForm wallet={wallet} onWallet={connect}/></main></div>;
}
