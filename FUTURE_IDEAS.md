# HN Digest future ideas

This document holds ideas that are intentionally outside the active roadmap.
They are not commitments, scheduled work, or authorization to implement a
feature. Moving an idea into `ROADMAP.md` requires an explicit product decision,
acceptance criteria, and a stable `HD-###` task ID.

## Analysis quality and model execution

### Stronger-model routing and fallback (formerly HD-044)

Use an economical default model and retry once with a stronger configuration
for a narrowly defined class of validation failures or demonstrably high-value
jobs.

Reconsider only when the fixed evaluation set shows a material quality gain
that justifies the additional cost. Any implementation must keep routing rules
in typed configuration, prohibit escalation loops, and report initial and
fallback usage separately.

### Batch API processing (formerly HD-052)

Submit scheduled analyses asynchronously when the operational and pricing
benefits outweigh the extra queueing, reconciliation, and failure-handling
complexity. On-demand runs should remain synchronous.

### Separate article and discussion model calls

Analyze article content and HN discussion independently so changing comments do
not require regenerating article analysis. Reconsider only if evaluation data
shows that the additional request volume materially improves quality or cache
reuse beyond the current single-request design.

## Reading experience

### Story detail and history pages (formerly HD-061)

Show a story's complete structured analysis and how its discussion changes
across digest runs. The interface should distinguish collection time from
publication time and make reused versus newly generated analysis visible.

## Source coverage

### JSON Feed support (formerly HD-079)

Add a named, versioned JSON Feed adapter only if production evidence shows
meaningful unsupported demand. Arbitrary JSON and unknown schemas would remain
unsupported, and embedded URLs would not be followed.

### PDF text extraction

Add bounded PDF text extraction only after defining parser isolation, resource
limits, evidence addressing, failure behavior, and representative adversarial
fixtures. OCR and media extraction are separate ideas and should not be implied
by PDF support.

### OCR and media extraction

Image OCR, audio transcription, and video extraction remain speculative. Each
would introduce distinct cost, security, provenance, and resource constraints
and would need its own evidence-based proposal.

## Ideas deliberately outside the current product boundary

- User accounts and multi-user personalization
- Native mobile applications
- Personalized or semantic story ranking
- Embeddings and vector search
- Multiple LLM providers
- An LLM-based comment-ranking stage

These ideas require a deliberate product-boundary decision before roadmap
consideration.
