const token=process.env.AGENT_CRON_TOKEN||"";
if(token.length<32)throw new Error("AGENT_CRON_TOKEN must contain at least 32 characters.");
const origin=process.env.WORKER_API_ORIGIN||"http://web:3000";
let stopping=false,current,stopWait;
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{stopping=true;current?.abort();stopWait?.();});
while(!stopping){
 current=new AbortController();
 const timeout=setTimeout(()=>current.abort(),180000);
 try{const response=await fetch(`${origin}/api/internal/tick`,{method:"POST",headers:{Authorization:`Bearer ${token}`},signal:current.signal});
  // Never log credentials, model prompts, addresses, or raw service responses.
  if(!response.ok)console.error(`THICC worker tick failed (${response.status}).`);
  await response.body?.cancel();
 }catch{if(!stopping)console.error("THICC worker tick could not complete; retrying next interval.");}
 finally{clearTimeout(timeout);}
 if(!stopping)await new Promise(resolve=>{const wait=setTimeout(resolve,60000);stopWait=()=>{clearTimeout(wait);resolve();};});
}
