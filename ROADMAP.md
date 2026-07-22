# HN Digest implementation roadmap

HN Digest collects the leading Hacker News stories on a schedule or on demand,
extracts their linked articles and notable discussions, and produces concise,
source-grounded summaries with an LLM.

Task IDs are stable. Completed tasks remain in this file as the implementation
record; active, gated, and deferred work is called out explicitly.

## Current state and priorities

The private MVP is deployed and operational. It collects scheduled and
on-demand digests, performs bounded source acquisition and structured analysis,
tracks usage and cost, and exposes authenticated operator and editorial reading
surfaces. The production application uses its own private PostgreSQL resource.

Status labels mean:

- **Complete:** implemented and validated against the task's acceptance criteria.
- **Active:** the next work that can proceed now.
- **Monitoring:** collecting production evidence before a decision.
- **Gated:** authorized only if its stated evidence gate is met.
- **Deferred:** outside the current release until the decision log changes.

Immediate priorities, in order:

1. HD-080: configure and restore-test off-server production backups.
2. HD-081: complete the extended source-adapter evidence review over 30 varied
   runs.
3. Reassess HD-077 through HD-079 only from HD-081's evidence.
4. Perform the owner-controlled repository visibility change when desired,
   after a fresh public-release review.

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

The web application, scheduler, and worker share one repository and one
production container while remaining separate logical modules. This keeps
deployment simple and allows the processes to be split later without
redesigning the pipeline.

Production runs through Coolify on the owner's existing Hetzner server and
domain. The hostname is configured privately through `APP_URL` and should not
be recorded in this public roadmap.

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

### HD-001 — Scaffold the TypeScript application [complete]

Create the package, TypeScript configuration, source/test directories, linting,
formatting, and scripts for development, build, type-checking, and tests.

Acceptance criteria:

- A clean checkout can install dependencies and run all validation commands.
- The application starts locally and exposes a health check.
- Supported Node.js and package-manager versions are documented.
- The scaffold uses the agreed toolchain from the technical baseline.
- A production Dockerfile and local PostgreSQL Docker Compose configuration are
  present without embedding credentials.

### HD-002 — Add configuration and secret validation [complete]

Define typed configuration for the database, OpenAI, scheduling, story count,
token limits, and application URL. Commit an example environment file without
credentials.

Acceptance criteria:

- Startup fails with a useful message when required configuration is missing.
- Secrets are never returned from an HTTP endpoint or written to logs.
- Safe development defaults exist for non-secret values.

### HD-003 — Establish automated checks [complete]

Add CI for installation, formatting, linting, type-checking, and tests.

Acceptance criteria:

- Checks run on pull requests and pushes to `main`.
- Dependency caching does not cache secrets or generated application data.

## Milestone 1: Persistence and Hacker News ingestion

### HD-010 — Design the initial database schema [complete]

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

### HD-011 — Implement the Hacker News API client [complete]

Fetch top-story IDs, individual items, and comment descendants with bounded
concurrency, timeouts, retries, and response validation.

Acceptance criteria:

- Deleted and dead items are handled without failing a run.
- A malformed or unavailable item produces an observable error and does not
  abort unrelated stories.
- Tests use fixtures rather than the live API.

### HD-012 — Ingest a top-stories snapshot [complete]

Create a digest run and persist the top configurable `x` stories with their
rank, score, metadata, and collection time.

Acceptance criteria:

- Running ingestion twice does not duplicate stories.
- Each run preserves its original ordering even as HN scores change.
- Run status records partial and complete outcomes.

### HD-013 — Ingest and normalize comment trees [complete]

Fetch each story's discussion, sanitize HN HTML, preserve parent/child
relationships, and store comment metadata and text hashes.

Acceptance criteria:

- Deep trees are fetched without unbounded recursion.
- Deleted comments do not break thread structure.
- Subsequent runs update changed comments and reuse unchanged comments.

## Milestone 2: Article acquisition

### HD-020 — Build a safe URL fetcher [complete]

