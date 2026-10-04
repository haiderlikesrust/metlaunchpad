// Run manually on Linux/WSL after building the pinned upstream SBF program.
// This is a lifecycle compatibility probe, not a fee-charging implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { revision, source } from './prepare.mjs';

const testFiles = [
  'tests/create_pool_with_token2022_with_transfer_hook.tests.ts',
  'tests/migrate_to_damm_v2_with_transfer_hook.tests.ts',
];
const hash = (path) => createHash('sha256').update(readFileSync(join(source, path))).digest('hex');
const binaries = Object.fromEntries([
  'target/deploy/dynamic_bonding_curve.so',
  'tests/fixtures/transfer_hook_counter.so',
  'tests/fixtures/damm_v2.so',
].map((path) => [path, hash(path)]));
const offline = fileURLToPath(new URL('./offline.cjs', import.meta.url));
const outputPath = resolve('.data/research/hook-probe-result.json');
const rawReportPath = resolve('.data/research/hook-probe-report.json');
mkdirSync(dirname(outputPath), { recursive: true });
let raw;
try {
  raw = execFileSync(process.execPath, [
    '--require', offline, '--require', 'tsx/cjs', 'node_modules/mocha/bin/mocha',
    '--timeout', '120000', '--reporter', 'json', ...testFiles,
  ], { cwd: source, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
} catch (error) {
  writeFileSync(rawReportPath, String(error.stdout || error.message));
  throw error;
}
writeFileSync(rawReportPath, raw);
const report = JSON.parse(raw);
assert.equal(report.stats.tests, 16, 'Expected all 16 reviewed lifecycle cases.');
assert.equal(report.stats.passes, 16);
assert.equal(report.stats.failures, 0);
assert.equal(report.stats.pending, 0);
const result = {
  checkedAt: new Date().toISOString(),
  upstream: 'https://github.com/MeteoraAg/dynamic-bonding-curve',
  revision,
  node: process.version,
  litesvm: JSON.parse(readFileSync(join(source, 'node_modules/litesvm/package.json'), 'utf8')).version,
  sdkIdlVersion: JSON.parse(readFileSync(join(source, 'target/idl/dynamic_bonding_curve.json'), 'utf8')).metadata.version,
  build: 'cargo build-sbf --manifest-path programs/dynamic-bonding-curve/Cargo.toml --sbf-out-dir target/deploy -- --features local',
  binaries,
  runtime: 'LiteSVM local execution; network calls blocked; no funded accounts',
  tests: report.tests.map(({ fullTitle }) => fullTitle),
  passes: report.stats.passes,
  failures: report.stats.failures,
  verdict: 'incompatible-with-persistent-fees-through-native-graduation',
  findings: [
    'Hook-enabled Token-2022 creation, swaps, and v2 fee claims pass.',
    'The DBC pool authority owns the mint hook authority, not the creator or THICC agent.',
    'The curve-completing swap clears both hook program ID and hook authority.',
    'Both remain cleared after native DAMM v2 migration.',
  ],
  limitations: [
    'Built reviewed upstream source with local feature; not verification of a deployed mainnet binary.',
    'Counter hook validates lifecycle compatibility, not directional fee collection.',
    'The local feature bypasses the DBC admin allowlist for test setup; production access was not tested.',
    'No changes to THICC production launch, trading, or agent fee policy.',
  ],
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
