const token=process.env.AGENT_CRON_TOKEN||"";
if(token.length<32)throw new Error("AGENT_CRON_TOKEN must contain at least 32 characters.");
const origin=process.env.WORKER_API_ORIGIN||"http://web:3187";
const stop=new AbortController();for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>stop.abort());
async function loop(path,interval,timeout){
 while(!stop.signal.aborted){const start=Date.now();
  try{const response=await fetch(`${origin}/api/internal/${path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.any([stop.signal,AbortSignal.timeout(timeout)])});
   if(!response.ok&&response.status!==409)console.error(`THICC ${path} failed (${response.status}).`);
   await response.body?.cancel();
  }catch{if(!stop.signal.aborted)console.error(`THICC ${path} delayed; retrying.`);}
  if(stop.signal.aborted)break;
  await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);stop.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,Math.max(250,interval-(Date.now()-start)));stop.signal.addEventListener('abort',finish,{once:true});});
 }
}
// Independent lanes: slow inference and payments never block market reads or claim scheduling.
await Promise.all([loop('market-tick',2000,120000),loop('claim-tick',3000,180000),loop('tick',10000,230000)]);
