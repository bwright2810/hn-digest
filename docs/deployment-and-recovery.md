# Deployment and recovery runbook

This runbook covers HD-073 for the private MVP on the verified Ubuntu 24.04
Hetzner host running Coolify `4.0.0-beta.462` and Traefik 3.6. Treat names,
passwords, hostnames, resource IDs, and backup locations below as placeholders;
never commit their real values.

## Current process boundary

The production image runs a small PID-1 supervisor that starts the Next.js web
reader and a background runtime in one container. The background runtime polls
the idempotent scheduler, assembles pending runs, and processes queued analysis
work. SIGTERM or
SIGINT stops new polling, drains active iterations, closes PostgreSQL, and
stops the web child within a configured grace period.

Scheduled and on-demand runs collect source material and submit bounded
synchronous analysis requests. Stop the application before changing model,
pricing, token, or spend-limit configuration; the queue stores the assumptions
used for each job and reconstructs source context from PostgreSQL at claim time.

## Production topology

Create these resources in one Coolify project and environment:

1. A dedicated PostgreSQL 17 resource named for HN Digest, with its own
   persistent volume. This is application data; never connect HN Digest to the
   `coolify-db` control-plane database.
2. One HN Digest application built from this repository's `Dockerfile`. The
   application and database must share a private Coolify network.
3. One private S3-compatible backup destination outside the Hetzner server.
   Choosing its provider and retention period remains an explicit open
   decision; deployment is not recovery-ready until both are recorded.

PostgreSQL must have no public domain and no host/public mapping for port 5432.
Only the application may connect to it over the private network. Publish only
application port 3000 through Coolify's Traefik integration; do not add a host
port mapping for the application container.

Initial resource ceilings for the constrained 2-vCPU/1.9-GiB host are:

| Resource              | CPU limit | Memory limit | Operational default                                                                        |
| --------------------- | --------: | -----------: | ------------------------------------------------------------------------------------------ |
| HN Digest application |     1 CPU |      512 MiB | one web and one background process; later one LLM request and two fetches per host at most |
| HN Digest PostgreSQL  |   0.5 CPU |      512 MiB | dedicated volume; default connection pool only                                             |

Leave capacity for Coolify, Traefik, Docker, and existing workloads. Inspect
actual container memory and swap after deployment and during a digest run.
Increase a limit only from measurements; do not add Playwright or browser
packages to production. Playwright stays in CI or a dedicated test system.

## Required configuration

Production has no non-secret defaults. Set every variable below in Coolify as a
runtime variable. Mark `DATABASE_URL`, `OPENAI_API_KEY`, and `ADMIN_PASSWORD`
secret and exclude
them from build arguments, image layers, deployment logs, and previews.

