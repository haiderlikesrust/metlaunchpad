import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {VersionedTransactionResponse} from '@solana/web3.js';
import {chainEvents} from './chain-events';
import {poolSwapEvents,uniqueSwapEvents} from './market-events';
import {swapAmounts} from './swap-event';
import {activationProgress} from './fee-types';
import {chartTrades,type ChartSwap} from './chart-trades';
import {liveCache} from './live-cache';
import {transactionAccountKeys} from './transaction-accounts';
test('finalized legacy DBC claim survives JSON storage and counts the exact fee event',()=>{
 const tx=JSON.parse(readFileSync(new URL('./fixtures/dbc-legacy-claim.json',import.meta.url),'utf8')) as VersionedTransactionResponse;
 assert.equal(tx.version,'legacy');assert.equal(tx.transaction.message.staticAccountKeys,undefined);
 assert.equal(transactionAccountKeys(tx)[0],'8ci26pPM1kzNDwRDrhFPKo45FauVt19is2UNJkgUve8h');
 const events=chainEvents(tx);assert.equal(events.length,1);assert.equal(events[0].name,'evtClaimTradingFee');
 assert.equal(events[0].data.pool.toString(),'EzJDWosWjvABsiDkYcFLR6P33FEj9rg3YGfDsyp3kw8F');
 assert.equal(events[0].data.tokenBaseAmount.toString(),'0');assert.equal(events[0].data.tokenQuoteAmount.toString(),'147017046');
 assert.deepEqual(chainEvents({...tx,meta:{...tx.meta!,err:{InstructionError:[0,'InvalidAccountData']}}}),[]);
});
test('stored v0 transactions preserve lookup-table account index ordering',()=>{
 const tx={transaction:{message:{staticAccountKeys:['payer','program']}},meta:{loadedAddresses:{writable:['vault'],readonly:['mint']}}} as unknown as VersionedTransactionResponse;
 assert.deepEqual(transactionAccountKeys(tx),['payer','program','vault','mint']);
 assert.throws(()=>transactionAccountKeys({transaction:{message:{}}} as VersionedTransactionResponse),/keys are unavailable/);
});
test('actual finalized version 1 DBC trade emits two compatibility events but counts once',()=>{
 const tx=JSON.parse(readFileSync(new URL('./fixtures/dbc-v1-swap.json',import.meta.url),'utf8')) as VersionedTransactionResponse;
 assert.equal(tx.version,1);assert.deepEqual(chainEvents(tx).filter(e=>e.name.startsWith('evtSwap')).map(e=>e.name),['evtSwap','evtSwap2']);
 const events=poolSwapEvents(tx,'EzJDWosWjvABsiDkYcFLR6P33FEj9rg3YGfDsyp3kw8F');assert.equal(events.length,1);assert.equal(events[0].name,'evtSwap2');assert.ok(swapAmounts(events[0])!.quote>0n);
 assert.equal(poolSwapEvents(tx,'another-pool').length,0);
 const two=[...chainEvents(tx),...chainEvents(tx).map(e=>({...e,index:e.index+10}))];assert.equal(uniqueSwapEvents(two).filter(e=>e.name.startsWith('evtSwap')).length,2,'Equal amounts in separate swaps must remain separate');
});
test('activation uses verified claim value and caps display without capping lifetime earnings',()=>{
 assert.equal(activationProgress(0).percent,0);assert.equal(activationProgress(19.99).active,false);assert.equal(activationProgress(20).active,true);assert.equal(activationProgress(40).percent,100);assert.equal(activationProgress(40).claimedUsd,40);
});
test('unpriced history uses a consistent explicitly current quote rate, preserving raw amounts',()=>{
 const row:ChartSwap={id:'a',at:1000,slot:1,transaction_index:0,instruction_index:0,base_amount:'2000000000',quote_amount:'1000000000',price_usd:null,volume_usd:null};
 const converted=chartTrades([row,{...row,id:'b',price_usd:30,volume_usd:60}],9,100)!;assert.equal(converted.valuation,'current-quote-usd');assert.deepEqual(converted.trades.map(r=>[r.priceUsd,r.volumeUsd]),[[50,100],[50,100]]);
 assert.equal(chartTrades([row],9,null),null);assert.equal(chartTrades([{...row,price_usd:30,volume_usd:60}],9,null)!.valuation,'historical-usd');
});
test('concurrent viewers share an in-flight read and failed reads remain retryable',async()=>{
 const cache=liveCache<number>(1000);let calls=0,resolve!:(n:number)=>void;const read=()=>{calls++;return new Promise<number>(r=>resolve=r);};
 const a=cache('a',read),b=cache('a',read);assert.equal(calls,1);resolve(7);assert.deepEqual(await Promise.all([a,b]),[7,7]);assert.equal(await cache('a',read),7);
 await assert.rejects(cache('b',async()=>{throw new Error('temporary');}));assert.equal(await cache('b',async()=>8),8);
});
