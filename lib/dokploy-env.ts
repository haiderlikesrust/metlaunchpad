// Only Next's standalone Node build aliases cloudflare:workers to this module.
import {nodeDatabase} from "./node-database";
export const env={DB:nodeDatabase as unknown as D1Database};
