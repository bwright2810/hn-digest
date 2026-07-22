# Security and privacy review

This document records the HD-072 review performed on 2026-07-22. It describes
the private-MVP boundary and must be revisited when a write-capable HTTP route,
operator control, new source type, or new external integration is introduced.

## Exposed surface and operator access

The application currently exposes only the read-only digest page and
`GET /api/health`, whose fixed response is `{ "status": "ok" }`. There is no
HTTP route for triggering runs, inspecting configuration, reading files,
viewing prompts or source documents, managing jobs, or deleting data. Scheduled
work and workers are internal processes. On-demand collection is available only
through the bounded `digest:run` CLI to an operator with authenticated shell
access. Consequently there is no operator HTTP authentication surface in the
private MVP.

Do not add an operator or on-demand route without authentication and
authorization appropriate to the deployment. A reverse-proxy network
restriction alone is not authorization. Any future state-changing route also
requires CSRF protection where cookie credentials are used, an audit trail, and
bounded request inputs. The public reader must never serialize server
configuration, request headers, source bodies, prompts, or error causes.

All application responses set a restrictive baseline Content Security Policy,
deny framing, disable MIME sniffing, limit referrer detail, and disable unused
camera, location, and microphone features. The policy permits inline scripts
and styles because the current Next.js runtime requires them; removing those
allowances requires a nonce-based Next.js integration and should be evaluated
before user-authored HTML is ever rendered.

## Source acquisition and rendering

Articles, HN items, and comments are untrusted.

- The article fetcher accepts only HTTP(S), rejects URL credentials, resolves
  every hostname, and rejects any destination with a non-public address. It
  repeats validation before every manually followed redirect and bounds total
  time, redirect count, response bytes, and supported content types.
- DNS validation followed by a separate connection still leaves a DNS-rebinding
  interval. Keep outbound network controls enabled in production. A future
  fetch implementation should pin the validated address to the connection if
  the runtime makes that possible without weakening TLS hostname validation.
- HN story and job URLs are accepted only when they use HTTP(S), preventing
  executable or local URL schemes from reaching rendered links.
- HN HTML is converted to normalized plain text. Links lose their destinations,
  images and scripts are discarded, and no source HTML is rendered. React
  escapes story titles, authors, analyses, and failure codes. The application
  does not use `dangerouslySetInnerHTML`.
- PDF, unsupported media, inaccessible pages, and extraction failures use
  explicit non-article states; the fetcher does not bypass access restrictions.

## Model boundary and logs

Application safety instructions and the output schema are sent separately from
JSON-encoded article and comment data. Each source envelope is labeled
untrusted and the instructions explicitly prohibit following source-provided
instructions. Structured model output is schema-validated before persistence
or rendering. Model requests use `store: false`, explicit token budgets,
bounded retries, and spend gates.

Model-client logs contain classified metadata such as attempt, model, token
estimate, outcome, response ID, status, and provider request ID. They do not
contain API keys, database URLs, request bodies, source text, prompts, full
provider responses, or supplied configuration values. Preserve this allow-list
approach for new logs; do not log arbitrary errors or configuration objects.

Secrets are runtime-only values. `.env.example` contains placeholders, local
environment files are ignored, production values must be injected by Coolify,
and configuration errors report variable names and constraints without values.
The OpenAI key and database URL must remain server-only.

The production dependency audit completed on 2026-07-22 with no known
vulnerabilities after pinning patched `sharp` and `postcss` transitive versions.
The repository credential-pattern scan found only explicit fixture/CI database
credentials used for isolated tests. Dependency and secret scans are a
point-in-time result and must be repeated before deployment and public release.

## Data retained and deletion behavior

The private MVP has no automatic age-based deletion. PostgreSQL retains HN
story snapshots, normalized comment text, extracted article text, analysis
results, job metadata, token usage, costs, cache records, and operational alerts
until an operator deliberately deletes them or the database is destroyed.
Fetched HTML bodies and complete model request payloads are not persisted.
OpenAI requests opt out of provider storage with `store: false`; provider-side
abuse-monitoring retention remains governed by the account's OpenAI data
controls.

Deletion is currently an operator database-maintenance action, not a web
endpoint. Deleting a digest run cascades through its snapshots, run-story
records, analysis jobs, analyses, attempts, usage, reservations, and associated
cache references according to the schema, but shared story, comment, and
document records remain for reuse. Deleting a story removes its comments,
documents, snapshots, and dependent run/analysis records. Before deletion,
inspect the target IDs, take any backup required by the recovery policy, run the
operation in a transaction, and verify affected-row counts. Backups retain
deleted records until their separately defined expiration; backup retention and
restore procedures belong to HD-073.

There is no user-account or personalization data. HN usernames and public
comments are nevertheless retained as public pseudonymous data. Requests to
remove stored source material require an operator to identify the relevant HN
story/item IDs and perform the scoped deletion above. Document and automate a
retention schedule before the service audience or collected data materially
expands.

## Review checklist for future changes

- Re-run SSRF tests for each new fetch or redirect path, including IPv4, IPv6,
  alternate numeric forms, mixed DNS answers, timeouts, and oversized streams.
- Keep all source content as data and schema-validate all generated output.
- Render plain text by default; sanitize with an explicit allow-list if rich
  HTML becomes a product requirement.
- Authenticate and authorize every operator action before exposing it over
  HTTP, and test that unauthenticated requests fail closed.
- Search endpoints, logs, build output, fixtures, Git history, and browser
  artifacts for secrets and unnecessarily complete source material.
- Review retention, deletion cascades, backups, and provider data controls when
  adding a data category or integration.
