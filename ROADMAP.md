# HN Digest roadmap

This roadmap contains only approved future work. Completed implementation
history is available in Git history. Unapproved possibilities belong in
`FUTURE_IDEAS.md`.

Task IDs are stable. Implement tasks in dependency order, keep changes scoped,
and record material architectural or product decisions in this file.

## Status

- **Planned:** approved but not started.
- **In progress:** currently being implemented.
- **Complete:** implemented and validated against its acceptance criteria.

## Milestone 1: Avoid repeated scheduled stories

### HD-090 — Skip stories covered by the previous scheduled run [complete]

When collecting a scheduled morning or evening digest, skip stories that were
included in the immediately preceding completed scheduled digest. Continue
through the ranked Hacker News candidates until the configured story count is
filled or no eligible candidates remain.

Acceptance criteria:

- Only scheduled runs participate; on-demand runs neither establish nor consume
  the previous-run exclusion set.
- The comparison uses the immediately preceding completed scheduled run across
  morning/evening boundaries, not merely the previous run of the same type.
- Stories are identified by stable HN item ID rather than title or URL.
- The baseline is the immediately preceding scheduled digest made available to
  readers; stories already published in a partial digest remain excluded, while
  a failed run with no published digest is ignored.
- Candidate ordering still follows the captured Hacker News ranking after
  excluded and otherwise ineligible stories are removed.
- If too few eligible stories exist, the run completes with the available
  stories and records the shortfall rather than reintroducing duplicates.
- Logs and operator diagnostics report exclusion counts and IDs without storing
  or logging article bodies.
- Tests cover consecutive morning/evening runs, intervening on-demand runs,
  failed and partial runs, insufficient candidates, and retry idempotency.

## Milestone 2: Subscription newsletter

The newsletter is a larger product surface and should be delivered in bounded
stages. Subscribers may choose the morning edition, evening edition, or both.
Newsletter work introduces subscriber personal data and an external email
provider, but does not introduce general-purpose user accounts.

### HD-100 — Design newsletter delivery and compliance boundaries [complete]

Dependencies: none.

Select the transactional/bulk email provider and document the subscription,
consent, confirmation, delivery, unsubscribe, suppression, retention, and
deletion lifecycle before collecting email addresses.

Acceptance criteria:

- The decision record covers provider choice, expected cost, sending limits,
  data location, webhook authentication, and failure behavior.
- Morning and evening preferences have an explicit data model and migration
  plan.
- Signup uses confirmed opt-in; unconfirmed addresses never receive digests.
- Consent evidence records the policy/version, source, and timestamps needed to
  explain the subscription without retaining unnecessary request data.
- Every message supports a clear unsubscribe path and standards-compatible
  list-unsubscribe behavior, including one-click unsubscribe where supported.
- The plan covers sender authentication and reputation controls, including SPF,
  DKIM, DMARC, bounce handling, complaint handling, and suppression.
- Retention, deletion, privacy disclosure, and applicable anti-spam/privacy
  obligations are documented and reviewed before launch.
- Secrets remain runtime configuration and are never exposed to the client,
  logs, repository, or email links.

### HD-101 — Implement subscriber and preference persistence [complete]

Dependencies: HD-100.

Add the minimal persistence required for confirmed subscriptions, morning and
evening preferences, confirmation state, unsubscribe state, consent evidence,
and provider suppression state.

Acceptance criteria:

- Email addresses are normalized consistently and protected as sensitive data.
- Repeated signup, confirmation, preference, and unsubscribe operations are
  idempotent.
- Opaque, purpose-specific, expiring tokens are used for confirmation and
  preference-management links; raw tokens are not persisted or logged.
- Public behavior does not reveal whether an email address is subscribed.
- Data constraints prevent duplicate active subscriber records and invalid
  preference states.
- Migrations and lifecycle behavior have automated tests.

### HD-102 — Build signup, confirmation, and unsubscribe flows [complete]

