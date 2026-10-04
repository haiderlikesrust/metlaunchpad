import {HttpError} from "./server";
import {validateSolPrice} from "./launch-economics";
export async function solPrice(){
 try{const r=await fetch("https://frontend-api-v3.pump.fun/sol-price",{signal:AbortSignal.timeout(8000),cache:"no-store"});if(!r.ok)throw new Error("Price request failed");return validateSolPrice(await r.json());}
 catch{throw new HttpError(503,"Live SOL/USD price is unavailable or stale. Please retry shortly.");}
}
