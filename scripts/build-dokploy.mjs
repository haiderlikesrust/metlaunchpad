import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const cli=fileURLToPath(new URL("../node_modules/next/dist/bin/next",import.meta.url));
const result=spawnSync(process.execPath,[cli,"build","--webpack"],{stdio:"inherit",env:{...process.env,THICC_RUNTIME:"node",NEXT_TELEMETRY_DISABLED:"1"}});
if(result.error)throw result.error;
if(result.status===0){
 const {build}=await import('esbuild');
 await build({entryPoints:['deploy/recover-test-fees-cli.mjs'],outfile:'.next-dokploy/standalone/deploy/recover-test-fees.bundle.cjs',bundle:true,platform:'node',target:'node24',format:'cjs',external:['bufferutil','utf-8-validate']});
}
process.exit(result.status??1);
