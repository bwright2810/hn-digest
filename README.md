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

PostgreSQL binds only to the local loopback interface. HD-002 will add application configuration and a documented example environment file.
