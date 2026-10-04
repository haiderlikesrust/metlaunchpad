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
4. Add QuickNode, OpenRouter credentials, and the permanent SolCard address.
   The four model IDs are already pinned in code. Leave `THICC_TOKEN_MINT` empty
   until it exists.
5. Add the domain **thicc.money**, service **web**, container port **3000**,
   path **/**. Enable HTTPS and HTTP-to-HTTPS redirection in Dokploy. Point the
   domain's DNS A record at your Dokploy server. Do not expose the worker.
6. Deploy. The web container applies migrations before starting; the worker waits
   for the web health check and calls the authenticated internal tick every minute.

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
seeded. Images under `public` ship with the image. Persistent uploaded-token
metadata storage is still an application integration task.

## Checks

- `https://thicc.money/api/health` checks database schema access. Service
  configuration flags do not assert that trading or autonomous execution works.
- `/launch`, `/docs`, and `/token/<mint>` are served by the standalone Next server.
- The worker never decides amounts or destinations through AI. Existing protocol
  checks remain enabled.
- Cookies are HttpOnly, Secure in production, and authenticated by
  `SESSION_SECRET`. Rotating that secret signs users out. Wallet challenges expire
  after five minutes, are origin-bound, and can be consumed only once.

## Application status

Deployable hosting is separate from financial execution readiness. Launch
transactions, metadata upload, final chain indexing, autonomous LP execution,
SolCard deposits, and swap/burn signing still require their verified execution
integrations. Launches remain explicitly disabled. Do not describe this deployment
as a live trading product until those integrations are completed and tested.

The 10% buyback reservation is created atomically with a verified fee receipt.
Its state remains pending until the main THICC mint and actual execution are
available; reservations are not displayed as completed burns.