Fetch public article URLs with explicit timeouts, size limits, content-type
checks, redirect limits, and protection against private/internal network access.

Acceptance criteria:

- Loopback, link-local, private-network, and unsafe redirect destinations are
  rejected.
- Responses exceeding the configured limit are stopped.
- Fetch metadata and failure reasons are persisted without sensitive headers.

### HD-021 — Extract readable article text [complete]

Convert supported HTML pages into a title, byline, publication time, headings,
and primary article text. Normalize whitespace while retaining useful structure.

Acceptance criteria:

- Extraction is covered by representative saved fixtures.
- Low-confidence or empty extraction is identified explicitly.
- The normalized content receives a stable hash.

### HD-022 — Handle nonstandard submissions [complete]

Support HN text posts, inaccessible URLs, unsupported media, and PDFs with a
clear fallback policy.

Acceptance criteria:

- Text posts can be summarized without an external URL.
- Unsupported and access-restricted pages produce discussion-only jobs.
- PDF extraction is deferred from the private MVP. PDF submissions receive an
  explicit unsupported-document or discussion-only result; they never silently
  emit an empty article.

## Milestone 3: Context selection and token control

### HD-030 — Implement deterministic comment ranking [complete]

Rank comments using transparent signals such as thread position, reply activity,
length, branch diversity, and duplicate/quotation penalties.

Acceptance criteria:

- Selection covers multiple substantial branches rather than only the largest.
- Every selected comment retains its HN ID and parent ID.
- Ranking is deterministic and tested against fixed discussion fixtures.

### HD-031 — Build token-aware article selection [complete]

Fit long articles into a configurable budget while favoring the introduction,
conclusion, headings, and representative body sections.

Acceptance criteria:

- The final article context never exceeds its configured token allowance.
- Truncation is reported to downstream analysis and in stored metadata.
- Short articles pass through without unnecessary transformation.

### HD-032 — Assemble and estimate analysis requests [complete]

Combine instructions, schema, article excerpts, and selected comments; estimate
input tokens and worst-case output cost before submission.

Acceptance criteria:

- Separate limits exist for article, comments, instructions, and output.
- Jobs exceeding a hard cost limit are rejected or downgraded before an API
  request is made.
- The assembled request treats source content as untrusted data, not
  instructions.

## Milestone 4: LLM analysis

### HD-040 — Define the versioned analysis schema and prompt [complete]

Create a Structured Outputs schema covering article thesis, key points,
evidence, limitations, discussion consensus, competing viewpoints, insightful
comments, unresolved questions, combined takeaway, citations, and confidence.

Acceptance criteria:

- All discussion claims can cite one or more HN comment IDs.
- Article claims and commenter opinions are represented separately.
- Prompt and schema versions are stored with every result.
- Output length expectations are explicit.

### HD-041 — Implement the OpenAI client [complete]

Call the Responses API with timeouts, bounded retries, Structured Outputs, an
explicit model and reasoning setting, and a strict output-token cap.

Acceptance criteria:

- API errors are classified as retryable or terminal.
- Refusals and incomplete responses are stored as explicit outcomes.
- Logs never contain credentials or full copyrighted source documents.

### HD-042 — Persist usage and calculate cost [complete]

Record input, output, cached-read, and cache-write tokens plus the applicable
configured prices for every attempt.

Acceptance criteria:

- Costs can be reported per story, run, day, model, and prompt version.
- Historical costs remain reproducible when provider prices change.
- Estimated and actual usage can be compared.

### HD-043 — Add content-addressed analysis caching [complete]

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

### HD-050 — Implement a PostgreSQL-backed worker [complete]

Claim jobs safely, enforce bounded concurrency, recover stale leases, and store
attempt history.

Acceptance criteria:

- Multiple workers cannot process the same claimed attempt concurrently.
- A worker crash does not permanently strand a job.
- Per-host fetch concurrency and LLM concurrency can be configured separately.

### HD-051 — Implement scheduled digest runs [complete]

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

### HD-053 — Add on-demand run controls [complete]