Dependencies: HD-101.

Provide accessible public forms and endpoints for selecting morning, evening,
or both editions; confirming the subscription; changing preferences; and
unsubscribing.

Acceptance criteria:

- Signup responses resist address enumeration and automated abuse.
- Confirmation is required before delivery begins.
- Subscribers can change edition preferences without creating an account.
- Unsubscribe is easy, takes effect promptly, and does not require login.
- Forms work at 320-pixel and desktop viewports with keyboard navigation,
  visible focus, clear validation, and useful success/error states.
- Rate limiting and CSRF protections cover state-changing public endpoints.
- Headless Playwright covers the complete lifecycle without contacting a live
  email provider.

### HD-103 — Render and send scheduled newsletter editions [complete]

Dependencies: HD-090, HD-100, HD-101, HD-102.

Render morning and evening newsletters from the same persisted digest data used
by the web application, and deliver each edition only to confirmed subscribers
who selected it.

Acceptance criteria:

- Sending starts only after the corresponding digest reaches its deliverable
  terminal state.
- Delivery is idempotent per subscriber and digest edition; retries cannot send
  the same edition twice.
- Morning-only, evening-only, and both-edition preferences are enforced.
- Email content preserves source provenance and links to the canonical digest,
  original article, HN discussion, and unsubscribe/preferences flow.
- HTML and plain-text alternatives are generated from the same stored data.
- Per-recipient failures do not abort unrelated deliveries; bounded retries and
  final outcomes are persisted.
- Provider calls, concurrency, and batch sizes are bounded and observable.
- Tests use a fake provider and contain no real subscriber data.

### HD-104 — Process delivery events and operate the newsletter [complete]

Dependencies: HD-103.

Authenticate and process provider delivery events, maintain suppression state,
and expose privacy-safe operator diagnostics.

Acceptance criteria:

- Webhook signatures are verified before processing and replayed events are
  idempotent.
- Hard bounces, complaints, and unsubscribes suppress future delivery promptly.
- Event payload retention is minimized and sensitive fields are not logged.
- Operator diagnostics show aggregate and per-delivery status without exposing
  subscriber lists through public routes.
- Alerts cover sustained send failures and provider rejection without leaking
  addresses or message bodies.
- A launch checklist verifies sender authentication, unsubscribe behavior,
  provider production access, privacy text, and end-to-end delivery.

### HD-105 — Complete newsletter launch safeguards [complete]

Dependencies: HD-104.

Close the operational gaps found during the production launch review before
public signup or scheduled delivery is enabled.

Acceptance criteria:

- Every provider request uses the monitored privacy mailbox as Reply-To.
- A public privacy notice documents collection, processing, retention,
  suppression, provider sharing, and subscriber rights.
- An idempotent background lifecycle job enforces the documented token,
  unconfirmed-subscriber, delivery-event, and unsubscribed-address retention
  periods.
- Private operator commands support verified subscriber export and deletion
  while preserving the keyed do-not-contact record.
- Automated tests cover Reply-To and destructive lifecycle boundaries, and the
  launch runbook identifies the commands and required evidence.

### HD-106 — Bound first-subscriber digest delivery [complete]

Dependencies: HD-103.

Allow a newly confirmed subscriber to receive the single most recent scheduled
digest as a welcome edition, without enqueueing the historical backlog.

Acceptance criteria:

- A subscriber with no prior delivery is eligible only for the most recent
  deliverable scheduled digest.
- After the first delivery is recorded, ordinary confirmed-at and edition
  eligibility apply to future digests.
- Tests cover a newly confirmed subscriber and an older deliverable run.
- Existing delivery idempotency, edition preferences, and retries are
  unchanged.

### HD-107 — Deliver the latest pre-launch scheduled digest [complete]

Dependencies: HD-106.

Allow the first controlled production subscriber to receive the most recent
completed scheduled digest when that run predates the newsletter-ready marker.

