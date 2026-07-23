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

### HD-103 — Render and send scheduled newsletter editions [planned]

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

### HD-104 — Process delivery events and operate the newsletter [planned]

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

## Milestone 3: Public digest API

### HD-110 — Expose a rate-limited public digest API [planned]

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

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-23 | Reset the post-MVP roadmap to HD-090, the HD-100 newsletter series, and HD-110. | The next product priorities are avoiding consecutive scheduled-story repetition, adding opt-in morning/evening newsletter delivery, and exposing bounded public digest access. |
| 2026-07-23 | Complete HD-090 by excluding HN item IDs from the most recent earlier published scheduled digest. | Ordering by the scheduled slot makes retries deterministic; complete and partial published digests establish the baseline, while failed and on-demand runs do not. Persisting encountered exclusions gives operators an auditable count and ID list without retaining source content. |
| 2026-07-23 | Complete HD-100 with Resend as the initial newsletter delivery provider while PostgreSQL remains authoritative for subscribers and consent. | Resend provides signed replay-safe webhooks, send idempotency, custom one-click unsubscribe headers, suppression, and bounded entry pricing without adding AWS operational resources. Subscriber truth stays local, tracking stays disabled, provider storage is explicitly US-based and limited to its documented retention, and production remains gated on the recorded compliance and deliverability review. |
| 2026-07-23 | Complete HD-101 with encrypted subscriber addresses, keyed lookup digests, and database-backed consent and action-token lifecycles. | AES-256-GCM keeps recoverable addresses authenticated and opaque at rest, separate versioned HMAC material supports uniqueness and token lookup without plaintext indexes, and PostgreSQL constraints plus per-address transaction locks make preference state and repeated lifecycle operations durable and idempotent. |
| 2026-07-23 | Complete HD-102 with launch-gated public forms, Resend confirmation messages, same-origin mutation checks, and PostgreSQL-backed address/client throttling. | Generic signup outcomes resist subscriber enumeration, only confirmed tokens activate delivery, scoped preference tokens permit edition changes or unsubscribe without accounts, and direct database token seeding lets Playwright verify the complete mobile/desktop lifecycle without exposing test tokens through HTTP or contacting Resend. |
