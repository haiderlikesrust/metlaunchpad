// Local-only experiment. Never loads .env, wallet files, or broadcasts transactions.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DynamicBondingCurveIdl } from '@meteora-ag/dynamic-bonding-curve-sdk';
import assert from 'node:assert/strict';

export const revision = 'f552f20aa3c1c7631427c3827aeea7c58b902813';
export const source = resolve(process.argv[2] || '.data/research/dbc');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), revision,
  'Use the reviewed upstream revision.');
// Normalize Windows checkout line endings and WSL mount permission bits only.
assert.equal(execFileSync('git', ['-c', 'core.autocrlf=true', '-c', 'core.filemode=false', 'status', '--porcelain', '--untracked-files=no'], {
  cwd: source, encoding: 'utf8',
}).trim(), '', 'Upstream tracked source and fixtures must be unmodified.');
const swap = readFileSync(join(source, 'programs/dynamic-bonding-curve/src/instructions/swap/process_swap.rs'), 'utf8');
assert.match(swap, /if pool_loader\.is_transfer_hook_pool\(\)\s*\{\s*revoke_transfer_hook\(/);
const tests = readFileSync(join(source, 'tests/migrate_to_damm_v2_with_transfer_hook.tests.ts'), 'utf8');
assert.match(tests, /hookAfter!\.programId\.equals\(PublicKey\.default\)/);
assert.match(tests, /hookAfter!\.authority\.equals\(PublicKey\.default\)/);
mkdirSync(join(source, 'target/idl'), { recursive: true });
// Use THICC's installed SDK IDL so the experiment also exercises our client layout.
writeFileSync(join(source, 'target/idl/dynamic_bonding_curve.json'), JSON.stringify(DynamicBondingCurveIdl));