Acceptance criteria:

- Completed or partial scheduled runs fall back to their update time only when
  the newsletter-ready timestamp is absent.
- First-delivery backlog bounding and subsequent forward-only delivery use the
  same effective readiness timestamp.
- Integration coverage exercises the legacy null-marker path.

### HD-108 — Match newsletter editions to the editorial digest [complete]

Dependencies: HD-103, HD-104, HD-107.

Bring the HTML newsletter closer to the web digest while retaining broad email
client compatibility, and support deliberate operator-controlled reissues
without deleting delivery history or reusing provider idempotency keys.

Acceptance criteria:

- Each analyzed story renders distinct Article, Discussion, and The takeaway
  sections from the same persisted analysis used by the web application.
- Email-safe HTML provides restrained editorial hierarchy, metadata, source
  provenance, responsive behavior, and a complete plain-text alternative.
- Reissues create a new, auditable delivery sequence while ordinary worker
  polling remains idempotent for each subscriber, digest, and sequence.
- Tests cover rendered analysis content, escaping, fallback content, and a
  worker-claimed reissue.

### HD-109 — Refine newsletter takeaway reading rhythm [complete]

Dependencies: HD-108.

Reduce the visual weight of newsletter takeaways and share the web digest's
bounded paragraphing behavior for long summaries.

Acceptance criteria:

- Newsletter takeaways use body-scale typography suitable for narrow mobile
  email clients.
- Explicit author paragraphs are preserved, while only sufficiently long
  multi-sentence summaries are split into balanced paragraphs.
- HTML and plain-text alternatives use the same paragraph boundaries.
- Tests cover short, explicit, and automatically balanced takeaways.

## Milestone 3: Public digest API

### HD-110 — Expose a rate-limited public digest API [complete]

Dependencies: none.

Expose a read-only API that returns a morning or evening digest for a requested
date. No API token is required. Requests are limited by client IP address to 10
per minute.

Acceptance criteria:

- A versioned endpoint accepts an ISO calendar date and an explicit `morning`
  or `evening` edition.
- Date interpretation follows the configured digest timezone, while persisted
  timestamps and response timestamps remain UTC/ISO 8601.
- The maximum retrievable age is typed configuration with a 30-day default;
  requests outside the window receive a stable non-success response without
  revealing internal storage details.
- Only completed, publicly renderable digest data and source/evidence links are
  returned; operator diagnostics, subscriber data, prompts, raw source bodies,
  and internal errors are excluded.
- The response has a versioned, documented schema and deterministic ordering.
- Missing dates, invalid editions, invalid dates, future dates, and unavailable
  or partial digests have documented status and error bodies.
- Each trusted client IP is limited to 10 requests in a rolling or fixed
  one-minute window, with standard rate-limit response headers and HTTP 429 on
  exhaustion.
- Client IP derivation trusts forwarded headers only from explicitly configured
  reverse proxies; callers cannot bypass limits by supplying arbitrary
  forwarding headers.
- The limiter behaves correctly across all production application processes
  and fails safely if its shared state is unavailable.
- Responses use bounded caching appropriate to immutable historical digests
  without allowing caching to bypass rate-limit accounting.
- Unit, integration, and abuse-case tests cover schema output, age boundaries,
  timezone boundaries, rate limits, spoofed forwarding headers, and accidental
  sensitive-field exposure.

## Milestone 5: Editorial voice

### HD-112 — Apply full-mode Unslop to reader-facing prose [complete]

Dependencies: none.

Remove generic LLM phrasing from generated digest analysis and public website
copy without weakening source grounding, factual accuracy, or the single-call
analysis architecture.

Acceptance criteria:

- The versioned analysis prompt includes the full-mode Unslop rules: strong
  restructuring, varied cadence, concrete language, and removal of stock model
  phrasing.