| Variable                                    | Production value or rule                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                  | `production`                                                                                   |
| `DATABASE_URL`                              | Coolify private PostgreSQL URL; require TLS if supported by the private resource configuration |
| `OPENAI_API_KEY`                            | project-scoped API key with the smallest practical permissions and spend controls              |
| `ADMIN_PASSWORD`                            | unique random value of at least 16 characters for the `/admin` HTTP Basic prompt               |
| `OPENAI_MODEL`                              | evaluated model from the roadmap decision log                                                  |
| `OPENAI_REASONING_EFFORT`                   | `low` until evaluation justifies a change                                                      |
| `OPENAI_REQUEST_TIMEOUT_MS`                 | `60000`                                                                                        |
| `OPENAI_MAX_RETRIES`                        | `2`                                                                                            |
| `OPENAI_INPUT_USD_PER_MILLION_TOKENS`       | current standard-processing input price for the configured model                               |
| `OPENAI_CACHED_READ_USD_PER_MILLION_TOKENS` | current cached-input price for the configured model                                            |
| `OPENAI_CACHE_WRITE_USD_PER_MILLION_TOKENS` | current cache-write price for the configured model                                             |
| `OPENAI_OUTPUT_USD_PER_MILLION_TOKENS`      | current standard-processing output price for the configured model                              |
| `APP_URL`                                   | final `https://<hn-digest-hostname>` URL                                                       |
| `DIGEST_TIME_ZONE`                          | `America/New_York`                                                                             |
| `DIGEST_MORNING_TIME`                       | `07:00`                                                                                        |
| `DIGEST_EVENING_TIME`                       | `19:00`                                                                                        |
| `DIGEST_STORY_COUNT`                        | reviewed private-MVP count                                                                     |
| `DIGEST_MINIMUM_COMMENT_COUNT`              | `10`; minimum HN discussion size before a story is selected                                    |
| `DIGEST_MISSED_RUN_GRACE_MS`                | `21600000`                                                                                     |
| `ARTICLE_FETCH_TIMEOUT_MS`                  | `10000`                                                                                        |
| `ARTICLE_FETCH_MAX_BYTES`                   | `2097152`                                                                                      |
| `ARTICLE_FETCH_MAX_REDIRECTS`               | `5`                                                                                            |
| `LLM_INSTRUCTION_TOKEN_LIMIT`               | reviewed token allowance                                                                       |
| `LLM_ARTICLE_TOKEN_LIMIT`                   | reviewed token allowance                                                                       |
| `LLM_COMMENT_TOKEN_LIMIT`                   | reviewed token allowance                                                                       |
| `LLM_OUTPUT_TOKEN_LIMIT`                    | reviewed token allowance                                                                       |
| `LLM_MAX_REQUEST_COST_USD`                  | owner-approved worst-case ceiling for one story request                                        |
| `COMMENT_SELECTION_MAXIMUM`                 | `30`                                                                                           |
| `LLM_DAILY_SOFT_LIMIT_USD`                  | owner-approved warning threshold                                                               |
| `LLM_DAILY_HARD_LIMIT_USD`                  | owner-approved daily ceiling                                                                   |
| `LLM_MONTHLY_SOFT_LIMIT_USD`                | owner-approved warning threshold                                                               |
| `LLM_MONTHLY_HARD_LIMIT_USD`                | owner-approved monthly ceiling                                                                 |
| `WORKER_FETCH_CONCURRENCY_PER_HOST`         | `2`                                                                                            |
| `WORKER_LLM_CONCURRENCY`                    | `1`                                                                                            |
| `WORKER_LEASE_MS`                           | `300000`                                                                                       |
| `SCHEDULER_POLL_INTERVAL_MS`                | `30000`                                                                                        |
| `WORKER_POLL_INTERVAL_MS`                   | `5000`                                                                                         |
| `RUNTIME_SHUTDOWN_GRACE_MS`                 | `30000`                                                                                        |

The application intentionally fails startup when any production variable is
missing or invalid. Configuration errors identify field names and constraints,
not supplied values.

## First deployment

### 1. Prepare PostgreSQL

- Create a PostgreSQL 17 resource in the HN Digest Coolify project.
- Generate unique database, username, and password values in Coolify.
- Confirm a persistent volume is attached to PostgreSQL's data directory.
- Attach the database and application to the same private network.
- Confirm port 5432 has no public mapping and the resource is not
  `coolify-db`.
- Record the resource name and database name in the private operations record,
  never in Git.

### 2. Apply migrations

Migrations are forward-only in production. From a trusted one-off environment
that has this exact commit checked out and private network access to the HN
Digest database, set only `DATABASE_URL` and run:

```sh
node --version # must report the supported 24.18.x line
corepack enable
pnpm install --frozen-lockfile
pnpm db:check
pnpm db:migrate
```

In Coolify, use a one-off command/container attached to the same private
network; do not temporarily publish PostgreSQL to run migrations. Take a fresh
off-server backup before every migration after the first deployment. A
migration failure blocks application promotion. Never run `db:rollback` in
production: that script deliberately refuses production and removes the entire
development schema.

### 3. Configure the application

- Select Dockerfile deployment from the private Git repository and pin the
  production branch to `main`.
- Use the repository-root `Dockerfile`; its default runtime starts
  `node production.js`, supervises web/background children, listens on port
  3000, and runs as an unprivileged user.
- Set Coolify's post-deployment command to `node migrate.js`. The bundled
  forward-only runner reads `/app/drizzle`, is safe to repeat, and executes in
  the newly deployed container on the private database network.
- The production image also bundles the operator CLI as `node digest.js run`
  and `node digest.js status <run-id>` for one-off execution in the application
  container.
