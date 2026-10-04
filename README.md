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
**thicc.money** at service **web**, port **3000**, with HTTPS enabled.
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
- Initial swap fee: 1.5%; agent activation: $20 in verified claimed fees.
- Earned-fee split: 60% compounding, 5% compute, 25% reserves,
  **10% main THICC buyback and burn**.
- The buyback reservation is claim-triggered and independent of the AI model.
  Missing `THICC_TOKEN_MINT` leaves it pending.
- Model choices: Fable, Astra, Opus 5.5, GPT Sol 6.1. Verified OpenRouter IDs are
  pinned in `lib/agent-models.ts`; no model environment variables are needed.

The native Meteora approach uses a dedicated agent wallet and protocol fee roles.
There is no custom THICC vault-program deployment requirement. Server-controlled
custody is not a trustless immutable spending boundary. The older Rust prototype
under `protocol` is retained as experimental source and is not used by the app.

## Implementation status

Implemented: shared navigation, separate launch form and identity preview,
THICC-only coin directory, real quote registry/logos, live SOL conversion,
`/token/<mint>` detail pages with four chart intervals, agent-wallet display,
analytics views over verified records, detailed `/docs`, fixed-policy validation,
adaptive compute funding plans, claim-triggered buyback reservations, wallet
sessions, persistent database migrations, Docker and Dokploy configuration.

**Financial execution is not live.** Launch transactions, metadata storage,
verified claim/trade ingestion, LP execution, swap/burn signing, SolCard deposits,
and complete unmanaged-pool replay still require integration and validation.
Launch endpoints return unavailable instead of pretending to create tokens.
Candle charts require indexed real swaps. A buyback reservation is not a completed
purchase or burn, and a model proposal is not an executed transaction.

Never commit `.env`, session secrets, wallet keys, SQLite files, or build output.