- The style pass remains part of the existing structured request. It adds no
  second provider call, retry loop, new model, or unmetered spend path.
- Facts, quotations, confidence, citations, HN comment IDs, source boundaries,
  technical terms, and genuine uncertainty take priority over style.
- The prompt version changes so cached earlier analyses remain identifiable and
  new work uses the revised editorial instructions.
- Existing public-facing page copy receives a full-mode pass. Legal, privacy,
  security, accessibility, and destructive-action text stays literal where the
  skill's Auto-Clarity rule calls for it.
- Repository agent instructions require the same full-mode review whenever
  public-facing page text is added or edited during development.
- Automated tests pin the prompt's grounding and Unslop requirements, and the
  relevant mobile and desktop Playwright checks pass after the copy changes.

## Milestone 6: Digest reading experience and source coverage

These tasks address reader-facing repetition, historical access, incomplete
rendering, and source coverage in the digest experience. They apply to the web
digest unless an acceptance criterion explicitly calls out another surface.

### HD-113 — Consolidate repeated story analysis sections [complete]

Reduce repetition between Article, Discussion, and The takeaway by replacing
the current three-section presentation with a concise one-line story summary
and a separate takeaway. Preserve discussion evidence and source provenance in
the resulting story view.

Acceptance criteria:

- Each story presents one clearly labeled, one-line summary followed by one
  clearly labeled takeaway.
- The new presentation does not restate the same claim across multiple
  sections merely because it came from different analysis fields.
- Supporting discussion evidence, HN comment links/IDs, article provenance,
  confidence or limitation states, and the original-source link remain
  available and distinguishable.
- Stored analysis data and API compatibility are handled deliberately; no
  source-grounding information is discarded solely to simplify the UI.
- The web digest, public API documentation, and newsletter rendering are
  updated consistently, or any intentionally different representation is
  documented.
- Headless Playwright covers the revised story hierarchy at 320-pixel and
  desktop viewports, including keyboard access and no horizontal overflow.

### HD-114 — Show original-source URL and media type [complete]

Make the Read Original action more informative by displaying the normalized
source URL and the classified media type beside it.

Acceptance criteria:

- Read Original remains a usable, accessible link to the validated original
  source.
- The displayed URL is the stored, normalized source URL and is visibly
  truncated or wrapped safely without causing horizontal overflow.
- The UI displays the source classification, including at least site and PDF
  where those classifications are supported by ingestion.
- The classification is derived from trusted application metadata rather than
  arbitrary source-provided display text.
- Missing, inaccessible, or discussion-only sources receive an explicit
  state instead of a misleading media type or link.
- Tests cover normal URLs, long URLs, PDF sources, unavailable sources, and
  mobile/keyboard rendering.

### HD-115 — Add a morning/evening digest archive [complete]

Provide a browsable backlog of previously created scheduled digests, with
morning and evening editions available as distinct entries.

Dependencies: HD-110.

Acceptance criteria:

- Readers can browse completed scheduled digests by local calendar date and
  morning/evening edition using the configured `America/New_York` timezone.
- Archive entries link to canonical digest pages and preserve deterministic
  ordering, stable URLs, and the digest's published status.
- On-demand runs are not presented as morning or evening editions unless the
  data explicitly identifies them as scheduled runs.
- Missing, partial, failed, and future editions have deliberate non-success or
  empty states and do not expose internal diagnostics or source bodies.
- The archive works at 320-pixel and desktop viewports, supports keyboard
  navigation, and does not introduce horizontal overflow.
- Tests cover timezone/DST boundaries, morning/evening filtering, pagination or
  bounded history, unavailable editions, canonical navigation, and seeded
  deterministic data.

### HD-116 — Prevent truncated digest story output [complete]

Find and fix the pipeline or rendering conditions that can cut off a story's
text, including output that ends mid-sentence or with dangling punctuation.

Acceptance criteria:

