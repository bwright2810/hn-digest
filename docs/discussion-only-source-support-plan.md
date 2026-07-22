# Discussion-only source support plan

## Purpose

Reduce the share of Hacker News stories that receive discussion-only analysis
by adding deterministic, source-grounded adapters for valuable unsupported
formats. Discussion-only analysis remains the safe terminal fallback whenever a
source is inaccessible, unsupported, malformed, unsafe, or too low quality.

This plan follows HD-058 but does not itself authorize deferred work. Before
implementation begins, add selected work to `ROADMAP.md` under new stable
`HD-###` task IDs and record any change to the PDF, OCR, media-transcription, or
model-call decisions in the decision log.

Implementation tracking: HD-075 owns the production baseline, HD-076 owns the
shared adapter and evidence-location foundation, and HD-077 through HD-079 are
the gated GitHub, RSS/Atom, and JSON Feed workstreams. No additional format is
selected until HD-075 passes. PDF, OCR, and media processing remain deferred.

## Goals

- Prioritize formats using production frequency and expected analysis value.
- Reuse the existing bounded fetcher, SSRF defenses, persistence contract, and
  discussion-only fallback.
- Preserve evidence locations appropriate to each format.
- Keep parsing deterministic and local unless the roadmap explicitly approves
  a new external or model-backed stage.
- Demonstrate a measurable reduction in discussion-only outcomes without
  weakening safety or extraction quality.

## Non-goals

- Bypassing paywalls, authentication, robots controls, or access restrictions.
- General web crawling or recursively traversing repositories and feeds.
- Executing source documents, scripts, macros, or embedded content.
- Generic ingestion of arbitrary JSON, XML, archives, or binary files.
- OCR, audio/video transcription, or additional LLM calls in the first phase.

## Phase 0: measure and choose

Run the HD-058 source-acquisition metrics over at least 10 scheduled or
on-demand digest runs and 50 story occurrences for the initial audit. Before
enabling any adapter, extend the review to at least 30 runs with enough elapsed
time to include varied HN sources.
Review only aggregate source type, normalized content type, outcome, count, and
story discussion depth. Do not export source bodies or complete URLs.

For each candidate format, estimate:

- occurrence count and share of discussion-only stories;
- median HN comment count and rank;
- expected percentage of sources yielding useful article text;
- implementation and ongoing maintenance effort;
- security, memory, CPU, and network risk; and
- evidence fidelity available from the format.

Rank candidates with a documented score. A format should enter implementation
only if it is seen in production or a reviewed historical fixture sample and is
expected to recover meaningful article context for at least 20% of its
discussion-only occurrences. Record the selected formats and their stable task
IDs in the roadmap.

## Shared adapter foundation

Build a format-adapter registry after bounded fetching and MIME/signature
validation. An adapter accepts fetched bytes plus safe fetch metadata and
returns the existing normalized document shape, extended only where needed with
format-specific evidence locations.

Every adapter must provide:

- an explicit supported MIME/signature allowlist;
- byte, time, redirect, and parser-resource limits;
- a normalized title, text, structure, and stable content hash;
- a quality status of extracted, low confidence, or empty;
- structured confidence/failure reasons;
- evidence locations such as page, section, entry, or file path;
- no active content, remote subresource fetches, or recursive traversal; and
- an explicit discussion-only result for every unsupported or failed case.

Adapters must not log document bodies, prompts, credentials, sensitive headers,
or complete source URLs. Metrics should use bounded enumerations so hostile
metadata cannot create high-cardinality labels.

## Candidate workstreams

### 1. Public GitHub repositories and source files

Treat this as the likely first adapter after measurement because repositories,
README files, and source links are common on Hacker News and are already mostly
textual.

Scope:

- Recognize public GitHub repository, blob, and raw-file URLs without accepting
  arbitrary Git hosts initially.
- For a repository, fetch only its default README and bounded public metadata
  through the authenticated API gateway or an approved public fetch path.
- For a blob/raw URL, allow a curated set of text extensions and validate the
  returned content type and bytes.
- Preserve repository-relative file path and heading/line ranges as evidence.
- Do not clone repositories, enumerate trees, resolve submodules, or fetch
  releases and archives.

Acceptance criteria:

- Repository and file fixtures cover redirects, missing README files, large
  files, binary masquerading as text, rate limits, and private repositories.
- The adapter makes a bounded number of requests and never exposes gateway
  credentials or response headers.
- Unsupported repository states remain discussion-only.

### 2. RSS, Atom, and narrowly supported XML

Support feeds only when they contain a readable entry relevant to the submitted
URL or when the HN link intentionally targets one feed document.

Scope:

- Allow RSS and Atom MIME types and verify the root element before parsing.
- Disable DTDs, external entities, XInclude, and network access from the parser.
- Bound element count, nesting depth, text size, and entry count.
- Select a matching entry deterministically; do not crawl item links.
- Preserve feed title, entry title, publication time, and entry identifier.

Acceptance criteria:

- XXE, entity expansion, deep nesting, malformed XML, and oversized-feed
  fixtures fail safely.
- Entry selection is deterministic and covered by fixtures.
- Generic XML and sitemaps remain discussion-only.

### 3. Structured article JSON

