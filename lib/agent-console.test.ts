import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Keypair} from '@solana/web3.js';
import {migrate} from '../deploy/migrate.mjs';
import {computeTargetPct,computeTransfer} from './compute-allocation';
import {decisionCadence} from './agent-cadence';
import {planAdaptiveFunding} from './adaptive-funding';
import {cardFundingBuffer} from './card-funding-buffer';

const directory=mkdtempSync(join(tmpdir(),'thicc-console-test-'));
process.env.DATABASE_PATH=join(directory,'test.sqlite');process.env.THICC_RUNTIME='node';
migrate(process.env.DATABASE_PATH,resolve('drizzle'));
registerHooks({resolve(specifier,context,next){return specifier==='cloudflare:workers'?{url:pathToFileURL(resolve('lib/dokploy-env.ts')).href,shortCircuit:true}:next(specifier,context);}});
const {nodeDatabase:db,closeNodeDatabase}=await import('./node-database');
const {recordAssetClaim,assetBalance,reserveJob}=await import('./asset-ledger');
const {rebalanceComputeTreasury}=await import('./compute-treasury');
const {agentBudget}=await import('./agent-budget');
const {agentConsole}=await import('./agent-console');
const {executeFunding}=await import('./funding-executor');
const {monitorComputeFunding}=await import('./credit-monitor');
const now=Date.now(),mint=Keypair.generate().publicKey.toBase58();
after(()=>{closeNodeDatabase();assert.equal(dirname(directory),resolve(tmpdir()));assert.ok(basename(directory).startsWith('thicc-console-test-'));rmSync(directory,{recursive:true,force:true});});

test('funding share follows measured cost relative to treasury, without a $2k cutoff',()=>{
 assert.equal(computeTargetPct(26),50);assert.equal(computeTargetPct(5000),50);
 assert.equal(computeTargetPct(2000,1),10);assert.equal(computeTargetPct(200,1),12);
 assert.equal(computeTargetPct(20,1),70);assert.throws(()=>computeTargetPct(NaN));
 const t=computeTransfer(1000n,50n,600n,250n,70);assert.deepEqual(t,{fromCompound:600n,fromReserve:50n});
 assert.deepEqual(computeTransfer(1000n,500n,150n,250n,10),{fromCompound:0n,fromReserve:0n},'Past funding is never clawed back');
});

test('paid cadence accelerates with earned runway and slows without interrupting monitoring',()=>{
 const funded=decisionCadence(1000,0,.01,100),low=decisionCadence(1,.99,.01,0);
 assert.equal(funded.mode,'continuous');assert.equal(funded.delayMs,10000);
 assert.equal(low.mode,'economy');assert.ok(low.delayMs>funded.delayMs);
 assert.equal(decisionCadence(1,1,.01,0).mode,'paused');
});

test('initial funding does not wait for credit display; pending deposits still prevent duplicate spending',()=>{
 const input={samples:[{at:now,remainingMicros:0n,usedMicros:0n}],now,availableEarnedComputeMicros:13_200_000n,pending:false,destinationVerified:true,bootstrap:true};
 const plan=planAdaptiveFunding(input);assert.equal(plan.action,'top_up');if(plan.action==='top_up'){assert.equal(plan.bootstrap,true);assert.equal(plan.amountMicros,13_200_000n);}
 for(const change of [{pending:true},{destinationVerified:false},{availableEarnedComputeMicros:0n}])assert.equal(planAdaptiveFunding({...input,...change}).action,'hold');
 assert.equal(planAdaptiveFunding({...input,samples:[]}).action,'top_up','Credit display is not a bootstrap prerequisite');
 assert.equal(planAdaptiveFunding({...input,bootstrap:false}).action,'hold','Normal replenishment still requires usage history');
});
test('confirmed card deposits cover refill runway without claiming that credits have arrived',()=>{
 const rows=[{amount_usd:10,baseline_credits:100}];
 assert.equal(cardFundingBuffer(rows,100),10);assert.equal(cardFundingBuffer(rows,105),5);assert.equal(cardFundingBuffer(rows,110),0);
 assert.equal(cardFundingBuffer([...rows,{amount_usd:20,baseline_credits:105}],110),20);
 assert.equal(cardFundingBuffer([...rows,{amount_usd:20,baseline_credits:110}],130),0);
 assert.equal(cardFundingBuffer([{amount_usd:10,baseline_credits:null}],110),null);
 assert.equal(cardFundingBuffer(rows,90),null);
});

