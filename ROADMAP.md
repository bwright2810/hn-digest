# HN Digest implementation roadmap

HN Digest collects the leading Hacker News stories on a schedule or on demand,
extracts their linked articles and notable discussions, and produces concise,
source-grounded summaries with an LLM.

This roadmap is ordered so that every milestone leaves behind a usable,
testable slice. Task IDs are stable and can later become GitHub issues.

## Product boundaries for the first release

- Collect a configurable number of stories from Hacker News twice daily and on
  demand.
- Summarize the linked article, the important perspectives in its HN discussion,
  and the combined takeaway.
- Preserve links to the story, article, and cited HN comments.
- Avoid reprocessing unchanged material.
- Enforce per-story and monthly LLM budgets.
- Provide a mobile-first web interface for browsing digest runs.
- Use a modern, minimal, distinctive visual language that does not resemble a
  generic chatbot or interchangeable LLM dashboard.

Not in the first release: native mobile apps, user accounts, personalized
ranking, embeddings, vector search, multiple LLM providers, and a separate
model-based comment-ranking stage.

## Technical baseline

- TypeScript on the current Node.js LTS release
- `pnpm`
- Next.js for the server-rendered web application and API
- PostgreSQL with Drizzle ORM
- Zod for configuration, boundary, and schema validation
- A PostgreSQL-backed job queue initially
- Vitest for unit and integration tests
- Headless Playwright for browser verification
- ESLint and Prettier
- CSS Modules and CSS custom properties for the visual system
- OpenAI Responses API with Structured Outputs
- Hacker News Firebase API
- Readability-style HTML article extraction
- A Dockerfile deployed through Coolify
- Docker Compose for local PostgreSQL

The web application, scheduler, and worker will share one repository and one
production container for the private MVP while remaining separate logical
modules. This keeps deployment simple and allows the processes to be split
later without redesigning the pipeline.

Initial production hosting will use the owner's existing Hetzner server and
existing domain through Coolify. The exact application hostname will be chosen
when deployment work begins.

### Verified deployment environment

Read-only inventory captured on 2026-07-22 through the `coolify` SSH alias:

- Hetzner KVM virtual server running Ubuntu 24.04.4 LTS on x86-64
- 2 virtual CPUs
- 1.9 GiB RAM and 4 GiB swap
- 38 GiB root filesystem with approximately 20 GiB available at inspection
- Docker Engine 29.2.1 and Docker Compose 5.0.2
- Coolify `4.0.0-beta.462`
- Traefik `3.6` as the Coolify-managed reverse proxy
- Coolify's internal PostgreSQL 15 and Redis 7 containers
- Seven existing application containers at inspection time

The existing `coolify-db` is Coolify's control-plane database and must not be
used by HN Digest. Create a separate PostgreSQL resource managed by Coolify,
with its own persistent volume, credentials, health check, and private network
connection to the application. Do not publish PostgreSQL port 5432 to the
internet.

The host has sufficient capacity for the private MVP at its expected load, but
RAM is limited. Deploy the web process and background worker together initially
unless measurements justify separate containers. Apply container resource
limits, keep worker and fetch concurrency conservative, and do not run
Playwright browsers on the production host. Run Playwright in CI or a dedicated
test environment.

Coolify should manage HTTPS routing through Traefik and inject application
secrets at runtime. Store database data in a persistent Coolify volume. Database
backups must be automated, encrypted where appropriate, retained outside this
server, and periodically restored in a test environment; a same-host volume is
not a disaster-recovery backup.

Record changes to this baseline in the decision log at the end of this file.

## Milestone 0: Project foundation

### HD-001 — Scaffold the TypeScript application

Create the package, TypeScript configuration, source/test directories, linting,
formatting, and scripts for development, build, type-checking, and tests.

Acceptance criteria:

- A clean checkout can install dependencies and run all validation commands.
- The application starts locally and exposes a health check.
- Supported Node.js and package-manager versions are documented.
- The scaffold uses the agreed toolchain from the technical baseline.
- A production Dockerfile and local PostgreSQL Docker Compose configuration are
  present without embedding credentials.

### HD-002 — Add configuration and secret validation

Define typed configuration for the database, OpenAI, scheduling, story count,
token limits, and application URL. Commit an example environment file without
credentials.

Acceptance criteria:

- Startup fails with a useful message when required configuration is missing.
- Secrets are never returned from an HTTP endpoint or written to logs.
- Safe development defaults exist for non-secret values.

### HD-003 — Establish automated checks

Add CI for installation, formatting, linting, type-checking, and tests.

Acceptance criteria:

- Checks run on pull requests and pushes to `main`.
- Dependency caching does not cache secrets or generated application data.

## Milestone 1: Persistence and Hacker News ingestion

### HD-010 — Design the initial database schema

Create migrations for:

- `stories`
- `story_snapshots`
- `comments`
- `documents`
- `digest_runs`
- `digest_run_stories`
- `analysis_jobs`
- `article_analyses`
- `discussion_analyses`
- `llm_usage`

Acceptance criteria:

- Migrations can create and roll back a development database.
- HN item IDs, URLs, content hashes, prompt versions, and model versions have
  appropriate unique constraints and indexes.
- Repeated ingestion is idempotent.

### HD-011 — Implement the Hacker News API client

Fetch top-story IDs, individual items, and comment descendants with bounded
concurrency, timeouts, retries, and response validation.

Acceptance criteria:

- Deleted and dead items are handled without failing a run.
- A malformed or unavailable item produces an observable error and does not
  abort unrelated stories.
- Tests use fixtures rather than the live API.

### HD-012 — Ingest a top-stories snapshot

Create a digest run and persist the top configurable `x` stories with their
rank, score, metadata, and collection time.

Acceptance criteria:

- Running ingestion twice does not duplicate stories.
- Each run preserves its original ordering even as HN scores change.
- Run status records partial and complete outcomes.

### HD-013 — Ingest and normalize comment trees

Fetch each story's discussion, sanitize HN HTML, preserve parent/child
relationships, and store comment metadata and text hashes.

Acceptance criteria:

- Deep trees are fetched without unbounded recursion.
- Deleted comments do not break thread structure.
- Subsequent runs update changed comments and reuse unchanged comments.

## Milestone 2: Article acquisition

### HD-020 — Build a safe URL fetcher

Fetch public article URLs with explicit timeouts, size limits, content-type
checks, redirect limits, and protection against private/internal network access.

Acceptance criteria:

- Loopback, link-local, private-network, and unsafe redirect destinations are
  rejected.
- Responses exceeding the configured limit are stopped.
- Fetch metadata and failure reasons are persisted without sensitive headers.

### HD-021 — Extract readable article text

Convert supported HTML pages into a title, byline, publication time, headings,
and primary article text. Normalize whitespace while retaining useful structure.

Acceptance criteria:

- Extraction is covered by representative saved fixtures.
- Low-confidence or empty extraction is identified explicitly.
- The normalized content receives a stable hash.

### HD-022 — Handle nonstandard submissions

Support HN text posts, inaccessible URLs, unsupported media, and PDFs with a
clear fallback policy.

Acceptance criteria:

- Text posts can be summarized without an external URL.
- Unsupported and access-restricted pages produce discussion-only jobs.
- PDF extraction is deferred from the private MVP. PDF submissions receive an
  explicit unsupported-document or discussion-only result; they never silently
  emit an empty article.

## Milestone 3: Context selection and token control

### HD-030 — Implement deterministic comment ranking

Rank comments using transparent signals such as thread position, reply activity,
length, branch diversity, and duplicate/quotation penalties.

Acceptance criteria:

- Selection covers multiple substantial branches rather than only the largest.
- Every selected comment retains its HN ID and parent ID.
- Ranking is deterministic and tested against fixed discussion fixtures.

### HD-031 — Build token-aware article selection

Fit long articles into a configurable budget while favoring the introduction,
conclusion, headings, and representative body sections.

Acceptance criteria:

- The final article context never exceeds its configured token allowance.
- Truncation is reported to downstream analysis and in stored metadata.
- Short articles pass through without unnecessary transformation.

### HD-032 — Assemble and estimate analysis requests

Combine instructions, schema, article excerpts, and selected comments; estimate
input tokens and worst-case output cost before submission.

Acceptance criteria:

- Separate limits exist for article, comments, instructions, and output.
- Jobs exceeding a hard cost limit are rejected or downgraded before an API
  request is made.
- The assembled request treats source content as untrusted data, not
  instructions.

## Milestone 4: LLM analysis

