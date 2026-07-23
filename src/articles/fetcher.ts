import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

export const SUPPORTED_ARTICLE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ArticleFetchFailureCode =
  | "invalid_url"
  | "unsafe_url"
  | "dns_failure"
  | "timeout"
  | "network"
  | "http_status"
  | "redirect_missing_location"
  | "redirect_limit"
  | "unsupported_content_type"
  | "response_too_large"
  | "invalid_source_response";

export class ArticleFetchError extends Error {
  constructor(
    readonly code: ArticleFetchFailureCode,
    message: string,
    readonly metadata: Readonly<Record<string, string | number>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArticleFetchError";
  }
}

export interface ArticleFetchResult {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly byteLength: number;
  readonly redirectCount: number;
  readonly status: number;
}

export interface ArticleFetcherOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  readonly maximumBytes: number;
  readonly maximumRedirects: number;
  readonly timeoutMs: number;
  readonly supportedContentTypes?: ReadonlySet<string>;
  readonly requestHeaders?: Readonly<Record<string, string>>;
}

export class ArticleFetcher {
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly lookup: (hostname: string) => Promise<readonly string[]>;
  private readonly maximumBytes: number;
  private readonly maximumRedirects: number;
  private readonly timeoutMs: number;
  private readonly supportedContentTypes: ReadonlySet<string>;
  private readonly requestHeaders: Readonly<Record<string, string>>;

  constructor(options: ArticleFetcherOptions) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.lookup = options.lookup ?? lookupAddresses;
    this.maximumBytes = requireInteger(options.maximumBytes, "maximumBytes", 1);
    this.maximumRedirects = requireInteger(
      options.maximumRedirects,
      "maximumRedirects",
      0,
    );
    this.timeoutMs = requireInteger(options.timeoutMs, "timeoutMs", 1);
    this.supportedContentTypes =
      options.supportedContentTypes ?? SUPPORTED_ARTICLE_CONTENT_TYPES;
    this.requestHeaders = options.requestHeaders ?? {};
  }

  async fetch(source: string | URL): Promise<ArticleFetchResult> {
    const sourceUrl = parseUrl(source);
    let currentUrl = sourceUrl;
    const signal = AbortSignal.timeout(this.timeoutMs);

    for (let redirectCount = 0; ; redirectCount += 1) {
      await this.assertPublicUrl(currentUrl, signal);

      let response: Response;
      try {
        response = await this.fetchImplementation(currentUrl, {
          headers: {
            accept:
              "text/html,application/xhtml+xml;q=0.9,text/markdown;q=0.8,text/plain;q=0.7",
            "user-agent": "HN-Digest/0.1 article fetcher",
            ...this.requestHeaders,
          },
          redirect: "manual",
          signal,
        });
      } catch (error) {
        throw classifyRequestError(error);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        response.body?.cancel().catch(() => undefined);
        if (redirectCount >= this.maximumRedirects) {
          throw new ArticleFetchError(
            "redirect_limit",
            "Article exceeded the redirect limit",
            { redirectCount },
          );
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new ArticleFetchError(
            "redirect_missing_location",
            "Article redirect omitted its destination",
            { status: response.status },
          );
        }
        currentUrl = parseUrl(new URL(location, currentUrl));
        continue;
      }

      if (!response.ok) {
        response.body?.cancel().catch(() => undefined);
        throw new ArticleFetchError(
          "http_status",
          "Article server returned an unsuccessful status",
          { status: response.status },
        );
      }

      const contentType = parseContentType(
        response.headers.get("content-type"),
      );
      if (!contentType || !this.supportedContentTypes.has(contentType)) {
        response.body?.cancel().catch(() => undefined);
        throw new ArticleFetchError(
          "unsupported_content_type",
          "Article response content type is not supported",
          contentType ? { contentType } : {},
        );
      }

      const declaredLength = parseContentLength(
        response.headers.get("content-length"),
      );
      if (declaredLength !== null && declaredLength > this.maximumBytes) {
        response.body?.cancel().catch(() => undefined);
        throw tooLarge(this.maximumBytes, declaredLength);
      }

      const body = await readBoundedBody(
        response.body,
        this.maximumBytes,
        signal,
      );
      return {
        sourceUrl: sourceUrl.href,
        finalUrl: currentUrl.href,
        contentType,
        body,
        byteLength: body.byteLength,
        redirectCount,
        status: response.status,
      };
    }
  }

  private async assertPublicUrl(url: URL, signal: AbortSignal): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ArticleFetchError(
        "invalid_url",
        "Article URL must use HTTP or HTTPS",
      );
    }
    if (url.username || url.password) {
      throw new ArticleFetchError(
        "invalid_url",
        "Article URL must not contain credentials",
      );
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: readonly string[];
    if (isIP(hostname)) {
      addresses = [hostname];
    } else {
      try {
        addresses = await raceWithSignal(this.lookup(hostname), signal);
      } catch (error) {
        if (signal.aborted) throw classifyRequestError(signal.reason);
        throw new ArticleFetchError(
          "dns_failure",
          "Article hostname could not be resolved",
          {},
          { cause: error },
        );
      }
    }
    if (addresses.length === 0) {
      throw new ArticleFetchError(
        "dns_failure",
        "Article hostname resolved to no addresses",
      );
    }
    if (addresses.some((address) => !isPublicAddress(address))) {
      throw new ArticleFetchError(
        "unsafe_url",
        "Article hostname resolves to a non-public address",
      );
    }
  }
}

async function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    ),
  ]);
}

function parseUrl(value: string | URL): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new ArticleFetchError(
      "invalid_url",
      "Article URL is invalid",
      {},
      {
        cause: error,
      },
    );
  }
}

async function lookupAddresses(hostname: string): Promise<readonly string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

function parseContentType(header: string | null): string | null {
  return header?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function parseContentLength(header: string | null): number | null {
  if (!header || !/^\d+$/.test(header)) return null;
  const length = Number(header);
  return Number.isSafeInteger(length) ? length : null;
}

async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw tooLarge(maximumBytes, length);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ArticleFetchError) throw error;
    throw classifyRequestError(signal.aborted ? signal.reason : error);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function classifyRequestError(error: unknown): ArticleFetchError {
  if (
    (error instanceof DOMException &&
      ["AbortError", "TimeoutError"].includes(error.name)) ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return new ArticleFetchError(
      "timeout",
      "Article request timed out",
      {},
      {
        cause: error,
      },
    );
  }
  return new ArticleFetchError(
    "network",
    "Article request failed",
    {},
    {
      cause: error,
    },
  );
}

function tooLarge(maximumBytes: number, receivedBytes: number) {
  return new ArticleFetchError(
    "response_too_large",
    "Article response exceeded the size limit",
    { maximumBytes, receivedBytes },
  );
}

function requireInteger(value: number, name: string, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}
