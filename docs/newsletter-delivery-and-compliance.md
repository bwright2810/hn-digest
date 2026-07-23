# Newsletter delivery and compliance design

This document records the HD-100 design decision made on 2026-07-23. It is the
boundary for HD-101 through HD-104: HN Digest does not collect subscriber email
addresses until the persistence and public lifecycle described here are
implemented and tested. This is an engineering control document, not legal
advice. The owner must complete the launch review at the end before enabling
public signup or production delivery.

## Provider decision

HN Digest will use **Resend's Email API** for confirmation, preference-change,
and digest messages. PostgreSQL remains the system of record for subscribers,
consent, edition preferences, suppression, and delivery outcomes. Resend is a
delivery processor, not the authoritative contact list. This keeps one
transactional lifecycle under application control and permits one persisted,
idempotent delivery per subscriber and digest.

The initial integration will send one recipient per request. It will not put
multiple subscribers in `To`, `Cc`, or `Bcc`, and it will not sync the complete
subscriber list into Resend Contacts or Broadcasts. Application concurrency is
bounded below Resend's documented default of five API requests per second.
Later batching requires a separate failure-isolation and idempotency review.

Reasons for selecting Resend:

- the API accepts independently generated HTML and plain-text alternatives,
  custom `List-Unsubscribe` headers, and a provider idempotency key;
- webhooks are signed, use an event identifier for replay protection, and
  provide bounce, complaint, failure, delivery, and suppression events;
- SPF and DKIM verification, DMARC support, automatic suppression, and
  reputation metrics cover the first-release deliverability boundary; and
- the TypeScript-facing API is a smaller operational surface for the existing
  Node.js application than operating Amazon SES, SNS, and related AWS policy
  resources.

The cost assumption, checked on 2026-07-23, is $0 for up to 3,000 email API
messages per month with a 100-message daily limit, or $20 per month for 50,000
messages with no daily limit and $0.90 per additional 1,000. Confirmation and
preference messages also count. At two editions per day, 500 subscribers who
choose both editions produce approximately 30,000 digest messages per 30-day
month; 1,000 produce approximately 60,000, or about $29 under that published
Pro pricing before taxes. The operator must verify current price, quota, and
overage controls before production access and set a provider-side spend alert.

Resend routes mail from a selectable region, but stores account data, email
metadata, logs, and API records in the United States. Its standard plans retain
email data for 30 days. The owner must accept the Resend Data Processing
Addendum and review its subprocessors before launch; choosing an EU sending
region does not create EU data residency. If the audience or residency
requirement makes this unacceptable, pause launch and revise this decision
rather than silently changing providers.

Provider references:

- [pricing and 30-day retention](https://resend.com/pricing)
- [API quotas and the default request rate](https://resend.com/docs/api-reference/rate-limit)
- [email API, alternatives, headers, and idempotency](https://resend.com/docs/api-reference/emails/send-email)
- [one-click unsubscribe headers](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails)
- [signed, at-least-once webhooks](https://resend.com/docs/webhooks/introduction)
- [event types](https://resend.com/docs/webhooks/event-types)
- [domain authentication](https://resend.com/docs/dashboard/domains/introduction)
- [sending region and US data storage](https://resend.com/docs/dashboard/domains/regions)
- [Data Processing Addendum](https://resend.com/static/documents/resend-dpa-signed.pdf)

## Subscriber and consent model

HD-101 will add a forward migration with these logical records. Exact Drizzle
names may change to follow schema conventions, but the boundaries may not.

### Subscriber

- immutable internal UUID;
- canonical email ciphertext, encrypted with a versioned runtime key;
- a versioned keyed lookup digest of the canonical email for uniqueness and
  idempotent lookup without a plaintext index;
- state: `unconfirmed`, `confirmed`, or `unsubscribed`;
- independent `morning_enabled` and `evening_enabled` booleans;
- confirmation, unsubscribe, and last-preference-change timestamps;
- provider suppression state and its classified reason; and
- normal created/updated timestamps.

Canonicalization is deliberately conservative: trim surrounding ASCII
whitespace and lowercase the domain using an email-address parser. Preserve the
local part rather than applying provider-specific dot, plus-tag, or case rules.
Reject invalid or overlong addresses. At least one edition must be selected for
an unconfirmed or confirmed subscriber; an unsubscribed record has neither
edition enabled. A unique constraint on the keyed lookup digest prevents
duplicate subscriber rows.

The encryption and lookup keys are separate runtime secrets. Neither keys nor
plaintext addresses may appear in client data, URLs, logs, exceptions,
analytics, fixtures, screenshots, or provider tags. Key versions support
rotation. Logs use only internal subscriber/delivery IDs and classified codes.

### Consent event

Consent evidence is append-only and records the subscriber ID, event kind,
selected editions, consent-copy/policy version, source (`public_signup` or an
explicit future source), and application timestamps for requested and
confirmed actions. It does not retain IP addresses, user-agent strings, request
bodies, referrers, or arbitrary headers. Confirmation is the evidence that the
address owner completed opt-in; a signup request alone is not consent to send
digests.

Every change of editions, unsubscribe, resubscribe, or suppression adds a
classified event. The public form uses unchecked controls and names HN Digest,
the morning/evening frequency, the content being sent, the privacy notice, and
the ability to withdraw consent.

### Action token

Confirmation and preference-management tokens are random, opaque,
purpose-specific, single-use, and expiring. Only a versioned keyed token digest
is stored with subscriber ID, purpose, expiry, consumption time, and creation
time. Confirmation tokens expire after 24 hours; preference-management links
expire after 30 days. A new token invalidates older unconsumed tokens of the
same purpose. Tokens and token digests are never logged.

Unsubscribe links use a separate recipient-and-message-scoped opaque token.
They remain usable for at least 30 days after the message is sent and may be
consumed repeatedly so mail-client retries are harmless. A valid unsubscribe
request always produces the same terminal state.

### Delivery and event records

HD-103 will persist one delivery row per subscriber and digest run, with a
unique constraint over that pair. It records edition, attempt count, bounded
status, provider message ID, last classified error, and timestamps. The
database constraint is the durable idempotency boundary; Resend's 24-hour
idempotency key is a second layer, not a replacement.

HD-104 will retain only the provider event ID, delivery ID, event type,
provider timestamp, received timestamp, and a small classified detail needed
for suppression. A unique provider event ID makes Resend's at-least-once and
out-of-order delivery safe. Full webhook payloads, subjects, addresses, and
message bodies are not persisted.

## Lifecycle and public behavior

1. **Signup:** a visitor selects morning, evening, or both and submits an email.
   The response is identical whether the address is new, pending, confirmed,
   unsubscribed, or suppressed. Rate limiting and abuse controls apply before
   mail is queued.
2. **Pending confirmation:** a new or safely repeatable request stores the
   requested preferences and sends a confirmation message. It does not enable
   digest delivery. Repeated requests rotate the token without revealing state
   and are throttled per address digest and trusted client IP.
3. **Confirmed opt-in:** consuming a valid confirmation token atomically marks
   the subscriber confirmed, activates the explicitly selected editions, and
   records the consent version and confirmation time. Reuse returns the same
   safe success state.
4. **Preferences:** a purpose-specific link permits morning, evening, both, or
   unsubscribe-all without an account. Saving no editions is unsubscribe.
5. **Delivery:** only confirmed, non-suppressed subscribers with the matching
   edition enabled are eligible after a scheduled digest becomes `complete` or
   published `partial`. On-demand and failed unpublished runs never send.
6. **Unsubscribe:** the visible link and RFC 8058 one-click POST disable all
   editions immediately in one database transaction. Preference management can
   disable one edition while retaining the other. Neither path requires login,
   an email re-entry, or a confirmation step.
7. **Suppression:** a permanent bounce, complaint, provider unsubscribe, or
   provider-suppressed event disables all delivery immediately. A temporary
   delay or transient failure does not suppress; it follows bounded retry rules.
   Application eligibility and provider suppression are both checked before
   every send.
8. **Resubscribe:** an unsubscribed address must complete a new confirmed
   opt-in. Complaint and hard-bounce suppressions cannot be cleared through a
   public flow; only a documented operator review may clear a mistaken state.

Confirmation and preference messages contain no digest content and no secret
state beyond their scoped token. Every digest contains a visible unsubscribe
link, a preferences link, the sender identity and postal address required by
the applicable launch review, plus these headers:

```text
List-Unsubscribe: <https://configured-origin.example/unsubscribe/opaque-token>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The `GET` target presents the normal unsubscribe page. A standards-shaped
`POST` performs unsubscribe and returns an empty `200` or `202`. Both paths are
idempotent. Links use only the configured HTTPS application origin and never
contain an email address, database ID, provider credential, or reusable general
session token.

## Authentication, reputation, and failure behavior

Use a dedicated sending subdomain and a stable, monitored From address. Before
production delivery, verify SPF and DKIM, publish DMARC initially at `p=none`
with aggregate reports directed to an owner-controlled mailbox, verify
alignment, and tighten the policy only after observing legitimate traffic.
Open and click tracking remain disabled: digest source links already provide
provenance, and tracking would add unnecessary subscriber data.

Webhook handlers must read the raw body and verify Resend's signature and
timestamp with the runtime-only webhook signing secret before parsing or
changing state. Reject missing, invalid, or stale signatures. Store the
provider event ID before applying an event so replay is idempotent. The API key
and webhook secret are server-only Coolify runtime values, excluded from build
arguments and client bundles, and rotated independently.

Sending is queued and bounded. A provider timeout is an unknown outcome, so the
same persisted delivery and deterministic provider idempotency key are retried;
a new delivery row or key must not be created. Retry only timeouts, rate limits,
and provider/server failures with capped exponential backoff. Validation,
authentication, permanent bounce, complaint, and suppression failures are
terminal. Exhaustion marks only that recipient's delivery failed and raises an
aggregate operator signal; it does not abort unrelated recipients.

Pause newsletter sending when provider authentication or domain verification
fails, the provider rejects a sustained share of requests, bounce rate reaches
3%, complaint rate reaches 0.05%, or Resend pauses the account. These internal
thresholds are intentionally below Resend's documented 4% bounce and 0.08%
spam ceilings. Resume only after the cause and suppression backlog are reviewed.

## Retention, deletion, and privacy boundary

- Unconfirmed subscriber rows and expired tokens are deleted seven days after
  the last confirmation token expires, unless a suppression must be retained.
- Consumed or expired confirmation/preference token rows are deleted after
  seven days. Unsubscribe tokens and the delivery rows they protect remain for
  45 days after send so required opt-out mechanisms continue to operate.
- Confirmed subscriber and consent records remain while subscribed. Detailed
  successful delivery records and minimized provider events remain for 90 days;
  monthly aggregate counts may remain without subscriber identifiers.
- Unsubscribe immediately disables sending. After 30 days, delete the encrypted
  address, action tokens, detailed deliveries, and nonessential consent data.
  Retain only the keyed address digest, suppression reason, unsubscribe time,
  and consent-policy version needed to honor and explain the do-not-contact
  state. This minimized suppression record has no routine expiry while HN
  Digest sends newsletters.
- A verified deletion request follows the same minimization promptly. The
  suppression digest remains because deleting the do-not-contact fact could
  cause future unlawful mail; document this limited exception in the privacy
  notice. If sending ends permanently, delete suppression records after the
  final provider and backup retention windows.
- Database backups age deleted detail out under the documented backup schedule.
  A restore must reapply suppressions and lifecycle deletions before sending is
  re-enabled. Resend retains standard-plan email data for 30 days; provider
  deletion requests are made when available and do not replace the documented
  provider retention window.

The privacy notice must identify HN Digest as controller, explain the purposes
and legal basis for confirmation and newsletter delivery, list the categories
sent to Resend, disclose US processing and the relevant transfer safeguards,
state each retention period, explain access/deletion/withdrawal rights, and
provide an owner-monitored privacy contact. Do not sell addresses or use them
for unrelated messages.

Confirmed opt-in is the global product rule even where local law would permit a
less protective approach. Before launch, the owner must determine the actual
operator identity, audience, and jurisdictions with qualified counsel as
needed. At minimum, review the US CAN-SPAM requirements for accurate identity
and subjects, postal address, working opt-out, and prompt honoring; and, if UK
or EEA subscribers are accepted, the consent, transparency, processor,
international-transfer, and data-subject-rights duties. Useful primary guidance
includes the [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
and the [UK ICO electronic-mail marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/).

## Launch review

Public signup and production sending remain disabled until the owner records
the date and outcome of every item below:

- operator/controller legal name, monitored contact, and valid postal address;
- applicable-jurisdiction review and published privacy/consent copy versions;
- accepted Resend terms and DPA, reviewed subprocessors, production access,
  quota, billing alert, and least-privilege runtime credentials;
- dedicated sending subdomain with passing SPF, DKIM, DMARC, alignment, and TLS;
- verified visible unsubscribe, preference update, RFC 8058 one-click POST, and
  suppression behavior in both HTML and plain-text messages;
- tested signed-webhook replay, hard bounce, complaint, transient failure,
  provider outage, secret rotation, and database-restore behavior;
- confirmed retention cleanup, subscriber export/deletion procedure, privacy-
  safe operator diagnostics, and backups that age out deleted personal data;
- mailbox seed tests across major providers and acceptable bounce/complaint
  metrics at a deliberately small initial send volume; and
- an owner-monitored reply/privacy mailbox plus a documented pause procedure.

Any change of provider, contact synchronization strategy, tracking policy,
residency assumption, consent model, or retention period is a material decision
and must update this document and the roadmap decision log before deployment.