Expose an authenticated operator action or CLI command that starts a run with a
bounded story count.

Acceptance criteria:

- Concurrent duplicate requests are coalesced or clearly rejected.
- The caller receives a run ID and can inspect progress.
- The endpoint cannot be used anonymously to create unbounded LLM spend.

### HD-054 — Add production process entrypoints [complete]

Run the Next.js web process and the PostgreSQL-backed scheduler and
worker-readiness loops from one production container, while keeping them as
separate logical modules.
The runtime must stop cleanly, poll conservatively on the memory-constrained
host, and isolate recoverable background-loop failures from the web process.

This task starts the existing scheduler and worker machinery. End-to-end
assembly of collected stories into analysis jobs is a separate pipeline task;
HD-054 must not fabricate model requests or persist complete prompt payloads as
a shortcut.

Acceptance criteria:

- One container starts the web server, scheduler loop, and worker-readiness
  loop; queued jobs remain unclaimed until a real pipeline processor exists.
- SIGTERM and SIGINT stop polling, drain current iterations, close PostgreSQL,
  and terminate the web child process within a bounded grace period.
- Poll intervals are typed configuration and production requires explicit
  values.
- Schedule polling uses the configured named time zone and existing unique
  schedule key, so restarts cannot create duplicate scheduled runs.
- Recoverable scheduler or worker iteration failures are classified and logged
  without silently terminating the web process; startup/configuration failures
  still fail the container.
- Unit tests cover polling, failure isolation, and graceful cancellation, and a
  production-container smoke test verifies all entrypoints start.

### HD-055 — Connect the end-to-end digest pipeline [complete]

Turn pending scheduled and on-demand runs into bounded analysis jobs, process
those jobs through the synchronous OpenAI Responses API, and persist validated
article/discussion results and usage. Reconstruct model requests from stored,
trusted application records rather than persisting complete prompts or source
bodies in the queue.

Acceptance criteria:

- Pending runs collect top stories, comments, and supported article or HN text
  content, with per-story failures isolated from unrelated stories.
- Deterministic article/comment selection runs before enqueueing, and queued
  metadata contains hashes, IDs, versions, budgets, and truncation facts but no
  complete source corpus or model prompt.
- Each cache miss creates one bounded synchronous request and may make one
  additional correction attempt only when comment-citation validation fails; a
  cache hit attaches validated prior results without an LLM call.
- Per-request, daily, and monthly spend checks run before submission; actual
  provider usage and the price assumptions used are persisted.
- Refusals, incomplete responses, acquisition failures, and provider failures
  produce explicit story/job states and cannot strand a run. Citation failures
  are corrected once, then invalid discussion references are omitted
  deterministically while valid analysis remains available.
- Run/story statuses reach complete, partial, or failed terminal states, and
  retry-safe polling does not duplicate stories or queued jobs.
- Integration tests exercise collection, queue assembly, cache reuse, worker
  persistence, and terminal-state reconciliation without live HN/OpenAI calls.

### HD-056 — Add authenticated operator controls [complete]

Provide a private, single-operator web surface for starting bounded on-demand
runs and reviewing recent run, story, job, and validation failures. Protect the
surface with deployment-supplied HTTP Basic credentials; this is operational
access, not a general user-account system.

Acceptance criteria:

- Anonymous requests cannot view operational data or create LLM work.
- The operator can enqueue one to the configured maximum story count; an
  already-active on-demand run is coalesced and linked instead of duplicated.
- Recent runs expose terminal and active states, story-level failure codes, and
  job/attempt failure classifications without source bodies, prompts, or secrets.
- The production credential is injected at runtime and is never logged or
  returned by an application route.

### HD-057 — Gate digest stories by discussion depth [complete]

Scan Hacker News's ranked `topstories` feed in order and include only available
stories meeting a configurable minimum comment count.

Acceptance criteria:

- Filtering preserves the relative HN rank of qualifying stories.
- The collector scans beyond the first requested IDs to fill the run when
  possible, while retaining bounded API requests.
