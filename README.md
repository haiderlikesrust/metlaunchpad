# THICC

Solana launchpad and Meteora liquidity-agent application, with a standalone
Node.js deployment for **https://thicc.money** on Dokploy.

## Run locally

Use Node.js 24 and npm. Copy `.env.example` to `.env`, add service credentials, then:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Local development uses Node/SQLite and wallet
sessions. SQLite data lives in `.data`; a local session secret is generated in
ignored `.secrets` when not provided. No example coins, prices, trades, or balances
are seeded. The older Sites preview is available as `npm run dev:sites`.

## Deploy on Dokploy

Use `compose.dokploy.yaml` and `deploy/dokploy.env.example`. Point the Dokploy domain
**thicc.money** at service **web**, port **3187**, with HTTPS enabled.
See [the deployment guide](deploy/README.md) for environment values, migrations,
volume backups, health checks, and the single-replica SQLite requirement.

```sh
npm run build:dokploy
node deploy/smoke-dokploy.mjs
node --import tsx --test lib/*.test.ts deploy/migrate.test.mjs
```

The smoke test starts the built standalone server with a temporary database and
isolated test credentials. It checks routes, wallet-signature verification,
cookie integrity, origin checks, replay rejection, and internal worker access.
It does not submit blockchain transactions or call funded model accounts.

## Fixed launch policy

- Supply: 1 billion tokens, 9 decimals.
- Initial valuation: 20 SOL market cap; graduation target: 250 SOL market cap.
- UI valuations are USD first; SOL is the default quote token.
- A coin's website defaults to `https://thicc.money/token/<mint>` unless the creator supplies another website.
- Initial swap fee: 2% for new launches (earlier coins retain 1.5%); agent activation: $20 in verified claimed fees.
- Optional dev buy uses the chosen quote token and the creator wallet, atomically with pool creation, with a 0.5% slippage limit. Blank/zero leaves the launch unchanged.
- Each token has a live agent console with worker check-ins, market checks, model decisions, funding status and transaction receipts. Monitoring continues while paid inference adapts to earned runway.
- AI funding starts at 50% of earned fees, then adapts to usage and treasury size (10–70%), preserving at least 20% reserves and
  **10% main THICC buyback and burn**.
- The buyback reservation is claim-triggered and independent of the AI model.
  Missing `THICC_TOKEN_MINT` leaves it pending.
- Model choices: Fable, Astra, Opus 5.5, GPT Sol 6.1. Verified OpenRouter IDs are
  pinned in `lib/agent-models.ts`; no model environment variables are needed.

The native Meteora approach uses a dedicated agent wallet and protocol fee roles.
There is no custom THICC vault-program deployment requirement. Server-controlled
custody is not a trustless immutable spending boundary. The older Rust prototype
under `protocol` is retained as experimental source and is not used by the app.

## Execution and verification

The server prepares native DBC launches, stores persistent metadata, verifies
finalized fee rights and fixed supply, and supports wallet-approved DBC/DAMM v2
trades. The worker indexes authenticated on-chain swap events; claims native and
DLMM fees; maintains token-unit allocations; executes Jupiter swaps, SPL burns,
SOL gas refills and pinned SolCard deposits; and manages earned-fee DLMM positions.
Transactions are journaled before broadcast and reconciled using the same signed
wire before a replacement can be built. Repositioned principal is accounted for
separately from earned fees.

Market indexing, 30-second fee-collection scheduling, and model execution run
independently. Token pages refresh fee balances and activation progress every
2 seconds, with 1–2 second candle updates. On-chain finality and wallet operations
can delay updates or a claim. Historical trades missing a historical USD quote
use an explicitly labeled current quote conversion for charts only.

These integrations have local tests and production-build checks. **Funded
end-to-end execution has not been verified against production credentials.**
The Docker image also needs verification on a host with a running Docker engine.
See the deployment guide for the live acceptance sequence.

The original graduated DAMM v2 position is permanently locked. Range management
applies to additional DLMM liquidity built from earned fees. Model-directed fee
changes are not available for the configured native fee structures; the initial
fee is 2% for new launches. Earlier coins and existing prepared drafts retain 1.5%. The normal-pool comparison holds observed native-position activity
constant; it is not a full independent counterfactual replay. Unknown metrics
remain unavailable.

Never commit `.env`, session secrets, wallet keys, SQLite files, or build output.

## Transfer-hook compatibility experiment

`experiments/meteora-hooks` checks whether Token-2022 transfer hooks survive the
native DBC-to-DAMM-v2 launch lifecycle. This is an isolated compatibility probe,
not a deployed fee implementation. It uses Meteora's counter-hook fixture and
the IDL from THICC's installed SDK. Results are in
[`experiments/meteora-hooks/result.json`](experiments/meteora-hooks/result.json).

**Result: the hook cannot provide continuing agent-controlled fees through native
graduation.** All 16 upstream lifecycle cases passed locally. Hook-enabled swaps
work, but the curve-completing swap clears the mint's hook program and permanently
revokes its hook authority. Both remain cleared after DAMM v2 migration. The mint
hook authority belongs to the DBC pool authority, not the THICC agent.
See the [pinned protocol implementation](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/swap/process_swap.rs)
and [lifecycle assertions](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/tests/migrate_to_damm_v2_with_transfer_hook.tests.ts).

Reproduce on Linux/WSL with Node 24, Git, Rust and Solana `cargo-build-sbf` available
on PATH, after installing THICC dependencies. The reviewed run used Solana
3.1.14 / platform-tools 1.52. Run from the app root with a fresh research checkout:

```sh
git clone https://github.com/MeteoraAg/dynamic-bonding-curve.git .data/research/dbc
git -C .data/research/dbc checkout f552f20aa3c1c7631427c3827aeea7c58b902813
(cd .data/research/dbc && npm install --ignore-scripts --no-audit --no-fund)
(cd .data/research/dbc && cargo build-sbf --manifest-path programs/dynamic-bonding-curve/Cargo.toml --sbf-out-dir target/deploy -- --features local)
node experiments/meteora-hooks/run.mjs
```

The runner rejects modified upstream tracked files, blocks test network calls,
and records binary hashes plus each test name under `.data/research`. Setup
downloads dependencies; tests use only the in-process LiteSVM ledger and generated
test accounts. The `local` build bypasses the DBC admin allowlist for test setup. This
does not establish mainnet program equivalence, production hook access, or fee
collection correctness. The production app remains on its existing native path.
