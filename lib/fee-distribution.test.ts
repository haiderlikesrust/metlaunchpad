import {test} from "node:test";
import assert from "node:assert/strict";
import {distributeClaim,nextBuybackAction,type BuybackJob} from "./fee-distribution";

test("10% is set aside independently of activation, conserving every unit",()=>{
 const split=distributeClaim(10000n);
 assert.deepEqual(split,{buybackBurn:1000n,compound:5500n,compute:1000n,reserve:2500n,cumulative:10000n});
 assert.throws(()=>distributeClaim(-1n));
});
test("small repeated claims carry buyback dust instead of avoiding the 10%",()=>{
 let cumulative=0n,burn=0n;
 for(let i=0;i<1000;i++){
  const split=distributeClaim(1n,cumulative);cumulative=split.cumulative;burn+=split.buybackBurn;
  assert.equal(split.buybackBurn+split.compound+split.compute+split.reserve,1n);
  assert.ok(split.reserve>=0n);
 }
 assert.equal(burn,100n);
});
const job:BuybackJob={state:"awaiting_execution",targetMint:"thicc",inputMint:"quote",inputAmount:100n,acquiredAmount:0n,swapSignature:null,burnSignature:null};
test("missing mint holds funds; THICC-denominated fees can go straight to burn",()=>{
 assert.equal(nextBuybackAction({...job,targetMint:null}),"await_mint");
 assert.equal(nextBuybackAction({...job,inputMint:"thicc"}),"burn_claimed_thicc");
 assert.equal(nextBuybackAction(job),"swap");
});
test("pending purchases reconcile; burn retries cannot purchase twice",()=>{
 assert.equal(nextBuybackAction({...job,state:"swap_submitted",swapSignature:"swap"}),"reconcile_swap");
 assert.equal(nextBuybackAction({...job,state:"awaiting_burn",acquiredAmount:50n,swapSignature:"swap"}),"burn");
 assert.throws(()=>nextBuybackAction({...job,state:"awaiting_burn"}));
 assert.equal(nextBuybackAction({...job,state:"burn_submitted",burnSignature:"burn"}),"reconcile_burn");
 assert.equal(nextBuybackAction({...job,state:"burned"}),"complete");
});
