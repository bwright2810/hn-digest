import {
  ArticleFetchError,
  ArticleFetcher,
  type ArticleFetchResult,
} from "./fetcher";

const ARCHIVE_ORIGIN = "https://web.archive.org";
const CDX_PATH = "/cdx/search/cdx";

interface ArchiveFetcherOptions {
  readonly timeoutMs: number;
  readonly maximumBytes: number;
  readonly maximumRedirects: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
}

/** Fetches one public, bounded Wayback snapshot without following source links. */
export class InternetArchiveFallbackFetcher {
  private readonly lookupFetcher: ArticleFetcher;
  private readonly snapshotFetcher: ArticleFetcher;

  constructor(options: ArchiveFetcherOptions) {
    this.lookupFetcher = new ArticleFetcher({
      ...options,
      supportedContentTypes: new Set(["application/json"]),
      requestHeaders: { accept: "application/json" },
    });
    this.snapshotFetcher = new ArticleFetcher(options);
  }

  async fetch(source: string | URL): Promise<ArticleFetchResult> {
    const original = normalizeSource(source);
    const lookup = new URL(CDX_PATH, ARCHIVE_ORIGIN);
    lookup.searchParams.set("url", original.href);
    lookup.searchParams.set("output", "json");
    lookup.searchParams.set("filter", "statuscode:200");
    lookup.searchParams.append("filter", "mimetype:text/html");
    lookup.searchParams.set("collapse", "digest");
    lookup.searchParams.set("limit", "1");

    let response: ArticleFetchResult;
    try {
      response = await this.lookupFetcher.fetch(lookup);
    } catch (error) {
      throw new ArticleFetchError(
        "archive_unavailable",
        "No usable archived source was available",
        {},
        { cause: error },
      );
    }

    const snapshot = parseSnapshot(response.body);
    if (!snapshot) {
      throw new ArticleFetchError(
        "archive_unavailable",
        "No usable archived source was available",
      );
    }
    const snapshotUrl = new URL(
      `/web/${snapshot.timestamp}id_/${original.href}`,
      ARCHIVE_ORIGIN,
    );
    try {
      const fetched = await this.snapshotFetcher.fetch(snapshotUrl);
      return { ...fetched, sourceUrl: original.href };
    } catch (error) {
      throw new ArticleFetchError(
        "archive_unavailable",
        "Archived source could not be fetched",
        {},
        { cause: error },
      );
    }
  }
}

export function parseSnapshot(body: Uint8Array): { timestamp: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new ArticleFetchError(
      "archive_invalid_response",
      "Archive returned malformed metadata",
    );
  }
  if (!Array.isArray(value) || value.length < 2) return null;
  const header = value[0];
  const row = value[1];
  if (!Array.isArray(header) || !Array.isArray(row)) return null;
  const timestampIndex = header.indexOf("timestamp");
  const statusIndex = header.indexOf("statuscode");
  const mimeIndex = header.indexOf("mimetype");
  const timestamp = row[timestampIndex ?? -1];
  if (
    statusIndex < 0 ||
    row[statusIndex] !== "200" ||
    mimeIndex < 0 ||
    row[mimeIndex] !== "text/html" ||
    typeof timestamp !== "string" ||
    !/^\d{14}$/u.test(timestamp)
  ) {
    return null;
  }
  return { timestamp };
}

function normalizeSource(source: string | URL): URL {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new ArticleFetchError("invalid_url", "Article URL is invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ArticleFetchError("invalid_url", "Article URL is invalid");
  }
  return url;
}
