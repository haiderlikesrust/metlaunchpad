import {database} from './server';
import {indexMarket} from './market-indexer';
import {withLock} from './runtime-lock';
export async function marketCycle(){return withLock('market-cycle',async()=>{
 const rows=await database().prepare("SELECT l.mint FROM launches l LEFT JOIN agent_custody c ON c.base_mint=l.mint WHERE l.verified_at IS NOT NULL ORDER BY COALESCE((SELECT MAX(observed_at) FROM pool_observations WHERE pool=COALESCE(c.graduated_pool,l.pool_address)),0) LIMIT 24").all<{mint:string}>();
 const results:unknown[]=[];for(let i=0;i<rows.results.length;i+=4){const batch=await Promise.allSettled(rows.results.slice(i,i+4).map(r=>indexMarket(r.mint)));for(const result of batch)results.push({status:result.status==='fulfilled'?'indexed':'retry_pending'});}return {results};
},120000);}
