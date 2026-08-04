# Public digest API v1

`GET /api/v1/digests?date=YYYY-MM-DD&edition=morning|evening` returns one
completed scheduled digest. Dates use the configured digest timezone; all
timestamps in the response are UTC ISO 8601 strings. Partial, failed,
on-demand, future, missing, and over-age digests are never returned.

Successful responses contain `version`, `date`, `edition`, `scheduledFor`,
`collectedAt`, `storyCount`, and ranked `stories`. Each story exposes only its
public metadata, original/HN links, and validated article, discussion, and
combined analysis. Internal IDs, errors, prompts, source bodies, subscriber
data, and operator fields are excluded.

Errors use `{ "version": "v1", "error": { "code": "...", "message": "..." } }`.
Invalid requests and future dates return 400, unavailable or partial editions
return 404, dates outside the configured window return 410, exhausted limits
return 429, and unavailable shared rate-limit or digest storage returns 503.

Every request is counted before cache or digest lookup. Responses include
`RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`; 429 also
includes `Retry-After`. The default is 10 requests per fixed minute per client.
Completed responses permit bounded shared caching; errors use `no-store`.

## Reverse-proxy requirement

The application must remain private behind Coolify/Traefik. The proxy must
remove inbound `X-Real-IP` and `X-Forwarded-For`, then set `X-Real-IP` to its
own address and append the verified client chain to `X-Forwarded-For`.
`PUBLIC_API_TRUSTED_PROXY_CIDRS` must list only the Coolify proxy network.
Forwarded values are ignored unless `X-Real-IP` belongs to that explicit list;
invalid or fully trusted chains share a fail-safe rate-limit bucket.
