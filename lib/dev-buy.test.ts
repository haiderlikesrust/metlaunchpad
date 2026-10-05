import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection,Keypair} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {DynamicBondingCurveClient,deriveTokenBadgeAddress} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {devBuyAtoms,devBuyQuote} from './dev-buy';
import {thiccCurve} from './dbc-curve';
import {launchInput} from './launch-input';

test('dev buy is opt-in and amounts are validated without floating point rounding',()=>{
 assert.equal(devBuyAtoms(undefined,9),null);assert.equal(devBuyAtoms('',9),null);assert.equal(devBuyAtoms('0',9),null);
 assert.equal(devBuyAtoms('1.000000001',9)!.toString(),'1000000001');
 for(const value of ['-1','1e2','NaN','0.0000000001','18446744073709551616'])assert.throws(()=>devBuyAtoms(value,9));
 assert.throws(()=>devBuyAtoms('0.001',2));
 const input={name:'Coin',symbol:'COIN',description:'Coin',website:'',twitter:'',telegram:'',model:'fable',quoteMint:NATIVE_MINT.toBase58()};
 assert.equal(launchInput.parse(input).devBuyAmount,'');assert.equal(launchInput.parse({...input,devBuyAmount:'0.1'}).devBuyAmount,'0.1');assert.equal(launchInput.safeParse({...input,devBuyAmount:'-1'}).success,false);
});

test('initial buy quotes enforce slippage, the saved fee and exact input',()=>{
 const client=new DynamicBondingCurveClient(new Connection('https://unused.invalid'),'confirmed');
 const current=devBuyQuote(client,thiccCurve(9,20,250,200),'1',9)!,legacy=devBuyQuote(client,thiccCurve(9,20,250,150),'1',9)!;
 assert.ok(current.minimumAmountOut.gt(devBuyAtoms('0.000000001',9)!));assert.ok(current.minimumAmountOut.lt(current.expectedOut));assert.ok(current.expectedOut.lt(legacy.expectedOut));
 assert.throws(()=>devBuyQuote(client,thiccCurve(9,20,250),'9999999',9));
});

test('SDK combines creator-funded buy and pool creation in one size-bounded signed transaction',async()=>{
 const connection=new Connection('https://unused.invalid','confirmed'),client=new DynamicBondingCurveClient(connection,'confirmed'),curve=thiccCurve(9,20,250);
 connection.getAccountInfo=async key=>key.equals(NATIVE_MINT)?{owner:TOKEN_PROGRAM_ID,data:Buffer.alloc(82),lamports:1,executable:false,rentEpoch:0}:null;
 (client.creator as unknown as {state:typeof client.state}).state.getPoolConfig=async()=>({poolFees:{baseFee:{baseFeeMode:0}},migrationOption:curve.migrationOption,tokenType:curve.tokenType,activationType:curve.activationType,quoteMint:NATIVE_MINT}) as Awaited<ReturnType<typeof client.state.getPoolConfig>>;
 const creator=Keypair.generate(),agent=Keypair.generate(),base=Keypair.generate(),config=Keypair.generate().publicKey,buy=devBuyQuote(client,curve,'0.1',9)!;
 const tx=await client.creator.createPoolWithFirstBuy({createPoolParam:{payer:creator.publicKey,poolCreator:agent.publicKey,baseMint:base.publicKey,config,tokenBadge:deriveTokenBadgeAddress(NATIVE_MINT),name:'C'.repeat(32),symbol:'T'.repeat(10),uri:'https://thicc.money/api/metadata/12345678-1234-1234-1234-123456789012'},firstBuyParam:{buyer:creator.publicKey,receiver:creator.publicKey,buyAmount:buy.amount,minimumAmountOut:buy.minimumAmountOut,referralTokenAccount:null}});
 tx.feePayer=creator.publicKey;tx.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.partialSign(base,agent);tx.partialSign(creator);
 assert.equal(tx.verifySignatures(),true);assert.ok(tx.instructions.length>1);assert.ok(tx.serialize().length<=1232);
 const swap=tx.instructions.find(i=>i.keys.some(k=>k.pubkey.equals(creator.publicKey)&&k.isSigner)&&i.data.length===24);assert.ok(swap,'Buy instruction is included in the same wire');
});
