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