- The production image bundles the aggregate-only HD-075 report as
  `node source-baseline.js [from-iso-date] [to-iso-date] [minimum-run-count]`.
  Run it as a trusted
  one-off command on the private database network; it emits no source URLs or
  bodies and exits with status 2 while fewer than the requested/default 10
  qualifying runs exist; `extendedReady` tracks the 30-run adapter gate.
- The zero-LLM source discovery command is `node source-discovery.js [limit]`.
  It scans up to 500 current HN `topstories` items and emits bounded aggregate
  URL-shape classifications without fetching linked article bodies.
- Add all runtime variables from the table above. Do not configure them as
  Docker build arguments.
- Set the health check to HTTP `GET /api/health` on port 3000. Use a 30-second
  initial grace period, a 10-second interval, a 5-second timeout, and at least
  three retries.
- Set the application memory/CPU limits from the topology table.
- Choose the final hostname, set `APP_URL` to its HTTPS URL, and configure that
  hostname on the application. Let Traefik obtain and terminate HTTPS; do not
  terminate TLS in Node or expose port 3000 directly.
- Deploy only after migrations succeed. Verify the image digest/commit shown by
  Coolify matches the intended Git commit.

### 4. Smoke-test

From outside the server:

```sh
curl --fail --show-error --silent https://<hn-digest-hostname>/api/health
curl --fail --show-error --silent --head https://<hn-digest-hostname>/
```

Expect `{"status":"ok"}` from health, HTTPS without a certificate warning,
security headers from HD-072, and a readable empty/latest digest page. Confirm
there is no public listener for PostgreSQL. Review Coolify logs for classified
errors only; secrets and source bodies must not appear.

## Immediate scheduling and spend shutdown

The emergency stop for this initial combined deployment is to stop the
application container. This prevents new claims and model requests;
queued jobs remain in PostgreSQL, but the reader is also unavailable until the
container restarts.

Also set the OpenAI project budget/rate limit as an independent provider-side
ceiling and revoke the project key if requests continue unexpectedly. Key
revocation is a last-resort spend stop and may make a combined process fail its
configuration on restart. Do not rely only on changing application soft limits:
soft limits alert but do not block. Database daily/monthly hard limits block
new submissions after the configured threshold, but stopping the worker is the
fastest deterministic application-side control.

Record who stopped processing, the UTC time, the reason, the last provider
request ID, and whether any job was already in flight. Do not restart until the
cause and remaining budget are understood.

## Backups

Configure Coolify's PostgreSQL backup facility (field names can vary by
release) to write encrypted backups to the chosen S3-compatible destination:

- use a dedicated bucket/prefix and restricted write/read credentials;
- run at least daily and before migrations or risky maintenance;
- enable encryption in transit and server-side encryption at the destination;
- retain enough daily/weekly copies to meet the owner's recovery objective;
- enable destination-side versioning or immutability when available;
- alert on missed or failed backups; and
- verify new objects exist off-server without logging credentials.

A PostgreSQL volume, Docker volume snapshot, or dump stored only on the Hetzner
host is not a backup. Record the chosen destination, schedule, retention,
encryption mode, most recent success, and most recent restore-test date in the
private operations record.

For a manual logical backup, run PostgreSQL 17 `pg_dump` from a trusted one-off
container on the private network and stream/write the custom-format output
directly to encrypted off-server storage. Use `--format=custom`; never print the
database URL or embed its password in a command, filename, or shell history.

## Restore procedure

Never test a restore over the live database.

1. Select a backup by UTC timestamp and verify its object size/checksum.
2. Create a separate private PostgreSQL 17 resource and persistent volume named
   clearly as a restore test. Do not publish port 5432.
3. Retrieve the dump into a short-lived trusted environment attached to the
   restore database's private network.
4. Restore with the same PostgreSQL major version, using a generated credential
   supplied through the environment:

   ```sh
   pg_restore --host=<private-host> --username=<restore-user> \
     --dbname=<empty-restore-database> --clean --if-exists --no-owner \
     hn_digest.dump
   ```

5. Verify `drizzle.__drizzle_migrations` exists and has the expected migration
   count. Compare counts for digest runs, stories, comments, documents,
   analyses, and LLM usage with the source backup manifest. Inspect the newest
   digest timestamp and load the reader against the restored database in a
   non-public test application.
