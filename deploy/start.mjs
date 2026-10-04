import {migrate} from "./migrate.mjs";
const origin=new URL(process.env.APP_ORIGIN||"");
if(origin.protocol!=="https:"||origin.origin!==process.env.APP_ORIGIN)throw new Error("APP_ORIGIN must be an exact HTTPS origin, e.g. https://thicc.money");
for(const key of ["SESSION_SECRET","AGENT_CRON_TOKEN"]){if((process.env[key]||"").length<32)throw new Error(`${key} must contain at least 32 characters.`);}
if(process.env.THICC_RUNTIME!=="node")throw new Error("THICC_RUNTIME must be node.");
process.umask(0o077);
migrate();
await import("../server.js");