- Article summaries, discussion synthesis, takeaways, and the consolidated
  summary fields are rendered from complete persisted values without silent
  client-side or server-side truncation.
- Generation and persistence distinguish a complete response from a provider
  response that stopped at an output limit, transport failure, or malformed
  boundary.
- A bounded retry or explicit incomplete state is used when completeness
  cannot be established; incomplete prose is never presented as a complete
  digest story.
- Regression coverage includes the current class of dangling-comma or
  mid-sentence endings and long outputs near configured limits.
- Existing token, spend, retry, and source-grounding controls remain enforced.

### HD-117 — Retry stories with invalid discussion citations [complete]

Treat invalid HN comment citations as a retryable story-analysis failure. A
successful response that omits the discussion synthesis because citations were
invalid is not an acceptable terminal outcome.

Acceptance criteria:

- Citation validation runs before an analysis is accepted for persistence or
  publication.
- Invalid comment citations trigger the existing bounded retry policy, with
  retry diagnostics recording safe IDs, attempt counts, and classified failure
  reasons only.
- A response with an omitted or invalidly cited discussion synthesis cannot be
  silently downgraded into a successful story analysis.
- If bounded retries are exhausted, the story receives an explicit failed or
  incomplete state that the digest UI can represent safely; it is not rendered
  with the unacceptable invalid-citation message as though analysis succeeded.
- Tests cover invalid citations on the first response, recovery on a later
  response, exhausted retries, idempotency, and spend-limit enforcement.

### HD-118 — Improve summary coverage for all supported link types [complete]

Eliminate avoidable “No article summary was available” outcomes by expanding
bounded extraction and fallback handling for every supported source type. Use
an Internet Archive or equivalent archived copy only when it is permitted,
available, and passes the same source-safety controls.

Acceptance criteria:

- The supported link-type matrix is documented and each type has a tested
  extraction path, fallback path, or explicit discussion-only/inaccessible
  state.
- HTML sites, PDFs, GitHub README/files, RSS/Atom-selected entries, redirects,
  and other currently supported inputs are covered without bypassing paywalls,
  access controls, or robots/security boundaries.
- Archive fallback is bounded by timeout, redirect, response-size,
  content-type, concurrency, and public-destination SSRF controls, and never
  exposes credentials or arbitrary fetched content through the application.
- Extraction failures preserve a classified, user-safe reason and source
  provenance; they do not invent an article summary.
- Tests use reviewed fixtures for each supported class, including archive
  success, archive failure, malformed content, oversized content, and blocked
  destinations. No live internet or LLM calls are required.
- The roadmap decision log records the final archive provider, legal/security
  boundaries, retention behavior, and cost/rate limits before implementation.

### HD-119 — Simplify the latest-edition heading [complete]

Remove the repetitive “What Hacker News Is Talking About” heading and use
“Latest Edition” as the primary page heading at the existing heading location.

Acceptance criteria:

- “Latest Edition” is the page's single primary `h1` for the latest digest view.
- The removed heading is not repeated in visible page copy, accessible names,
  metadata, or redundant landmark labels.
- Typography gives “Latest Edition” the intended prominent treatment while
  preserving the established editorial design tokens and responsive behavior.
- Tests cover the heading text, document outline, mobile and desktop layout,
  visible focus, and no horizontal overflow.

### HD-120 — Change scheduled digest times to 8 AM and 5 PM ET [planned]

Update the default scheduled editions from the current morning/evening times to
8:00 AM and 5:00 PM in the `America/New_York` timezone.

Acceptance criteria:

- The morning edition is scheduled for 8:00 AM and the evening edition for
  5:00 PM in `America/New_York`.
- Schedule calculation uses the named IANA timezone and persists execution
  timestamps in UTC, including correct EST/EDT transitions.
- The configured schedule is shared consistently by the scheduler, digest
  edition labels, archive behavior, API date interpretation, and newsletter
  delivery eligibility.
