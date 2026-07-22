# Designing Bounded Collectors

Network collection needs explicit limits. Timeouts, response-size caps, redirect limits, and repeated public-address validation turn a risky fetch into a bounded operation.

## Preserve evidence

An extracted document should retain a stable content hash and useful structure. Markdown headings are evidence about the author's organization, so the extractor keeps them alongside normalized text.

## Fail explicitly

Unsupported media should become a discussion-only result. A single inaccessible article must not fail an otherwise useful Hacker News digest.