### HD-040 — Define the versioned analysis schema and prompt

Create a Structured Outputs schema covering article thesis, key points,
evidence, limitations, discussion consensus, competing viewpoints, insightful
comments, unresolved questions, combined takeaway, citations, and confidence.

Acceptance criteria:

- All discussion claims can cite one or more HN comment IDs.
- Article claims and commenter opinions are represented separately.
- Prompt and schema versions are stored with every result.
- Output length expectations are explicit.

### HD-041 — Implement the OpenAI client

Call the Responses API with timeouts, bounded retries, Structured Outputs, an
explicit model and reasoning setting, and a strict output-token cap.

Acceptance criteria:

- API errors are classified as retryable or terminal.
- Refusals and incomplete responses are stored as explicit outcomes.
- Logs never contain credentials or full copyrighted source documents.

### HD-042 — Persist usage and calculate cost

Record input, output, cached-read, and cache-write tokens plus the applicable
configured prices for every attempt.

Acceptance criteria:

- Costs can be reported per story, run, day, model, and prompt version.
- Historical costs remain reproducible when provider prices change.
- Estimated and actual usage can be compared.

### HD-043 — Add content-addressed analysis caching

Reuse analysis based on article hash, selected-comment hash, prompt/schema
version, model, and reasoning configuration.

Acceptance criteria:

- An unchanged story creates no new LLM request.
- Article analysis can be reused when only the discussion changes.
- Cache misses explain which key component changed.

### HD-044 — Add model routing and one-step fallback [deferred]

Status: deferred until evaluation data shows that selective escalation produces
a material quality improvement over the economical default model.

Use an economical default model and retry once with a stronger configuration
only for defined validation failures or high-value jobs.

Acceptance criteria:

- Routing rules are configuration, not scattered conditionals.
- No job can enter an unlimited retry or model-escalation loop.
- Usage reports distinguish initial and fallback attempts.

## Milestone 5: Job execution and scheduling

### HD-050 — Implement a PostgreSQL-backed worker

Claim jobs safely, enforce bounded concurrency, recover stale leases, and store
attempt history.

Acceptance criteria:

- Multiple workers cannot process the same claimed attempt concurrently.
- A worker crash does not permanently strand a job.
- Per-host fetch concurrency and LLM concurrency can be configured separately.

### HD-051 — Implement scheduled digest runs

Create morning and evening runs at 7:00 AM and 7:00 PM in
`America/New_York` without duplicating runs after restarts. Persist timestamps
in UTC and calculate schedules with the named IANA time zone.

Acceptance criteria:

- Schedule and time zone are configuration values.
- Production defaults are 7:00 AM and 7:00 PM in `America/New_York`.
- A unique schedule key prevents duplicate runs.
- Missed-run and daylight-saving transition behavior are documented and tested.

### HD-052 — Add asynchronous Batch API processing [deferred]

Status: deferred until scheduled inference volume makes the cost savings worth
the additional submission, polling, reconciliation, and timing complexity.

Submit scheduled LLM jobs through the provider's Batch API, poll their status,
and reconcile individual results. Leave on-demand jobs on the synchronous path.

Acceptance criteria:

- Batch request IDs map reliably back to analysis jobs.
- Partial failures can be retried without resubmitting successful work.
- The synchronous path remains available when a digest must complete promptly.

### HD-053 — Add on-demand run controls

Expose an authenticated operator action or CLI command that starts a run with a
bounded story count.

Acceptance criteria:

- Concurrent duplicate requests are coalesced or clearly rejected.
- The caller receives a run ID and can inspect progress.
- The endpoint cannot be used anonymously to create unbounded LLM spend.

## Milestone 6: Reading experience

### HD-059 — Define the visual system and responsive shell

Establish the typography, spacing, color, interaction, and responsive-layout
rules before building individual pages. The product should feel editorial and
purpose-built for reading Hacker News digests, not like a chat interface with a
different logo.

Acceptance criteria:

- Core tokens and reusable primitives are documented and implemented in code.
- The shell works from a 320-pixel-wide viewport through large desktop sizes.
- Typography and information hierarchy favor sustained reading and scanning.
- The design avoids default LLM-product motifs such as chat bubbles, glowing
  gradient decoration, and an oversized prompt box when those patterns do not
  serve a real interaction.
