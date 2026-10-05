import {main} from './recover-test-fees.mjs';
main().catch(error=>{console.error(error.message);process.exitCode=1;});