- Existing idempotency, retry, previous-scheduled-run exclusion, and missed-run
  behavior remain unchanged.
- Tests cover both editions, timezone boundaries, DST transitions, duplicate
  prevention, and the changed default configuration.

### HD-121 — Add commenter previews to discussion evidence links [planned]

Replace numeric HN comment-ID link text with the commenter's username and add
an unobtrusive preview on hover or keyboard focus showing the cited comment and
its score.

Acceptance criteria:

- Each cited-comment link displays the username associated with that HN
  comment, with a safe fallback when the commenter is deleted or unavailable.
- Hover and keyboard focus expose a small, readable preview containing the
  comment text, score, and a direct link to the original HN comment.
- Preview content is sourced from validated stored comment data and is escaped;
  it never renders arbitrary HTML or source-provided markup.
- The preview is usable with keyboard, touch, and assistive technology, does
  not depend on hover alone, and closes or moves predictably without trapping
  focus.
- Long comments are bounded and visually scrollable or clipped with an
  accessible indication; previews do not cause horizontal overflow at 320
  pixels.
- Missing comment data preserves a useful citation link and displays an
  explicit unavailable state rather than fabricated author or score data.
- Headless Playwright and unit tests cover hover, focus, escape/blur behavior,
  deleted users, long comments, safe rendering, mobile layout, and direct HN
  links.

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-23 | Reset the post-MVP roadmap to HD-090, the HD-100 newsletter series, and HD-110. | The next product priorities are avoiding consecutive scheduled-story repetition, adding opt-in morning/evening newsletter delivery, and exposing bounded public digest access. |
| 2026-07-23 | Complete HD-090 by excluding HN item IDs from the most recent earlier published scheduled digest. | Ordering by the scheduled slot makes retries deterministic; complete and partial published digests establish the baseline, while failed and on-demand runs do not. Persisting encountered exclusions gives operators an auditable count and ID list without retaining source content. |
| 2026-07-23 | Complete HD-100 with Resend as the initial newsletter delivery provider while PostgreSQL remains authoritative for subscribers and consent. | Resend provides signed replay-safe webhooks, send idempotency, custom one-click unsubscribe headers, suppression, and bounded entry pricing without adding AWS operational resources. Subscriber truth stays local, tracking stays disabled, provider storage is explicitly US-based and limited to its documented retention, and production remains gated on the recorded compliance and deliverability review. |
| 2026-07-23 | Complete HD-101 with encrypted subscriber addresses, keyed lookup digests, and database-backed consent and action-token lifecycles. | AES-256-GCM keeps recoverable addresses authenticated and opaque at rest, separate versioned HMAC material supports uniqueness and token lookup without plaintext indexes, and PostgreSQL constraints plus per-address transaction locks make preference state and repeated lifecycle operations durable and idempotent. |
| 2026-07-23 | Complete HD-102 with launch-gated public forms, Resend confirmation messages, same-origin mutation checks, and PostgreSQL-backed address/client throttling. | Generic signup outcomes resist subscriber enumeration, only confirmed tokens activate delivery, scoped preference tokens permit edition changes or unsubscribe without accounts, and direct database token seeding lets Playwright verify the complete mobile/desktop lifecycle without exposing test tokens through HTTP or contacting Resend. |
| 2026-07-23 | Complete HD-104 with signed minimized Resend events, local suppression authority, and private delivery diagnostics. | Raw-body Svix verification and unique provider event IDs make at-least-once, out-of-order webhooks safe; hard bounces, complaints, provider suppressions, and unsubscribe events immediately block future sends without retaining payload addresses or content. Internal delivery IDs support diagnostics and alerts, while production remains gated on the owner-recorded launch checklist. |
| 2026-07-23 | Complete HD-110 with a versioned completed-edition API and PostgreSQL fixed-window limiting. | Named-zone schedule lookup keeps morning/evening dates correct across DST, explicit response mapping excludes internal and subscriber state, and a database-backed HMAC identity bucket enforces limits across processes before cache lookup. Forwarded addresses are accepted only behind configured proxy CIDRs; missing trust context collapses to a fail-safe shared bucket. |
| 2026-07-23 | Complete HD-112 by applying full-mode Unslop rules within the existing structured analysis prompt and to public page copy. | Keeping the editorial pass in the one bounded request improves voice without adding a model stage or bypassing cost controls. A new prompt version makes cache behavior explicit, while grounding rules and Auto-Clarity preserve facts, citations, legal meaning, and safety-critical wording. |
| 2026-08-07 | Extend HD-041 so invalid HN comment citations are degraded on the first successful structured response instead of waiting for a retry. | An invalid reference is a recoverable discussion-quality defect; removing only ungrounded discussion evidence preserves a useful digest item when a later retry would otherwise fail or be unavailable. |
| 2026-08-07 | Extend HD-041 so provider responses that fail local structured-output validation are retryable within the existing bounded LLM retry budget. | OpenRouter can occasionally return malformed or schema-invalid JSON despite requesting strict output; retrying transient generation defects avoids failing a story on the first response while preserving strict validation and spend bounds. |
| 2026-08-18 | Replace the HD-041 invalid-citation degradation behavior with the HD-117 retry requirement. | Discussion synthesis without valid supporting HN comment citations is not an acceptable successful story outcome. Retries must remain bounded by the existing spend and attempt controls; exhausted retries produce an explicit incomplete or failed state. |
| 2026-08-18 | Approve HD-113 through HD-119 as the next digest experience and source-coverage work. | Reader feedback identifies repeated analysis, missing source context, lack of scheduled-edition history, truncated output, insufficient citation recovery, incomplete link coverage, and redundant page hierarchy as release-quality issues. |
| 2026-08-18 | Approve HD-120 to move scheduled editions to 8:00 AM and 5:00 PM `America/New_York` time. | The morning and evening digest cadence should match the desired reader schedule while retaining named-zone calculation and UTC persistence across EST/EDT changes. |
| 2026-08-18 | Approve HD-121 to make discussion evidence links human-readable and previewable. | Usernames are more useful than opaque comment IDs while hover/focus previews can expose comment text and score without making each story card substantially longer. The original HN link remains available for provenance. |
| 2026-08-18 | Complete HD-114 by deriving source labels from persisted document metadata and rendering normalized URLs with explicit unavailable and discussion-only states. | Readers can identify the original source and its trusted classification without confusing failed extraction with a usable article or exposing arbitrary source-provided display text. |
| 2026-08-18 | Complete HD-115 with bounded scheduled-run archive pages keyed by local date and edition. | The archive reuses persisted digest data, excludes on-demand and failed/future runs, preserves partial status, and keeps historical links stable without adding a second source of truth. |
| 2026-08-18 | Complete HD-116 by rejecting provider-incomplete responses and valid structured results with dangling prose boundaries before persistence. | Provider finish state remains explicit, boundary validation prevents mid-sentence text from becoming a published analysis, and the reader exposes an incomplete state rather than presenting it as complete. |
| 2026-08-18 | Complete HD-118 with a reviewed source-coverage matrix and an opt-in archive fallback boundary. | Every currently classified source has a tested extraction path or a deliberate discussion-only state; archive retrieval remains disabled by default until its legal, retention, provider-cost, and operator policy review is complete. |
| 2026-08-18 | Revise HD-118 archive handling to an opt-in Internet Archive Wayback fallback. | The fallback is disabled by default, bounded by the primary fetcher, never used for access-restricted sources, and preserves original-source provenance; operators must explicitly review policy before enabling it. |
| 2026-08-18 | Complete HD-119 by making “Latest Edition” the homepage’s single primary heading. | The newsletter signup remains a secondary section heading, removing the old repeated digest title while preserving the established layout and mobile hierarchy. |
