# HD-058 source-type audit

The reviewed fixture manifest in `src/articles/fixtures/source-types.json`
captures the recurring non-HTML classes relevant to Hacker News links: plain
text, Markdown, PDF, images, audio, and JSON endpoints. It contains synthetic
content and MIME classifications only; no fetched source bodies or sensitive
URLs are retained.

Plain text and Markdown are prioritized because they are textual article
formats that can use the existing bounded fetch, redirect, SSRF, and content
quality controls. PDF remains deferred by the roadmap. Images, audio, video,
feeds, and structured-data endpoints remain explicit discussion-only sources.

Operational source metrics group documents by coarse source type, content type,
and outcome. They never include a source or canonical URL. The outcome classes
are `access_restriction`, `unsupported_content_type`, `fetch_failure`,
`extraction_failure`, `low_confidence`, and `extracted`.

HD-076 routes the currently approved HTML, plain-text, and Markdown formats
through stable `html-v1`, `plain-text-v1`, and `markdown-v1` adapters. The
normalized extraction metadata records the adapter ID and bounded heading or
line-range evidence locations. HD-075 uses a 10-run initial audit; HD-077
(GitHub) was subsequently activated by explicit owner direction with a
one-file policy. HD-078 (RSS/Atom) and HD-079 (JSON Feed) remain gated by the
HD-081 evidence decision. PDF, OCR, and media processing remain deferred.

HD-077 resolves only public GitHub repository roots and explicit blob links.
Repository roots request one README; blob links request one allow-listed text
file and support only a single-segment ref. The path never lists directories,
traverses a repository, clones content, follows embedded URLs, or uses a GitHub
credential. Successful extraction records `github-markdown-v1` or
`github-source-v1`, a commit-pinned canonical URL, the repository-relative file
path, and bounded heading or line-range evidence.

Run
`pnpm source:baseline [from-iso-date] [to-iso-date] [minimum-run-count]` from a
trusted environment with only `DATABASE_URL` configured. The command defaults
to the previous 90 days and outputs aggregate JSON containing the qualifying
run count, readiness gate, coarse source/content types, outcomes, occurrence
and distinct-story counts, and median HN comment count and rank. It exits with
status 2 until the requested threshold is present. The report contains no
source bodies or URLs.

The optional minimum is for exercising the review workflow below the 10-run
initial gate. Such a report can set `ready` but not `roadmapReady`.
`extendedReady` remains an informational indication that 30 qualifying runs
exist; it is no longer an adapter-enablement gate. Source URLs are inspected
only inside the aggregate query to classify public GitHub repository and file
links into bounded labels; complete URLs are never returned.

Because documents are content-addressed and updated in place when a story
recurs, historical reports use each story's latest known document
outcome. HD-081 therefore supplements the aggregate results with distinct-story
discovery and reviewed fixtures rather than relying on run count alone.

The first production review is recorded in
`docs/source-adapter-baseline-provisional.md`. The completed alternate HD-081
review and final adapter decision are recorded in
`docs/source-adapter-review.md`.

For a broad, zero-LLM-cost candidate scan, run `pnpm source:discover [limit]`
with a limit from 1 through 500. It walks the current HN `topstories` ranking,
fetches only HN item metadata, and classifies URL shapes for GitHub
repositories/files, PDFs, feeds, JSON, images, audio, video, text posts, and
other web pages. Output contains aggregate counts, the number meeting the
10-comment digest gate, median rank/comment depth, and at most five
representative HN item IDs per class—never source URLs or article bodies. This
discovery scan can identify fixtures and candidates, but does not by itself
prove that fetching or extraction will succeed.