test('upgrade reallocates legacy fees once, conserves token units and honors reservations',async()=>{
 await db.prepare("INSERT INTO agents(id,owner,pool_address,pool_name,wallet,position_address,model,policy,last_tick) VALUES('console-agent','private-owner','pool','Coin','wallet','','fable','{}',?)").bind(now).run();
 await recordAssetClaim('console-agent','legacy','quote',10000n,2,100_000_000,now);
 // Simulate the old 5% compute / 60% compound token ledger, already deployed.
 await db.prepare("UPDATE asset_entries SET amount=CASE bucket WHEN 'compute' THEN '500' WHEN 'compound' THEN '6000' ELSE amount END WHERE agent_id='console-agent'").run();
 await db.prepare("INSERT INTO fee_receipts VALUES('legacy','console-agent','wallet',100000000,5000000,?)").bind(now).run();
 await reserveJob('console-agent','compound_swap','quote',1000n,'compound','other');
 const before=await assetBalance('console-agent','quote','buyback');
 const first=await rebalanceComputeTreasury('console-agent');assert.equal(first.targetPct,50);
 assert.equal(await assetBalance('console-agent','quote','compute'),5000n);
 assert.equal(await assetBalance('console-agent','quote','reserve'),2500n);
 assert.equal(await assetBalance('console-agent','quote','buyback'),before);
 assert.equal(await assetBalance('console-agent','quote','compound'),500n);
 const budget=await agentBudget('console-agent');assert.equal(budget.earnedUsd,50);
 const again=await rebalanceComputeTreasury('console-agent');assert.equal(again.allocatedMicros,0);assert.equal((await agentBudget('console-agent')).earnedUsd,50);
 await reserveJob('console-agent','compute','quote',5000n,'compute','quote',{fundingId:'funding',address:'public-destination'});
 assert.equal((await rebalanceComputeTreasury('console-agent')).allocatedMicros,0,'Depositing does not create another budget grant');
 assert.equal(await assetBalance('console-agent','quote','compute'),0n);
});

test('public console is scoped to a verified coin and omits secrets, wires and other agents',async()=>{
 await db.prepare("INSERT INTO launches(id,owner,name,symbol,mint,signature,created_at,pool_address,verified_at) VALUES('console-launch','private-owner','Coin','COIN',?,'launch',?,'pool',?)").bind(mint,now,now).run();
 await db.prepare("INSERT INTO agent_custody(agent_id,base_mint,wallet,encrypted_key,pool_kind,created_at) VALUES('console-agent',?,'wallet','SECRET_CUSTODY','dbc',?)").bind(mint,now).run();
 await db.prepare("INSERT INTO events VALUES('visible','private-owner','console-agent','decision','Holding liquidity after checking flow.','SECRET_MODEL_PAYLOAD',?)").bind(now).run();
 await db.prepare("INSERT INTO events VALUES('other','someone','another-agent','decision','PRIVATE_OTHER_AGENT',NULL,?)").bind(now).run();
 await db.prepare("INSERT INTO chain_operations(id,agent_id,purpose,status,wire,message_hash,signature,last_valid_height,context_json,created_at,updated_at) VALUES('console-op','console-agent','claim','finalized','SECRET_WIRE','hash','public-signature',1,'{}',?,?)").bind(now,now).run();
 await db.prepare("INSERT INTO funding_monitor(id,last_plan) VALUES('openrouter',?)").bind(JSON.stringify({action:'hold',reason:'Credits cover the current refill runway.',checkedAt:now})).run();
 const result=await agentConsole(mint),json=JSON.stringify(result);
 assert.equal(result.activated,true);assert.equal(result.budget.earnedUsd,50);assert.ok(result.events.some(e=>e.signature==='public-signature'));
 assert.equal(result.funding.deposits,0,'A reserved compute job is not a deposit');assert.equal(result.funding.pendingDeposits,1);
 for(const secret of ['SECRET_CUSTODY','SECRET_WIRE','SECRET_MODEL_PAYLOAD','PRIVATE_OTHER_AGENT','private-owner'])assert.ok(!json.includes(secret));
 await assert.rejects(agentConsole(Keypair.generate().publicKey.toBase58()),/No verified/);
});

