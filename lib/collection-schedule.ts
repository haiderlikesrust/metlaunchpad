import {database} from './server';
import {COLLECTION_INTERVAL_MS} from './fee-types';
export async function reserveCollectionCheck(agent:string,now=Date.now()){
 const db=database();await db.prepare('INSERT OR IGNORE INTO fee_collection_state(agent_id) VALUES(?)').bind(agent).run();
 const lease=await db.prepare('UPDATE fee_collection_state SET last_checked_at=?,next_check_at=?,last_error=NULL WHERE agent_id=? AND next_check_at<=?').bind(now,now+COLLECTION_INTERVAL_MS,agent,now).run();
 return !!lease.meta.changes;
}
