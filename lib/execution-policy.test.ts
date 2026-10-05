import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {seal,unseal} from "./custody-crypto";
import {thiccCurve} from "./dbc-curve";
import {DynamicBondingCurveClient,getPriceFromSqrtPrice,getMigrationThresholdPrice,TokenAuthorityOption} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {Connection} from "@solana/web3.js";
import BN from "bn.js";
import {draftFeeBps,nativeLaunchFeeBps} from './launch-fee';
test("custody ciphertext cannot be moved between agents or modified",()=>{
 const key=randomBytes(32).toString("base64"),sealed=seal('[1,2,3]',"agent:a",key);assert.equal(unseal(sealed,"agent:a",key),'[1,2,3]');assert.throws(()=>unseal(sealed,"agent:b",key));assert.throws(()=>unseal(sealed,"agent:a",randomBytes(32).toString("base64")));assert.throws(()=>unseal(sealed.slice(0,-3)+"AAAA","agent:a",key));assert.throws(()=>seal("x","a","short"));
});
test("native launch curve fixes supply, fee rights, permanent LP ownership and 20/250 valuations",()=>{
 const c=thiccCurve(9,20,250);assert.equal(c.tokenDecimal,9);assert.equal(c.tokenSupply?.preMigrationTokenSupply.toString(),"1000000000000000000");assert.equal(c.tokenSupply?.postMigrationTokenSupply.toString(),"1000000000000000000");assert.equal(c.tokenUpdateAuthority,TokenAuthorityOption.Immutable);assert.equal(c.creatorTradingFeePercentage,0);assert.equal(c.creatorLiquidityPercentage,0);assert.equal(c.partnerPermanentLockedLiquidityPercentage,100);
 const start=getPriceFromSqrtPrice(c.sqrtStartPrice,9,9).toNumber()*1e9;assert.ok(Math.abs(start-20)<.0001,"SDK fixed-point curve rounding must stay within 0.0001 SOL");assert.equal(c.poolFees.baseFee.cliffFeeNumerator.toString(),"20000000");assert.equal(c.migratedPoolFee.poolFeeBps,200);
 const graduation=getPriceFromSqrtPrice(getMigrationThresholdPrice(c.migrationQuoteThreshold,c.sqrtStartPrice,c.curve),9,9).toNumber()*1e9;assert.ok(Math.abs(graduation-250)<.001);
 assert.throws(()=>thiccCurve(18,20,250));assert.throws(()=>thiccCurve(9,NaN,250));
});
test("official SDK can quote a buy on the exact server-created launch curve without a live pool",()=>{
 const c=thiccCurve(9,20,250),sdk=new DynamicBondingCurveClient(new Connection("https://api.devnet.solana.com"),"confirmed");
 const q=sdk.pool.getQuoteFromInputAmount({config:c,swapBaseForQuote:false,amountIn:new BN(100_000_000),slippageBps:50});assert.ok(q.outputAmount.gt(new BN(0)));assert.ok(q.minimumAmountOut!.lte(q.outputAmount));assert.ok(q.tradingFee.gt(new BN(0)));
});
test('new launches charge 2% while resumed legacy launches and companion fee selection retain 1.5%',()=>{
 const sdk=new DynamicBondingCurveClient(new Connection('https://api.devnet.solana.com'),'confirmed');
 for(const [snapshot,bps,feeAtoms] of [[{},150,'1500000'],[{initialFeeBps:200},200,'2000000']] as const){
  const c=thiccCurve(9,20,250,draftFeeBps(snapshot));
  assert.equal(nativeLaunchFeeBps(c),bps);assert.equal(c.migratedPoolFee.poolFeeBps,bps);
  const q=sdk.pool.getQuoteFromInputAmount({config:c,swapBaseForQuote:false,amountIn:new BN(100_000_000),slippageBps:50});
  assert.equal(q.tradingFee.add(q.protocolFee).toString(),feeAtoms,'Total trader fee includes Meteora protocol share');
 }
 assert.throws(()=>draftFeeBps({initialFeeBps:1000}));assert.throws(()=>thiccCurve(9,20,250,1000));
});
