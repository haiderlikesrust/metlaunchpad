"use client";

import {useEffect,useState} from "react";
import {ArrowUpRight,Check,Copy} from "lucide-react";

export default function SiteFooter(){
 const [mint,setMint]=useState<string|null>(null);
 const [copyState,setCopyState]=useState<"idle"|"copied"|"failed">("idle");
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/brand",{cache:"no-store",signal:controller.signal})
   .then(async response=>{if(response.ok){const data=await response.json() as {thiccMint?:unknown};if(typeof data.thiccMint==="string")setMint(data.thiccMint);}})
   .catch(()=>{});
  return()=>controller.abort();
 },[]);
 useEffect(()=>{if(copyState==="idle")return;const timeout=setTimeout(()=>setCopyState("idle"),3000);return()=>clearTimeout(timeout);},[copyState]);
 async function copyMint(){if(!mint)return;try{await navigator.clipboard.writeText(mint);setCopyState("copied");}catch{setCopyState("failed");}}
 return <div className="site-footer-wrap"><footer className="site-footer">
  <div className="site-footer-brand"><a href="/" aria-label="THICC home"><img src="/thicc-logo.png" alt="thicc"/></a><p>Good tokens deserve deep liquidity.</p></div>
  <nav className="site-footer-links" aria-label="Footer"><span>Built on <strong>Meteora</strong></span><a href="/docs">Documentation <ArrowUpRight size={13}/></a><a href="https://x.com/thiccdotmoney" target="_blank" rel="noopener noreferrer" aria-label="THICC on X">𝕏 <span>@thiccdotmoney</span><ArrowUpRight size={13}/></a></nav>
  {mint&&<section className="site-footer-contract" aria-label="Official THICC contract address"><span className="site-footer-contract-label">Official THICC CA</span><a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer" title="View official THICC token on Solscan"><code>{mint}</code><ArrowUpRight size={13}/></a><button onClick={copyMint} aria-label="Copy official THICC contract address">{copyState==="copied"?<Check size={14}/>:<Copy size={14}/>}<span aria-live="polite">{copyState==="copied"?"Copied":copyState==="failed"?"Select address to copy":"Copy"}</span></button></section>}
 </footer></div>;
}
