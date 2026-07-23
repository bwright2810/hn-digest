import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { derivePublicApiClientIp } from "../../../../public-api/client-ip";
import {
  calendarDateToUtc,
  publicDigestQuerySchema,
  readPublicDigest,
} from "../../../../public-api/digests";
import { consumePublicApiRateLimit } from "../../../../public-api/rate-limit";

export async function GET(request: Request): Promise<Response> {
  const config = getConfig();
  const now = new Date();
  let rate;
  try {
    const clientIp = derivePublicApiClientIp({
      directAddress: request.headers.get("x-real-ip"),
      forwardedFor: request.headers.get("x-forwarded-for"),
      trustedProxyCidrs: config.publicApi.trustedProxyCidrs,
    });
    rate = await consumePublicApiRateLimit(
      getDatabase(),
      config.subscribers.lookupHmacKey,
      clientIp,
      config.publicApi.rateLimit,
      config.publicApi.rateWindowMs,
      now,
    );
  } catch {
    return errorResponse(
      503,
      "rate_limit_unavailable",
      "Request limiting is temporarily unavailable.",
    );
  }
  const rateHeaders = {
    "RateLimit-Limit": String(rate.limit),
    "RateLimit-Remaining": String(rate.remaining),
    "RateLimit-Reset": String(Math.ceil(rate.resetAt.getTime() / 1_000)),
  };
  if (!rate.allowed)
    return errorResponse(429, "rate_limit_exceeded", "Too many requests.", {
      ...rateHeaders,
      "Retry-After": String(
        Math.max(
          1,
          Math.ceil((rate.resetAt.getTime() - now.getTime()) / 1_000),
        ),
      ),
    });

  const url = new URL(request.url);
  const query = publicDigestQuerySchema.safeParse({
    date: url.searchParams.get("date"),
    edition: url.searchParams.get("edition"),
  });
  if (!query.success)
    return errorResponse(
      400,
      "invalid_request",
      "A valid date and edition are required.",
      rateHeaders,
    );
  const requestedDate = calendarDateToUtc(query.data.date);
  if (!requestedDate)
    return errorResponse(
      400,
      "invalid_date",
      "The requested date is invalid.",
      rateHeaders,
    );
  const localToday = localCalendarDate(now, config.schedule.timeZone);
  const today = calendarDateToUtc(localToday)!;
  if (requestedDate > today)
    return errorResponse(
      400,
      "future_date",
      "Future digests are unavailable.",
      rateHeaders,
    );
  const oldest = new Date(today);
  oldest.setUTCDate(oldest.getUTCDate() - config.publicApi.maximumAgeDays);
  if (requestedDate < oldest)
    return errorResponse(
      410,
      "outside_retention_window",
      "The requested digest is outside the retrieval window.",
      rateHeaders,
    );

  try {
    const digest = await readPublicDigest(getDatabase(), {
      ...query.data,
      timeZone: config.schedule.timeZone,
      morningTime: config.schedule.morningTime,
      eveningTime: config.schedule.eveningTime,
    });
    if (!digest)
      return errorResponse(
        404,
        "digest_unavailable",
        "No completed digest is available for this edition.",
        rateHeaders,
      );
    return Response.json(digest, {
      headers: {
        ...rateHeaders,
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    });
  } catch {
    return errorResponse(
      503,
      "digest_temporarily_unavailable",
      "The digest is temporarily unavailable.",
      rateHeaders,
    );
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { version: "v1", error: { code, message } },
    { status, headers: { ...headers, "Cache-Control": "no-store" } },
  );
}

function localCalendarDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}
