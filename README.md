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
