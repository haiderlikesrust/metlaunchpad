/** Creator inputs cannot override these values. Market caps use the full fixed supply. */
export const LAUNCH_ECONOMICS=Object.freeze({supply:1_000_000_000,decimals:9,initialMarketCapSol:20,graduationMarketCapSol:250,initialFeeBps:200});
export const FIXED_SUPPLY_ATOMS=1_000_000_000_000_000_000n;
export const SOL_MINT="So11111111111111111111111111111111111111112";
export type SolPrice={solPrice:number;asOfTimestamp:number;stale:boolean};
export function validateSolPrice(value:unknown,now=Date.now()):SolPrice {
 const p=value as Partial<SolPrice>|null;
 if(!p||typeof p.solPrice!=="number"||!Number.isFinite(p.solPrice)||p.solPrice<=0||p.stale!==false||typeof p.asOfTimestamp!=="number"||!Number.isSafeInteger(p.asOfTimestamp)||now-p.asOfTimestamp>60_000||p.asOfTimestamp>now+5_000)throw new Error("SOL price is unavailable or stale. A fresh price is required.");
 return p as SolPrice;
}
/** Quote conversion is a launch-time snapshot, not a promise of future SOL value. */
export function launchValuation(sol:SolPrice,quote:{mint:string;usdPrice:number;asOfTimestamp:number},now=Date.now()){
 validateSolPrice(sol,now);
 const native=quote.mint===SOL_MINT;
 if(!native&&(!Number.isFinite(quote.usdPrice)||quote.usdPrice<=0||!Number.isSafeInteger(quote.asOfTimestamp)||now-quote.asOfTimestamp>60_000||quote.asOfTimestamp>now+5_000))throw new Error("A fresh quote-token price is required.");
 const ratio=native?1:sol.solPrice/quote.usdPrice;
 const initial=LAUNCH_ECONOMICS.initialMarketCapSol,graduation=LAUNCH_ECONOMICS.graduationMarketCapSol;
 return {initialMarketCapUsd:initial*sol.solPrice,graduationMarketCapUsd:graduation*sol.solPrice,initialMarketCapQuote:initial*ratio,graduationMarketCapQuote:graduation*ratio,initialPriceQuote:initial*ratio/LAUNCH_ECONOMICS.supply,graduationPriceQuote:graduation*ratio/LAUNCH_ECONOMICS.supply,asOfTimestamp:sol.asOfTimestamp};
}
