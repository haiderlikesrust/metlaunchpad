import test from "node:test";
import assert from "node:assert/strict";
import {aggregateCandles,type TradePoint} from "./candles";
import {curveProgress} from "./coin-types";
import {comparison,type AnalyticsCoin} from "./agent-analytics-types";
const trade=(id:string,at:number,priceUsd:number,volumeUsd:number,transactionIndex=0):TradePoint=>({id,at,priceUsd,volumeUsd,slot:1,transactionIndex,instructionIndex:0});
test("OHLCV orders verified swaps, deduplicates signatures and leaves gaps empty",()=>{
 const trades=[trade("b",61000,12,24),trade("a",60000,10,10),trade("c",62000,9,18),trade("d",180000,11,22)];
 const data=aggregateCandles([...trades,trades[0]],"1m");
 assert.deepEqual(data,[{time:60,open:10,high:12,low:9,close:9,volume:52},{time:180,open:11,high:11,low:11,close:11,volume:22}]);
 assert.equal(aggregateCandles(trades,"1s").length,4);assert.equal(aggregateCandles(trades,"5m").length,1);assert.equal(aggregateCandles(trades,"1h").length,1);
});
test("candle aggregation uses transaction order at equal block timestamps",()=>{const data=aggregateCandles([trade("z",1000,2,1,0),trade("a",1000,3,1,1)],"1s");assert.equal(data[0].open,2);assert.equal(data[0].close,3);assert.throws(()=>aggregateCandles([trade("bad",1000,NaN,1)],"1s"));});
test("curve completion and confirmed migration are distinct",()=>{assert.deepEqual(curveProgress(25n,100n,false),{status:"bonding",percent:25});assert.deepEqual(curveProgress(101n,100n,false),{status:"graduating",percent:100});assert.deepEqual(curveProgress(0n,100n,true),{status:"bonded",percent:100});assert.throws(()=>curveProgress(1n,0n,false));});
test("comparison includes real execution costs and never double-counts compounding",()=>{const coin:AnalyticsCoin={mint:"mint",name:"Coin",symbol:"C",poolAddress:"pool",agentId:"agent",model:"fable",state:"active",asOf:200,periodStart:100,periodEnd:200,lastAction:null,actual:{liquidityUsd:100,feesUsd:10,gasUsd:2,computeUsd:3,compoundedUsd:7,slippageBps:5,rebalances:1,feeBps:150},baseline:{feesUsd:6,gasUsd:0,slippageBps:7,method:"fixed-launch-position-v1",replayComplete:true}};assert.equal(comparison(coin)?.difference,-1);assert.equal(comparison({...coin,baseline:{...coin.baseline!,replayComplete:false}}),null);assert.equal(comparison({...coin,actual:{...coin.actual!,gasUsd:null}}),null);assert.equal(comparison({...coin,baseline:{...coin.baseline!,feesUsd:0}})?.percent,null);});