- Keyboard navigation, visible focus, contrast, reduced motion, and semantic
  landmarks are supported.

### HD-060 — Build the digest-run page

Show run status and ordered story cards containing the article summary,
discussion overview, combined takeaway, and source links.

Acceptance criteria:

- Partial and failed analyses have understandable states.
- All cited comments link to their HN anchors.
- Story cards and navigation require no horizontal scrolling at a 320-pixel
  viewport and make effective use of wider screens.
- Primary reading and navigation actions are usable with touch, keyboard, and
  mouse input.

### HD-061 — Build story detail and history pages [deferred]

Status: deferred until the core digest reading experience is validated.

Show the complete structured analysis and how a story's discussion evolved
across digest runs.

Acceptance criteria:

- Users can distinguish collection time from article publication time.
- Reused versus newly generated analysis is visible in diagnostic metadata.

### HD-062 — Add a delivery channel [deferred]

Status: deferred until the web digest and scheduling workflow are reliable.

Start with one channel—preferably email or an RSS/Atom feed—and render from the
same stored digest data as the web interface.

Acceptance criteria:

- Delivery retries are idempotent.
- A run cannot be delivered twice accidentally.
- Links lead back to the canonical digest and original sources.

### HD-063 — Add headless Playwright UI verification

Create browser tests for the responsive shell and critical reading flows. Run
them headlessly during local validation and CI, with artifacts retained on
failure.

Acceptance criteria:

- Tests cover the latest digest, story detail, run history, loading, empty,
  partial, and failed-analysis states.
- Each critical flow is exercised at representative mobile and desktop viewport
  sizes, including a 320-pixel-wide viewport.
- Tests verify navigation and important keyboard interactions, and detect
  unexpected horizontal overflow.
- CI runs Playwright headlessly and retains screenshots, traces, and videos on
  failure without storing secrets or sensitive source content.
- Stable fixtures or seeded test data keep tests independent of live Hacker
  News and LLM APIs.

## Milestone 7: Quality, operations, and release

### HD-070 — Create a representative evaluation set

Save 30–50 legally appropriate fixtures spanning technical articles, opinion
pieces, text posts, inaccessible pages, long discussions, weak discussions, and
controversial threads.

Acceptance criteria:

- A rubric scores faithfulness, coverage, discussion synthesis, citation
  quality, concision, and usefulness.
- Fixtures contain no secrets and avoid storing unnecessary copyrighted text.
- Model and prompt changes can be compared against the same cases.

### HD-071 — Add observability and budget alerts

Track run duration, fetch/extraction failures, queue depth, LLM failures, cache
hit rate, token usage, and estimated spend.

Acceptance criteria:

- Daily and monthly soft limits generate alerts.
- Hard limits stop new LLM submissions while leaving collection and browsing
  functional.
- A failed scheduled run is visible without inspecting raw logs.

### HD-072 — Perform security and privacy review

Review SSRF protection, HTML sanitization, prompt injection boundaries,
operator authentication, secret handling, logs, and data retention.

Acceptance criteria:

- No endpoint exposes environment variables, credentials, or arbitrary files.
- Untrusted article/comment content cannot alter application instructions.
- Retention and deletion behavior are documented.

### HD-073 — Write deployment and recovery documentation

Document database setup, migrations, worker/web processes, scheduling, backups,
configuration, deployment, rollback, and common failure recovery.

Acceptance criteria:

- A new environment can be deployed from the documentation.
- Database backup and restore have been tested.
- There is a documented way to disable scheduling and LLM spend immediately.
- Coolify configuration covers the application build, health check, domain,
  HTTPS routing, runtime secrets, persistent PostgreSQL volume, and private
  application-to-database networking.
- PostgreSQL is a dedicated HN Digest resource, not Coolify's internal database,
  and has no public host-port mapping.
- Production container memory and concurrency limits are documented for the
  2-vCPU/1.9-GiB host.
- Playwright runs outside the production server.

### HD-074 — Prepare the repository for public MIT release

Keep the project private initially, then perform an intentional public-release
review and add the MIT license before changing repository visibility.

Acceptance criteria:

- An MIT `LICENSE` file and matching package metadata are committed before the
  repository becomes public.
- Git history, fixtures, logs, documentation, examples, and configuration are
  reviewed for secrets, private hostnames, personal data, and unnecessary
  copyrighted source text.