6. Run `pnpm db:check`; do not apply newer migrations until the as-backed-up
   state has been verified.
7. Record backup identity, checksum, PostgreSQL version, migration count, table
   counts, duration, result, operator, and UTC date. Delete the temporary
   restore application/database and local dump after the record is complete.

HD-073 validation on 2026-07-22 used isolated PostgreSQL `17-alpine`, applied
all six checked-in migrations, inserted a digest run, created a 52,826-byte
custom-format dump, restored it into a fresh database, and verified 13 public
tables, six migration records, and the seeded row. This proves the repository
schema's logical dump/restore path; it does not replace the required recurring
restore test from the eventual off-server production backup destination.

## Application and database rollback

Application rollback and database recovery are separate decisions:

- For an application-only regression with a compatible schema, redeploy the
  previously known-good immutable image/commit in Coolify. Keep the database at
  its current forward migration level.
- For a failed deployment before migrations, leave the database unchanged and
  redeploy the prior application image.
- For a failed forward migration, stop writers, preserve the failed database,
  and assess a corrective forward migration first. If recovery requires data
  rewind, create a new database resource and restore the pre-migration backup;
  do not overwrite the failed database until the restored copy is verified.
- Point the application at a restored database only during a controlled
  maintenance window. Update `DATABASE_URL` as a secret, deploy the matching
  application commit, smoke-test, then retain the failed database until the
  incident review allows deletion.

Coolify rollback must never change repository visibility, expose PostgreSQL,
reuse `coolify-db`, or place secrets in an image. Record commit/image identity,
migration level, backup identity, timestamps, and verification results.

## Common failure recovery

| Symptom                            | Check                                                                              | Recovery                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Application fails at startup       | Coolify runtime variables and classified configuration error                       | Add/correct the named variable as a runtime secret/value; never paste its value into logs                        |
| Health check fails after deploy    | container logs, port 3000, memory limit, database DNS/connectivity                 | restore private-network attachment, correct health target, or roll back the application image                    |
| Database connection fails          | dedicated resource status, private hostname, credential rotation, connection count | keep 5432 private; rotate/update `DATABASE_URL` atomically and redeploy                                          |
| Migration fails                    | migration output, PostgreSQL version, pre-migration backup                         | stop promotion; prefer a reviewed forward fix or restore into a new resource                                     |
| Scheduled run missing              | background process status, time zone, grace window, failed-run alerts              | correct configuration or connectivity, then restart; the unique schedule key makes slot creation idempotent      |
| Queue stops moving                 | worker process, leases, queue depth, hard-budget alerts                            | keep LLM stopped until budget is checked; expired leases are reclaimable by the worker implementation            |
| Spend alert or unexpected requests | actual usage, reservations, provider dashboard, last request IDs                   | stop background processing immediately; revoke the project key if requests continue                              |
| Article fetch failures spike       | classified failure codes, DNS/network policy, target content types                 | do not weaken SSRF rules; leave stories discussion-only and investigate by failure class                         |
| Backup missing or restore fails    | object checksum, destination credentials, PostgreSQL major version, restore logs   | treat recovery readiness as failed; fix the backup path and complete a new isolated restore test                 |
| Host memory pressure               | Docker/Coolify metrics, swap, app and DB container usage                           | stop background work first, retain concurrency 1/2, roll back memory-heavy changes, and avoid running Playwright |

## Release checklist

- [ ] Final HTTPS hostname selected and `APP_URL` matches it.
- [ ] Dedicated private PostgreSQL 17 resource and persistent volume verified.
- [ ] No public 5432 mapping; `coolify-db` is not referenced.
- [ ] Every production configuration variable is set at runtime.
- [ ] Forward migrations applied from the exact application commit.
- [ ] Application commit/image identity recorded and resource limits applied.
- [ ] Health and reader smoke tests pass through HTTPS.
- [ ] Scheduling/worker state accurately recorded (disabled for the current image).
- [ ] Provider-side and database spend ceilings reviewed.
- [ ] Off-server backup destination, schedule, retention, and encryption recorded.
- [ ] A backup from that destination has passed an isolated restore test.
- [ ] Rollback image, matching migration level, and recovery contacts recorded.
- [ ] Playwright remains outside production.
