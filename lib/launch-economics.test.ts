import test from "node:test";
import assert from "node:assert/strict";
import {FIXED_SUPPLY_ATOMS,LAUNCH_ECONOMICS,SOL_MINT,launchValuation,validateSolPrice} from "./launch-economics";
import {launchInput} from "./launch-input";
import {AGENT_MODELS,modelDefinition} from "./agent-models";
const now=1_800_000_000_000;
const sol={solPrice:120,asOfTimestamp:now,stale:false};
const input={name:"Test",symbol:"TEST",description:"Validation fixture",website:"",twitter:"",telegram:"",model:"fable",quoteMint:SOL_MINT};
test("creator cannot override supply, prices, fees, or raw model routing",()=>{
 assert.equal(launchInput.parse(input).model,"fable");
 for(const [key,value] of Object.entries({supply:"2000000000",price:42,feeBps:10,initialMarketCapSol:1,graduationMarketCapSol:2,openrouterModel:"arbitrary/provider"}))assert.equal(launchInput.safeParse({...input,[key]:value}).success,false,key);
 assert.equal(launchInput.safeParse({...input,model:"arbitrary/provider"}).success,false);
 assert.equal(FIXED_SUPPLY_ATOMS,BigInt(LAUNCH_ECONOMICS.supply)*10n**BigInt(LAUNCH_ECONOMICS.decimals));
});
test("SOL-denominated targets and token prices use the whole fixed supply",()=>{
 const v=launchValuation(sol,{mint:SOL_MINT,usdPrice:0,asOfTimestamp:0},now);
 assert.equal(v.initialMarketCapUsd,2400);assert.equal(v.graduationMarketCapUsd,30000);
 assert.equal(v.initialPriceQuote,0.00000002);assert.equal(v.graduationPriceQuote,0.00000025);
});
test("stock quotes convert the same USD market caps into quote-token amounts",()=>{
 const v=launchValuation(sol,{mint:"stock",usdPrice:30,asOfTimestamp:now},now);
 assert.equal(v.initialMarketCapQuote,80);assert.equal(v.graduationMarketCapQuote,1000);
 assert.equal(v.initialPriceQuote*1e9*30,v.initialMarketCapUsd);
 assert.throws(()=>launchValuation(sol,{mint:"stock",usdPrice:30,asOfTimestamp:now-60001},now));
});
test("stale, malformed, nonfinite and future-dated prices fail closed",()=>{
 for(const p of [null,{}, {...sol,solPrice:0},{...sol,solPrice:Infinity},{...sol,stale:true},{...sol,asOfTimestamp:now-60001},{...sol,asOfTimestamp:now+5001}])assert.throws(()=>validateSolPrice(p,now));
 assert.equal(validateSolPrice(sol,now).solPrice,120);
});
test("exactly four allowed product models and no arbitrary fallback",()=>{
 assert.deepEqual(AGENT_MODELS.map(m=>m.name),["Fable","Astra","Opus 5.5","GPT Sol 6.1"]);
 assert.deepEqual(AGENT_MODELS.map(m=>m.openrouterId),["anthropic/claude-fable-5.1","openai/gpt-6-astra","anthropic/claude-opus-5.5","openai/gpt-6.1-sol"]);
 assert.throws(()=>modelDefinition("other"));
});
