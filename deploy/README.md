# THICC on Dokploy

This uses the same Docker Compose approach as Grailshot: a production Node web
container, a separate background worker, a private service network, health
checks, and a persistent data volume. THICC uses SQLite because its existing
schema is SQLite/D1. Cloudflare and Sites accounts are not required for this
deployment. Wallet signatures authenticate users; proxy identity headers do not.

## Dokploy settings

1. Create a **Docker Compose** application from
   `https://github.com/haiderlikesrust/metlaunchpad`, branch `main`.
2. Use `.` as the source/build directory and `compose.dokploy.yaml` as the Compose
   file. The repository root contains the app and Dockerfile.
3. Paste `deploy/dokploy.env.example` into the Environment editor. Set
   `APP_ORIGIN=https://thicc.money`. Generate separate random values for
   `SESSION_SECRET` and `AGENT_CRON_TOKEN` with `openssl rand -hex 32`.
4. Add QuickNode, OpenRouter credentials, a Jupiter API key, the permanent SolCard address, and an agent-wallet encryption key.
   The four model IDs are already pinned in code. Leave `THICC_TOKEN_MINT` empty
   until it exists.
5. Add the domain **thicc.money**, service **web**, container port **3187**,
   path **/**. Enable HTTPS and HTTP-to-HTTPS redirection in Dokploy. Point the
   domain's DNS A record at your Dokploy server. Do not expose the worker.
6. Deploy. The web container applies migrations before starting; the worker waits
   for the web health check. Independent authenticated loops update markets every
   2 seconds, check due fee collections every 3 seconds, and run execution every
   10 seconds. Each agent's collection schedule is persisted at 30-second intervals.
   A pending wallet transaction or acquired swap assets defer collection until safe;
   slow model calls do not block market indexing or the collector.

No secrets are needed at image build time. The Docker build context excludes
local `.env` files, private keys, databases, preview state, and cached builds.
Provide secrets only through Dokploy's runtime environment editor.

## Storage and updates

The named `thicc-data` volume mounts at `/data`. It stores `thicc.sqlite`, SQLite
WAL files, and pre-migration backups. Keep **one web replica** with this SQLite
setup. The worker accesses the web API and has no database volume or signing keys.

Redeploying preserves the named volume. Do not remove it, use `down -v`, or change
the Compose project identity without migrating its volume. Before updates, take
an independent volume backup. Startup creates a consistent pre-migration SQLite
backup when applying migrations to an existing database. Applied migrations are
checksummed and cannot silently change. Restoring an older image after a schema
change may require restoring its corresponding database backup as well.

The local preview's `.wrangler` database is not copied into production. Export and
review any real records separately before importing them; no example coins are
seeded. Images under `public` ship with the image. Uploaded token images and metadata are stored in the database and served at stable metadata URLs. Include these records in backups.

## Checks

- `https://thicc.money/api/health` checks database schema access. Service
  configuration flags do not assert that trading or autonomous execution works.
- `/launch`, `/docs`, and `/token/<mint>` are served by the standalone Next server.
- The model proposes ranges and forecasts credit runway. Deterministic code determines permitted token amounts and the configured destination.
- Cookies are HttpOnly, Secure in production, and authenticated by
  `SESSION_SECRET`. Rotating that secret signs users out. Wallet challenges expire
  after five minutes, are origin-bound, and can be consumed only once.

## Runtime configuration

- `QUICKNODE_RPC_URL`: mainnet Solana endpoint with historical transactions,
  getBlock, getSignaturesForAddress and simulation enabled. Charts use finalized
  swaps and therefore lag chain execution; 1s is candle width, not a promise of
  sub-second data latency.
- `OPENROUTER_API_KEY` and `OPENROUTER_MANAGEMENT_KEY`: inference and monitoring.
  Start with available inference credits. Select the SolCard-backed payment card
  and configure auto-recharge in OpenRouter separately.
- `JUPITER_API_KEY`: v2 swap builds and v3 non-SOL prices. Unsupported, stale-priced,
  restricted or unroutable quote assets cannot launch or execute affected swaps.
- `AGENT_WALLET_ENCRYPTION_KEY`: generate with `openssl rand -base64 32`. Back it up
  separately. Do not replace it after creating agents without migrating encrypted
  records; losing it loses access to server-custodied wallets.
- `SOLCARD_DEPOSIT_ADDRESS`: the permanent SOL deposit address. There is no SolCard
  API. A completed SOL transfer and an observed OpenRouter credit increase are
  separate states; neither proves the card processor's specific charge receipt.
- `THICC_TOKEN_MINT`: may remain blank as requested. Ten percent stays reserved;
  purchases and burns start only after the mint and an executable route exist.
- `EXECUTION_PAUSED=true`: stop creating new worker actions. Already signed wires
  continue reconciliation and may still land. This does not undo a transfer or
  disable wallet-approved launches/trades.

## Live acceptance

Local tests do not establish that funded mainnet integration is complete. The
production credentials are configured only in Dokploy, and this workspace has
not submitted a funded chain transaction. After deploying this commit:

1. Confirm `/api/health` and worker logs, persistent volume permissions, HTTPS and
   service **web** on container port **3187**. Do not add a public worker domain.
2. Launch through the wallet: approve config plus initial 0.02 SOL agent gas,
   then pool creation. Verify the final mint has 1 billion supply, no mint/freeze
   authority, zero creator fee share, and the displayed agent as fee recipient.
3. Test buy and sell with amounts you choose. Check finalized signatures, balances,
   and 1s/1m/5m/1h candles. Historical swaps without a matching price observation
   remain unpriced in accounting. Charts can display their actual quote-token prices
   converted with a fresh current USD rate, explicitly labeled in the chart footer.
   Token statistics and fees refresh every 2 seconds; candles refresh every 1–2 seconds.
4. Verify a fee claim's exact received units and the 60/5/25/10 allocation. Confirm
   activation after $20 in finalized, priced claims. Creator gas does not count.
5. Verify native graduation to DAMM v2 and additional agent-owned DLMM liquidity.
   Account creation needs sufficient unallocated gas. The worker accumulates
   earned gas reserves and pauses if it cannot pay rent without touching reserved
   funds. A public Meteora keeper can migrate independently of this worker.
6. After configuring the main THICC mint, confirm a purchase and token-program burn.
   Exercise a worker restart between purchase and burn and check that no second
   purchase occurs. Missing routes retain the reserved allocation for retry.
7. Verify a compute deposit and the subsequent credit increase with a full hour
   of usage history. Pending funding blocks duplicate automatic deposits.

The original native LP is permanently locked; the server key remains a custody
trust boundary. New launches use 2%; earlier coins and prepared drafts retain 1.5%, with no
model-controlled fee-edit path. Analytics compare observed native-position fee
income with additional DLMM activity and measured costs, not a hypothetical
full-market simulation. Account rent and impermanent loss are excluded from net
fee income. Unknown costs and missing telemetry are shown as unavailable.
