import test from 'node:test';
import assert from 'node:assert/strict';
import {swapAmounts} from './swap-event';
import {tokenDelta} from './token-deltas';
import type {VersionedTransactionResponse} from '@solana/web3.js';
test('DBC and DAMM buy/sell amounts preserve quote volume and all fee components',()=>{
 const event={name:'evtSwap2',index:0,program:'',data:{tradeDirection:0,swapResult:{includedFeeInputAmount:'1000',outputAmount:'500',tradingFee:'5',protocolFee:'1',referralFee:'2'}}};
 assert.deepEqual(swapAmounts(event),{sell:true,base:1000n,quote:500n,fee:8n});
 assert.deepEqual(swapAmounts({...event,data:{tradeDirection:1,swapResult:{includedFeeInputAmount:'500',outputAmount:'1000',claimingFee:'5',compoundingFee:'2',protocolFee:'1'}}}),{sell:false,base:1000n,quote:500n,fee:8n});
 assert.equal(swapAmounts({...event,data:{tradeDirection:0,swapResult:{includedFeeInputAmount:'0',outputAmount:'100'}}}),null);
});
test('DLMM converts base-asset fees to quote units without treating a buy as a sell',()=>{
 assert.deepEqual(swapAmounts({name:'swap',index:0,program:'',data:{swapForY:true,amountIn:'1000',amountOut:'500',fee:'10'}}),{sell:true,base:1000n,quote:500n,fee:5n});
 assert.deepEqual(swapAmounts({name:'swap2Evt',index:0,program:'',data:{swapForY:false,feesOnTokenX:false,amountIn:'500',amountOut:'1000',mmFee:'8',protocolFee:'2'}}),{sell:false,base:1000n,quote:500n,fee:10n});
});
test('net receipts exclude another owner and transfer-withheld amounts',()=>{
 const balance=(owner:string,mint:string,amount:string)=>({owner,mint,uiTokenAmount:{amount}});
 const tx={meta:{preTokenBalances:[balance('agent','quote','100')],postTokenBalances:[balance('agent','quote','1000'),balance('other','quote','99999'),balance('agent','other-mint','1000')]}} as unknown as VersionedTransactionResponse;
 assert.equal(tokenDelta(tx,'agent','quote'),900n);
});