test('finalized deposits finish funding even when OpenRouter credit display is unavailable',async()=>{
 const destination=Keypair.generate().publicKey.toBase58(),originalFetch=globalThis.fetch;
 process.env.SOLCARD_DEPOSIT_ADDRESS=destination;process.env.OPENROUTER_MANAGEMENT_KEY='isolated-test-key';
 await db.prepare("INSERT INTO funding(id,owner,address,amount_usd,status,created_at,baseline_credits) VALUES('deposit-ready','platform',?,10,'confirmed',?,100)").bind(destination,now).run();
 await db.prepare("INSERT INTO execution_jobs(id,agent_id,kind,status,input_mint,input_amount,output_mint,context_json,created_at,updated_at) VALUES('deposit-job','funded-agent','compute','complete','quote','100','quote',?,?,?)").bind(JSON.stringify({fundingId:'deposit-ready',address:destination,allocatedUsd:10}),now,now).run();
 globalThis.fetch=async()=>new Response('{}',{status:503});
 try{await executeFunding();assert.equal((await db.prepare("SELECT status FROM funding WHERE id='deposit-ready'").first<{status:string}>())?.status,'deposit_confirmed');await executeFunding();assert.equal((await db.prepare("SELECT COUNT(*) n FROM execution_jobs WHERE id='deposit-job'").first<{n:number}>())?.n,1);}
 finally{globalThis.fetch=originalFetch;delete process.env.SOLCARD_DEPOSIT_ADDRESS;delete process.env.OPENROUTER_MANAGEMENT_KEY;}
});

test('credit monitor bootstraps an activated coin once even before credit balance is visible',async()=>{
 const originalFetch=globalThis.fetch;process.env.SOLCARD_DEPOSIT_ADDRESS=Keypair.generate().publicKey.toBase58();process.env.OPENROUTER_MANAGEMENT_KEY='isolated-test-key';
 await db.prepare("INSERT INTO agents(id,owner,pool_address,pool_name,wallet,position_address,model,policy) VALUES('bootstrap-agent','test-owner','bootstrap-pool','Bootstrap','bootstrap-wallet','','fable','{}')").run();
 await recordAssetClaim('bootstrap-agent','bootstrap-claim','quote',10000n,2,100_000_000,now);
 await db.prepare("INSERT INTO fee_receipts VALUES('bootstrap-claim','bootstrap-agent','bootstrap-wallet',100000000,10000000,?)").bind(now).run();
 globalThis.fetch=async()=>new Response('{}',{status:503});
 try{const plan=await monitorComputeFunding();assert.equal(plan.action,'top_up');assert.equal(plan.bootstrap,true);const request=await db.prepare("SELECT amount_usd,owner FROM funding WHERE owner='bootstrap-agent'").first<{amount_usd:number;owner:string}>();assert.equal(request?.amount_usd,50);const second=await monitorComputeFunding();assert.equal(second.action,'hold');assert.equal((await db.prepare("SELECT COUNT(*) n FROM funding WHERE owner='bootstrap-agent'").first<{n:number}>())?.n,1);}
 finally{globalThis.fetch=originalFetch;delete process.env.SOLCARD_DEPOSIT_ADDRESS;delete process.env.OPENROUTER_MANAGEMENT_KEY;}
});