- A shortfall is explicit when too few ranked stories meet the threshold.

### HD-058 — Audit and expand supported source types [complete]

Measure which HN story links fall back to discussion-only analysis, classify
the failure modes by source and content type, and add deterministic support for
the highest-value formats that fit the existing extraction and security model.
PDF extraction remains deferred unless the decision log is deliberately
updated first.

Acceptance criteria:

- Production-safe metrics distinguish access restrictions, unsupported content
  types, extraction failures, and low-confidence text without storing source
  bodies or sensitive URLs.
- A reviewed fixture set represents the most common unsupported HN link types.
- Prioritized formats are supported with bounded fetches, SSRF protection,
  content validation, and extraction-quality tests.
- Unsupported sources continue to produce an explicit discussion-only result
  rather than failing the entire story.

### HD-075 — Establish the source-adapter baseline [complete]

Collect an initial aggregate source-acquisition baseline over at least 10
digest runs and 50 story occurrences, then rank unsupported formats using the
scoring factors in `docs/discussion-only-source-support-plan.md`. Do not retain
source bodies or complete URLs in the baseline.

Acceptance criteria:

- The reviewed baseline includes outcome counts, coarse source/content types,
  median discussion depth and rank, expected recovery, effort, risk, and
  evidence fidelity.
- A format is selected only when observed in the baseline or reviewed fixtures
  and expected to recover useful context for at least 20% of its occurrences.
- Every selected format receives a stable roadmap task and rollout threshold.
- The completed initial audit may conclude that no format has enough evidence;
  adapter enablement is evaluated separately under HD-081.

### HD-076 — Add the source-document adapter foundation [complete]

Route existing HTML, plain-text, and Markdown extraction through a
deterministic MIME-aware registry and preserve bounded format-appropriate
evidence locations in extraction metadata.

Acceptance criteria:

- Adapter IDs are stable and unique, selection order is deterministic, and an
  unmatched input produces an explicit unsupported result.
- Extraction results preserve adapter identity, structured failure reasons,
  stable content hashes, and heading or line-range evidence locations.
- Existing fetch limits, SSRF checks, persistence behavior, and
  discussion-only fallback remain intact.

### HD-077 — Add bounded public GitHub source support [gated by HD-081]

Implement repository README and curated source-file extraction only if HD-081
selects GitHub sources. Do not clone or traverse repositories. This task must
use bounded requests and preserve repository-relative paths and line/heading
evidence.

### HD-078 — Add bounded RSS and Atom support [gated by HD-081]

Implement hardened RSS/Atom parsing and deterministic entry selection only if
HD-081 selects feeds. Generic XML, sitemaps, recursive crawling, DTDs, external
entities, XInclude, and parser network access remain unsupported.

### HD-079 — Add bounded JSON Feed support [gated by HD-081]

Implement a named, versioned JSON Feed adapter only if HD-081 selects it.
Arbitrary JSON and unknown schemas remain unsupported, and embedded URLs must
not be followed.

## Milestone 6: Reading experience

### HD-059 — Define the visual system and responsive shell [complete]

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

### HD-060 — Build the digest-run page [complete]

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

### HD-063 — Add headless Playwright UI verification [complete]

Create browser tests for the responsive shell and critical reading flows. Run
them headlessly during local validation and CI, with artifacts retained on
failure.

Acceptance criteria:

- Tests cover the implemented latest-digest and operator flows, including
  loading, empty, partial, and failed-analysis states. Deferred story-history
  screens are tested when HD-061 is activated.
- Each critical flow is exercised at representative mobile and desktop viewport
  sizes, including a 320-pixel-wide viewport.
- Tests verify navigation and important keyboard interactions, and detect
  unexpected horizontal overflow.
- CI runs Playwright headlessly and retains screenshots, traces, and videos on
  failure without storing secrets or sensitive source content.
- Stable fixtures or seeded test data keep tests independent of live Hacker
  News and LLM APIs.

## Milestone 7: Quality, operations, and release

