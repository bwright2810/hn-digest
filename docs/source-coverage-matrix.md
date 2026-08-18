# Supported source coverage

HN Digest treats every linked source as untrusted input. The matrix below is
the release boundary for article summaries. A discussion-only result is an
intentional outcome: it tells the reader that the HN thread was available but
the linked source was not safely extractable.

| Source class                            | Detection / adapter                                        | Outcome                                         | Notes                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| HTML and XHTML                          | validated HTTP content type, Readability adapter           | article extraction or low-confidence extraction | Redirects, public-destination checks, response size, and timeout limits apply to every hop.                       |
| Plain text                              | `text/plain`, text adapter                                 | article extraction or low-confidence extraction | Invalid UTF-8, NUL bytes, empty bodies, and oversized responses remain discussion-only.                           |
| Markdown                                | Markdown content types, Markdown adapter                   | article extraction or low-confidence extraction | GitHub file paths retain a bounded repository-path evidence location.                                             |
| GitHub README                           | explicit GitHub repository route and bounded API response  | article extraction or discussion-only           | No cloning, directory traversal, or arbitrary API endpoint traversal.                                             |
| GitHub file                             | explicit `blob` route and curated text extension           | article extraction or discussion-only           | File path and ref are validated before the API request.                                                           |
| RSS / Atom entry                        | RSS or Atom XML adapter                                    | one selected entry or discussion-only           | Only the first deterministic entry is selected; generic XML and JSON Feed are not followed.                       |
| PDF                                     | `application/pdf` or reviewed `.pdf` source classification | discussion-only                                 | Text-layer PDF parsing remains deferred until the isolated-parser gate in the source-support plan passes. No OCR. |
| JSON, images, audio, video, generic XML | content type and source classification                     | discussion-only                                 | The system never invents an article summary from unsupported media or structured data.                            |
| Access-restricted or failed source      | HTTP/security/fetch failure classification                 | discussion-only                                 | Paywalls and access controls are never bypassed.                                                                  |

## Archive fallback decision

The MVP has an opt-in Internet Archive Wayback fallback, disabled by default
with `ARTICLE_ARCHIVE_FALLBACK_ENABLED=false`. It runs only after an ordinary
fetch failure, never for access-restricted responses, and stores the original
source URL alongside the archived fetch metadata. An archived copy can be
stale or legally different from the linked source, so production enablement
requires an operator policy review. The fallback uses the same
public-destination, redirect, timeout, response-size, content-type, and
concurrency controls as primary acquisition and never follows links from an
archive response.

The reviewed fixtures in `src/articles/fixtures/source-types.json` and the
fetcher, adapter, acquisition, GitHub, feed, and extraction tests are the
regression matrix for these boundaries. No live source or model request is
required.
