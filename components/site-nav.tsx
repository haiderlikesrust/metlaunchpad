"use client";

import {useEffect,useState} from "react";
import {ArrowUpRight,BookOpen,Bot,Compass,Layers3,LoaderCircle,Wallet} from "lucide-react";
import {short} from "@/lib/types";
import type {DashboardView} from "@/lib/navigation";

type Section="Explore"|"My coins"|"Agents"|"Docs"|"Launch"|"Token";
const links=[
 {label:"Explore",href:"/",icon:Compass},
 {label:"My coins",href:"/?view=my-coins",icon:Layers3},
 {label:"Agents",href:"/?view=agents",icon:Bot},
 {label:"Docs",href:"/docs",icon:BookOpen},
] as const;

export default function SiteNav({active,wallet,onWallet,onNavigate,busy=false}:{active:Section;wallet?:string;onWallet?:()=>void;onNavigate?:(view:DashboardView)=>void;busy?:boolean}){
 const [accountWallet,setAccountWallet]=useState(""),[connecting,setConnecting]=useState(false),[error,setError]=useState("");
 useEffect(()=>{if(wallet!==undefined)return;let mounted=true;fetch("/api/account").then(async r=>{if(r.ok){const data=await r.json() as {wallet?:string};if(mounted)setAccountWallet(data.wallet||"");}}).catch(()=>{});return()=>{mounted=false;};},[wallet]);
 async function connect(){
  if(onWallet){onWallet();return;}
  setConnecting(true);setError("");
  try{
   const phantom=(window as unknown as {phantom?:{solana?:{connect:()=>Promise<{publicKey:{toString:()=>string}}>;signMessage:(message:Uint8Array)=>Promise<{signature:Uint8Array}>}}}).phantom?.solana;
   if(!phantom)throw new Error("Open THICC in a browser with Phantom installed.");
   const address=(await phantom.connect()).publicKey.toString();
   async function post(path:string,body:unknown){const response=await fetch(`/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await response.json() as {message:string;error?:string};if(!response.ok)throw new Error(data.error||"Wallet verification failed.");return data;}
   const challenge=await post("wallet/challenge",{wallet:address});
   const signed=await phantom.signMessage(new TextEncoder().encode(challenge.message));
   const {default:bs58}=await import("bs58");
   await post("wallet/verify",{wallet:address,signature:bs58.encode(signed.signature)});setAccountWallet(address);
  }catch(e){setError((e as Error).message);}finally{setConnecting(false);}
 }
 const address=wallet??accountWallet;
 return <header className="site-nav-wrap"><div className="site-nav-shell">
  <a className="site-brand" href="/" aria-label="THICC home"><img src="/thicc-logo.png" alt="thicc"/><span className="site-brand-caption"><i/> THE LIQUIDITY LAYER</span></a>
  <nav className="site-nav-track" aria-label="Main navigation">{links.map(({label,href,icon:Icon})=><a key={label} href={href} onClick={event=>{if(onNavigate&&label!=="Docs"&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(label);}}} className={active===label?"is-current":""} aria-current={active===label?"page":undefined}><Icon size={15}/><span>{label}</span>{active===label&&<i className="site-nav-dot"/>}</a>)}</nav>
  <div className="site-nav-actions"><button className="site-wallet" disabled={busy||connecting} onClick={connect} aria-label={address?`Wallet ${address}`:"Connect wallet"}>{busy||connecting?<LoaderCircle size={16} className="spin"/>:<Wallet size={16}/>}<span>{busy||connecting?"Connecting…":address?short(address):"Connect wallet"}</span></button><a className={`site-launch ${active==="Launch"?"is-current":""}`} href="/launch" aria-current={active==="Launch"?"page":undefined}><span>Launch</span><ArrowUpRight size={18}/></a></div>
 </div>{error&&<div className="site-nav-error" role="alert">{error}<button onClick={()=>setError("")} aria-label="Dismiss wallet error">×</button></div>}</header>;
}