### HD-070 — Create a representative evaluation set [complete]

Save 30–50 legally appropriate fixtures spanning technical articles, opinion
pieces, text posts, inaccessible pages, long discussions, weak discussions, and
controversial threads.

Acceptance criteria:

- A rubric scores faithfulness, coverage, discussion synthesis, citation
  quality, concision, and usefulness.
- Fixtures contain no secrets and avoid storing unnecessary copyrighted text.
- Model and prompt changes can be compared against the same cases.

### HD-071 — Add observability and budget alerts [complete]

Track run duration, fetch/extraction failures, queue depth, LLM failures, cache
hit rate, token usage, and estimated spend.

Acceptance criteria:

- Daily and monthly soft limits generate alerts.
- Hard limits stop new LLM submissions while leaving collection and browsing
  functional.
- A failed scheduled run is visible without inspecting raw logs.

### HD-072 — Perform security and privacy review [complete]

Review SSRF protection, HTML sanitization, prompt injection boundaries,
operator authentication, secret handling, logs, and data retention.

Acceptance criteria:

- No endpoint exposes environment variables, credentials, or arbitrary files.
- Untrusted article/comment content cannot alter application instructions.
- Retention and deletion behavior are documented.

### HD-073 — Write deployment and recovery documentation [complete]

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

### HD-074 — Prepare the repository for public MIT release [complete]

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

Completion of HD-074 covers repository preparation, not the owner-controlled
visibility change itself.

### HD-080 — Configure and verify off-server production backups [active]

Choose an off-server backup destination and retention policy, configure
automated encrypted PostgreSQL backups for the production database, and prove
recovery in an isolated environment. Do not record credentials, private
hostnames, or backup object names in the repository.

Acceptance criteria:

- The destination, schedule, retention, encryption, and access-control policy
  are explicitly chosen and documented without secrets.
- A successful automated production backup is verified outside the Hetzner
  server.
- A selected backup is restored into an isolated PostgreSQL instance and the
  application schema and representative records are verified.
- The recurring restore-test cadence, alert path, and responsible operator are
  documented.
- Failure of the backup job is observable without relying only on transient
  container logs.

### HD-081 — Complete the extended source-adapter review [monitoring]

Extend the HD-075 production baseline to at least 30 varied digest runs and
repeat bounded, zero-LLM top-stories source discovery. Decide explicitly whether
any gated source adapter has enough recoverable value to justify implementation.

Acceptance criteria:

- The review covers at least 30 varied digest runs and reports both story
  occurrences and distinct stories so repetition cannot inflate demand.
- Acquisition outcomes are ranked by frequency, expected recovery, evidence
  fidelity, implementation effort, and security risk.
- Current top-stories discovery is used as supporting evidence, not as a
  substitute for observed production acquisition outcomes.
- Each selected adapter meets the 20% expected-recovery threshold and activates
  its existing stable task; otherwise HD-077 through HD-079 remain gated.
- The decision and evidence summary are recorded without source bodies or
  complete URLs.

## Current execution order

The MVP implementation path is complete. Remaining work should proceed as:

1. Complete HD-080 because a same-host volume is not disaster recovery.
2. Continue normal production runs until HD-081's evidence threshold is met.
3. Activate HD-077, HD-078, or HD-079 only if HD-081 selects them.
4. Perform the final repository visibility review and owner-controlled change
   when public release is desired.
5. Revisit deferred work only when measured need justifies a decision-log
   change.

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

- Off-server PostgreSQL backup destination, retention policy, and restore-test
  cadence for HD-080
- Whether and when to make the prepared repository public
- Whether HD-081 evidence justifies any of HD-077 through HD-079
- First post-MVP delivery channel if HD-062 is activated: email or RSS/Atom

## Resolved operating defaults

- Production collects 10 stories per run, subject to the configurable minimum
  of 10 HN comments per story.
- Scheduled runs occur at 7:00 AM and 7:00 PM in `America/New_York`.
- On-demand runs are available through both a bounded CLI and an HTTP
  Basic-protected operator surface.
