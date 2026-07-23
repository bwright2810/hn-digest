# HN Digest

HN Digest is a source-grounded reader for leading Hacker News articles and their discussions. The project is currently under active development; see [`ROADMAP.md`](./ROADMAP.md) for scope and delivery order.

## Requirements

- Node.js 24.18.x (the current Node.js LTS line)
- pnpm 10.15.1, activated with Corepack
- Docker with Compose, when running PostgreSQL locally

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

The application listens on `http://localhost:3000`. Its health check is available at `GET /api/health` and returns `{ "status": "ok" }`.

Replace the two secret placeholders in `.env.local` before startup. Development defaults are provided for non-secret settings. Production requires every documented setting explicitly; invalid configuration stops the server and reports field names without printing supplied values.

Article fetching defaults to a 10-second total timeout, a 2 MiB response limit,
and five redirects. Configure these with `ARTICLE_FETCH_TIMEOUT_MS`,
`ARTICLE_FETCH_MAX_BYTES`, and `ARTICLE_FETCH_MAX_REDIRECTS`. Every redirect is
resolved and checked against public IP ranges before it is requested.

Public GitHub repository links resolve at most one README, and explicit GitHub
blob links resolve at most one allow-listed text file through the unauthenticated
Contents API. HN Digest does not clone, list, or traverse repositories, follow
embedded URLs, or accept GitHub credentials. Extracted GitHub evidence retains
the repository-relative path and a commit-pinned canonical link.

RSS and Atom sources select only the first direct item or entry in document
order. Feed links, enclosures, stylesheets, and embedded resources are never
followed. Generic XML, sitemaps, DTDs, entities, XInclude, malformed documents,
and parser network access remain unsupported; accepted entry evidence retains a
stable entry ID and source metadata.

## Visual system

The interface uses a restrained editorial system defined in
`src/app/styles.css`. Shared custom properties cover paper and ink colors, an
orange provenance accent, a serif display face, a system sans-serif utility
face, spacing, reading measure, and interaction timing. Reusable shell
primitives include the site header and footer, page intro, eyebrow labels, and
status notice.

Layouts support a 320-pixel viewport and expand to a 76-rem reading canvas. New
interface work should preserve semantic landmarks, the skip link, visible
keyboard focus, sufficient contrast, and reduced-motion behavior while using
the existing tokens before adding one-off values.

## Scheduling

Scheduled runs use the configured IANA time zone and local morning/evening
times; timestamps are stored in UTC. The production defaults are 7:00 AM and
7:00 PM in `America/New_York`, so UTC execution times shift automatically with
EST and EDT.

Each local slot has a unique key, making repeated scheduler ticks and restarts
idempotent. After downtime, the scheduler creates only the latest missed slot
within `DIGEST_MISSED_RUN_GRACE_MS` (six hours by default). It does not backfill
older slots, preventing a long outage from unexpectedly triggering a burst of
collection and LLM spend.

## On-demand runs

Operators with shell access can start a bounded run and inspect its progress:

```sh
pnpm digest:run 3
pnpm digest:status <run-id>
```

The count defaults to `DIGEST_STORY_COUNT` and cannot exceed that configured
maximum. PostgreSQL admits only one active on-demand run; concurrent commands
return the existing run ID instead of duplicating collection or LLM spend. No
anonymous HTTP run endpoint is exposed. The run command prints a JSON `started`
event as soon as the run is admitted and a `finished` event after collection,
so another shell can inspect the run ID while work is in progress.

## Analysis evaluation

Prompt, model, reasoning, selection, and token-budget changes are assessed
against the fixed synthetic evaluation set and weighted rubric documented in
[`docs/evaluation.md`](./docs/evaluation.md). The evaluation fixtures are
versioned, require no live network or model calls, and contain no copied source
articles.

## Operations and spend controls

HD-071 records cache lookups and deduplicated operational alerts in PostgreSQL.
The operations snapshot aggregates digest duration and failures, article fetch
outcomes, queue depth, LLM failures, cache hit rate, token usage, and spend over
a requested window. Daily and monthly spend windows use UTC calendar boundaries.

Configure `LLM_DAILY_SOFT_LIMIT_USD`, `LLM_DAILY_HARD_LIMIT_USD`,
`LLM_MONTHLY_SOFT_LIMIT_USD`, and `LLM_MONTHLY_HARD_LIMIT_USD`. Soft limits
create alert records. Before invoking the LLM, workers atomically compare actual
spend plus concurrent reservations with the hard limits; denied jobs are marked
`skipped_budget`. Story collection and the digest reader remain available.

## Security and privacy

The HD-072 threat review, trust boundaries, operator-access decision, secret and
logging rules, and current retention/deletion behavior are documented in
[`docs/security-and-privacy.md`](./docs/security-and-privacy.md).

## Deployment and recovery

The Coolify deployment topology, complete runtime configuration, migration
workflow, emergency spend shutdown, off-server backup policy, tested restore
procedure, rollback strategy, and failure runbook are documented in
[`docs/deployment-and-recovery.md`](./docs/deployment-and-recovery.md).

## Contributing and security

Development contributions are welcome; read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for setup, scope, testing, and pull-request guidance. Report suspected
vulnerabilities privately by following [`SECURITY.md`](./SECURITY.md).

The repository's intentional-publication safeguards and final owner-controlled
visibility steps are recorded in
[`docs/public-release.md`](./docs/public-release.md). Source code is available
under the [`MIT License`](./LICENSE); npm publication remains disabled.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm format` to apply formatting changes.

## Local PostgreSQL

The Compose file requires local credentials instead of committing defaults:

```sh
POSTGRES_USER=hn_digest POSTGRES_PASSWORD='choose-a-local-password' docker compose up -d postgres
```

PostgreSQL binds only to the local loopback interface. Set the matching `DATABASE_URL` in `.env.local` before running application or migration commands.

## Database migrations

Set `DATABASE_URL` in `.env.local`, then use the checked-in Drizzle migrations:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
CONFIRM_DATABASE_ROLLBACK=1 pnpm db:rollback
```

`db:rollback` currently removes the complete HD-010 development schema and Drizzle migration journal. It requires the explicit confirmation variable above and refuses to run when `NODE_ENV=production`. Production rollback must follow a reviewed, version-specific recovery plan.