Do not support arbitrary JSON. Limit the first implementation to a named,
versioned schema with clear article semantics, such as JSON Feed.

Scope:

- Validate content type, UTF-8, maximum nesting depth, collection size, and the
  complete supported schema before extraction.
- Select one relevant item deterministically.
- Convert only documented title, author, date, summary, and content fields.
- Preserve item identifiers and avoid following embedded URLs.

Acceptance criteria:

- Unknown schemas, API payloads, excessive nesting, and large arrays remain
  discussion-only.
- HTML-bearing fields pass through the existing sanitizer before normalization.

### 4. PDF documents

PDF extraction is currently deferred. Start only after roadmap and decision-log
approval informed by Phase 0 measurements.

Initial scope:

- Text-layer PDFs only; no OCR.
- Verify both MIME type and PDF signature.
- Run parsing in an isolated process with hard wall-clock, memory, page-count,
  decompressed-size, and output-size limits.
- Reject encrypted, malformed, portfolio, attachment-bearing, JavaScript, and
  scanned-only documents explicitly.
- Preserve page numbers and headings where reliably recoverable.
- Never fetch links, fonts, media, or other remote resources referenced by a
  document.

Acceptance criteria:

- Reviewed fixtures include papers, reports, multi-column pages, encrypted
  files, malformed cross-reference tables, decompression bombs, embedded
  scripts, and image-only scans.
- Extracted claims can retain page-level evidence references.
- Parser crashes and limit violations are isolated and produce discussion-only
  outcomes without terminating the worker.
- Peak resource use fits the production host's documented limits under the
  configured worker concurrency.

### 5. Access-restricted HTML metadata

This workstream may improve context but must never imply that the article was
accessed.

Scope:

- Use only publicly returned title, description, Open Graph, and validated
  JSON-LD article metadata from the access response when policy and response
  content permit it.
- Store it as limited metadata context, visibly distinct from extracted article
  text.
- Require a minimum quality threshold; boilerplate login/paywall text is not
  article evidence.

Acceptance criteria:

- The analysis and UI clearly label metadata-only context.
- No retry strategy attempts to evade the restriction through alternate hosts,
  caches, user agents, or credentials.

### 6. Images, audio, and video

Keep these discussion-only during the initial expansion. Reconsider them only
if metrics demonstrate substantial value.

Preferred future order:

1. Publisher-supplied captions, transcripts, or show notes that can be fetched
   as bounded text.
2. Image OCR with strict dimensions, pixel count, format, memory, and time
   limits.
3. Media transcription only after a separate cost, storage, privacy, and
   processing architecture review.

Any model-backed vision or transcription stage requires a roadmap decision,
separate token/spend controls, persisted usage, cache keys, and evaluation-set
evidence. It must not silently add an unbounded second model request per story.

## Testing strategy

For each approved adapter:

- Add synthetic or redistribution-safe positive, low-confidence, malformed,
  adversarial, and oversized fixtures.
- Test MIME/signature mismatches and binary content mislabeled as text.
- Re-run SSRF and redirect tests at adapter boundaries.
- Test deterministic normalization and stable hashes.
- Test evidence-location preservation.
- Test persistence and pipeline behavior for extracted, low-confidence, empty,
  and discussion-only outcomes.
- Add a fixed evaluation case proving that article and commenter claims remain
  distinguishable.
- Run the repository formatting, linting, type-checking, unit/integration tests,
  and production build before completing each stable task.

No test should depend on a live third-party source. Any authenticated API adapter
must use mocked gateway responses in tests and the Sprite API gateway in manual
development checks.

## Rollout and observability

Ship one adapter at a time behind typed configuration, disabled by default in
production until its fixture suite and resource limits pass. Roll out to a small
bounded share of eligible stories, then compare against the pre-rollout
baseline.

Track:

- eligible, attempted, extracted, low-confidence, and failed counts;
- discussion-only recovery rate by coarse source type;
- failure reason and parser-limit counts;
- extraction duration and peak isolated-process memory where applicable;
- normalized character/token yield; and
- downstream schema-validation and citation failures.

Promote an adapter to the default only when it has no unresolved safety defects,
its resource use fits production limits, and it either recovers at least 50% of
eligible sources or provides enough high-value coverage to justify a documented
exception. Roll back by disabling the adapter; previously unsupported sources
must immediately return to discussion-only behavior.

## Proposed sequence

1. Collect and review the Phase 0 production baseline.
2. Add stable roadmap task IDs and decision-log entries for selected formats.
3. Implement the shared adapter registry and evidence-location contract.
4. Implement GitHub README/source support if confirmed by the baseline.
5. Implement RSS/Atom and then JSON Feed support if justified.
6. Run a PDF feasibility spike and security/resource review if PDF frequency
   warrants roadmap approval.
7. Implement text-layer PDF extraction only after the feasibility gate passes.
8. Reassess metadata-only restricted pages and transcript discovery.
9. Reconsider OCR or transcription only from measured demand and a separate
   architectural decision.

## Completion criteria

The expansion is complete when all selected roadmap tasks pass their acceptance
criteria, the enabled adapters meet rollout thresholds, operational metrics show
the intended reduction in discussion-only outcomes, and every unsupported or
failed source still produces a safe, explicit discussion-only analysis rather
than failing the story.