- Public setup, contribution, and security-reporting documentation are present.
- Repository visibility is changed only after the release review passes.

## Suggested delivery order

The shortest path to proving the idea is:

1. HD-001 through HD-003
2. HD-010 through HD-013
3. HD-020 through HD-022
4. HD-030 through HD-032
5. HD-040 through HD-043
6. HD-050, HD-051, HD-059, HD-060, and HD-063
7. HD-070 and HD-071

At that point the project has an end-to-end private MVP. Model fallback, Batch
processing, on-demand controls, history, delivery, and deployment hardening can
follow based on measured need.

## Deferred from the private MVP

- HD-044: stronger-model routing and fallback
- HD-052: Batch API processing
- HD-061: story history pages
- HD-062: email or feed delivery
- PDF text extraction within HD-022
- Separate LLM calls for article and discussion analysis

For the MVP, one bounded synchronous request should generate both the article
and discussion sections. Persist those sections separately where useful so they
can evolve independently later, but do not double the number of model calls.

## Cross-cutting rules

- Do not send an LLM content that deterministic code can discard first.
- Every external request has a timeout, size limit, and bounded retry policy.
- Every LLM request has input, output, per-job, daily, and monthly limits.
- Persist raw provider usage; do not infer actual tokens solely from estimates.
- Cache using content hashes plus prompt, schema, model, and reasoning versions.
- Preserve evidence IDs and source URLs throughout the pipeline.
- Treat web pages, HN posts, and comments as untrusted input.
- Prefer measurable quality improvements over adding more model calls.

## Open decisions

- First post-MVP delivery channel: email or RSS/Atom
- Default number of stories per run
- Exact article and comment token budgets
- Whether the first release needs operator authentication or only a local CLI
- Exact application hostname on the existing domain
- Off-server PostgreSQL backup destination and retention policy

## Decision log

Record decisions here with the date, choice, and short rationale.

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-22 | Use `hn-digest` as the project name. | Direct, memorable, and accurately describes the product. |
| 2026-07-22 | Deploy through Coolify on the owner's existing Hetzner server and domain. | Avoids additional hosting and domain costs and reuses the existing Docker/Traefik deployment platform. |
| 2026-07-22 | Run a dedicated HN Digest PostgreSQL resource in Coolify on the same server. | The private MVP load fits the host; isolating it from Coolify's control-plane database preserves ownership, upgrades, backups, and recovery boundaries. |
| 2026-07-22 | Run Playwright outside production and initially colocate the web and worker processes. | The server has only 1.9 GiB RAM; browser processes and unnecessary service separation would reduce operating headroom. |
| 2026-07-22 | Defer HD-044, HD-052, HD-061, HD-062, PDF extraction, and separate article/discussion model calls. | Keeps the private MVP focused and avoids complexity whose cost or quality benefit has not yet been demonstrated. |
| 2026-07-22 | Use Node.js LTS, TypeScript, pnpm, Next.js, PostgreSQL with Drizzle, Zod, Vitest, Playwright, ESLint, Prettier, and CSS Modules/custom properties. | Provides a typed full-stack baseline, predictable validation, controlled visual design, and straightforward Coolify deployment. |
| 2026-07-22 | Schedule digests for 7:00 AM and 7:00 PM in `America/New_York`, while storing timestamps in UTC. | Matches the owner's preferred Eastern Time schedule and handles EST/EDT transitions through an IANA time zone. |
| 2026-07-22 | Keep the repository private initially and plan an MIT-licensed public release. | Allows development and a security review before intentionally publishing code and history. |
| 2026-07-22 | Use configurable `gpt-5.6-luna` with low reasoning as the private-MVP baseline. | It is the current efficient high-volume model; changing the baseline or using stronger reasoning remains contingent on evaluation results. |
| 2026-07-22 | Evaluate analysis changes against 30 fixed synthetic cases with a weighted six-dimension rubric. | Synthetic CC0 fixtures keep comparison repeatable and legally safe; weighting faithfulness highest prevents aggregate quality gains from obscuring grounding regressions. |
| 2026-07-22 | Use UTC calendar windows for LLM daily/monthly budgets and persist deduplicated operational alerts. | UTC boundaries make enforcement reproducible alongside persisted timestamps; database alerts remain visible without relying on ephemeral process logs. |