- Article, comment, instruction, and output token allowances are typed runtime
  configuration and may be tuned operationally without reopening architecture.
- The production hostname is selected and stored privately in `APP_URL`.

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
| 2026-07-22 | Price the `gpt-5.6-luna` standard synchronous path at $1.00/M input, $0.10/M cached read, $1.25/M cache write, and $6.00/M output tokens through explicit production configuration. | These are the current published API rates; persisting the configured assumptions keeps historical cost calculations explainable if provider pricing changes. |
| 2026-07-22 | Evaluate analysis changes against 30 fixed synthetic cases with a weighted six-dimension rubric. | Synthetic CC0 fixtures keep comparison repeatable and legally safe; weighting faithfulness highest prevents aggregate quality gains from obscuring grounding regressions. |
| 2026-07-22 | Use UTC calendar windows for LLM daily/monthly budgets and persist deduplicated operational alerts. | UTC boundaries make enforcement reproducible alongside persisted timestamps; database alerts remain visible without relying on ephemeral process logs. |
| 2026-07-22 | License the source under MIT while keeping npm publication disabled and repository visibility owner-controlled. | Public source availability does not require publishing an npm package, and the final visibility change must follow a fresh security and history review. |
| 2026-07-22 | Expose on-demand runs through a bounded shell CLI and coalesce active runs in PostgreSQL. | Authenticated shell access avoids a new public operator endpoint, while a partial unique index prevents concurrent commands from duplicating collection or LLM spend. |
| 2026-07-22 | Add a private HTTP Basic-protected operator page alongside the CLI. | The private owner needs mobile/desktop access to failure diagnostics and bounded on-demand runs without introducing accounts or exposing an anonymous spend trigger. |
| 2026-07-22 | Rank digest stories directly from HN `topstories` without topical filtering. | The MVP should preserve Hacker News's current leading-story order; personalization and semantic topic ranking remain outside scope. |
| 2026-07-22 | Require at least 10 HN comments by default before selecting a story. | Very new stories often lack enough discussion to support useful synthesis; a configurable threshold keeps the gate tunable. |
| 2026-07-22 | Allow one spend-checked correction attempt when model output cites an HN comment outside the selected context. This terminal-failure policy was superseded later the same day. | A bounded retry can recover an otherwise useful analysis while preserving evidence validation; the later degraded-result policy retains valid work after that retry. |
| 2026-07-22 | Add bounded plain-text and Markdown extraction while keeping PDF and media sources discussion-only. | These text formats fit the existing SSRF and extraction-quality model; document and media parsing would add substantially different security and resource requirements. |
| 2026-07-22 | Introduce HD-075 through HD-079 for discussion-only source reduction, implementing only the shared adapter foundation before production measurements select additional formats. | Stable gated tasks preserve the plan's measurement requirement and avoid authorizing GitHub, feed, JSON Feed, PDF, OCR, or media work from intuition alone. |
| 2026-07-22 | After one citation-correction attempt, deterministically omit invalid discussion references instead of failing the story. | Preserving valid article analysis and grounded discussion claims gives readers a useful degraded result while never accepting invented comment IDs. |
| 2026-07-22 | Complete the initial HD-075 audit at 10 runs and 50 source occurrences while retaining 30 varied runs as the adapter-enablement gate. | This allows the production review workflow to be exercised now without treating repeated stories from one day as sufficient evidence to enable a new parser. |
| 2026-07-22 | Complete HD-075 without selecting an additional adapter and move the 30-run enablement review to HD-081. | The initial production baseline and a bounded scan of 500 current top stories found no unsupported format with enough distinct, eligible demand to justify implementation; a separate monitoring task keeps the completed audit distinct from future evidence collection. |
| 2026-07-22 | Make verified off-server backup recovery the next active operational task under HD-080. | Deployment documentation and an isolated restore procedure exist, but disaster recovery is incomplete until production backups leave the host and a retained backup is restored successfully. |
