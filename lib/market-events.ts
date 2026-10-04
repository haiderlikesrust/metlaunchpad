import {chainEvents,type DecodedEvent} from './chain-events';
import {swapAmounts} from './swap-event';
import type {VersionedTransactionResponse} from '@solana/web3.js';
/** Meteora emits legacy and v2 compatibility events for the SAME swap. */
export function uniqueSwapEvents(events:DecodedEvent[]){return events.filter((event,i)=>{
 const next=events[i+1];if(!next)return true;
 const pair=(event.name==='evtSwap'&&next.name==='evtSwap2')||(event.name==='swap'&&next.name==='swap2Evt');
 if(!pair||next.index!==event.index+1||event.program!==next.program||String(event.data.pool??event.data.lbPair)!==String(next.data.pool??next.data.lbPair))return true;
 const a=swapAmounts(event),b=swapAmounts(next);return !(a&&b&&a.sell===b.sell&&a.base===b.base&&a.quote===b.quote);
 });}
export function poolSwapEvents(tx:VersionedTransactionResponse,pool:string){return uniqueSwapEvents(chainEvents(tx).filter(e=>(e.name.startsWith('evtSwap')||e.name==='swap'||e.name==='swap2Evt')&&String(e.data.pool??e.data.lbPair)===pool));}
