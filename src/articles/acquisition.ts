import { and, desc, eq } from "drizzle-orm";

import { getConfig } from "../config/server";
import { getDatabase } from "../db/client";
import { documents } from "../db/schema";

import {
  ArticleFetchError,
  ArticleFetcher,
  type ArticleFetchFailureCode,
  type ArticleFetchResult,
} from "./fetcher";

export type ArticleAcquisitionOutcome =
  | { readonly status: "fetched"; readonly result: ArticleFetchResult }
  | {
      readonly status: "failed";
      readonly failureCode: ArticleFetchFailureCode;
    };

export interface ArticleFetchRecord {
  readonly storyId: number;
  readonly sourceUrl: string;
  readonly canonicalUrl: string | null;
  readonly status: "pending" | "failed";
  readonly fetchedAt: Date;
  readonly metadata: Readonly<Record<string, string | number | null>>;
}

export interface ArticleFetchStore {
  recordFetch(record: ArticleFetchRecord): Promise<void>;
}

interface FetchArticleClient {
  fetch(source: string | URL): Promise<ArticleFetchResult>;
}

export async function acquireArticle(options: {
  readonly storyId: number;
  readonly sourceUrl: string;
  readonly fetcher: FetchArticleClient;
  readonly store: ArticleFetchStore;
  readonly now?: () => Date;
}): Promise<ArticleAcquisitionOutcome> {
  const fetchedAt = (options.now ?? (() => new Date()))();
  let result: ArticleFetchResult;
  try {
    result = await options.fetcher.fetch(options.sourceUrl);
  } catch (error) {
    const failure =
      error instanceof ArticleFetchError
        ? error
        : new ArticleFetchError(
            "network",
            "Article request failed",
            {},
            {
              cause: error,
            },
          );
    await options.store.recordFetch({
      storyId: options.storyId,
      sourceUrl: options.sourceUrl,
      canonicalUrl: null,
      status: "failed",
      fetchedAt,
      metadata: {
        fetchStatus: "failed",
        failureCode: failure.code,
        ...failure.metadata,
      },
    });
    return { status: "failed", failureCode: failure.code };
  }

  await options.store.recordFetch({
    storyId: options.storyId,
    sourceUrl: result.sourceUrl,
    canonicalUrl: result.finalUrl,
    status: "pending",
    fetchedAt,
    metadata: {
      fetchStatus: "fetched",
      httpStatus: result.status,
      contentType: result.contentType,
      byteLength: result.byteLength,
      redirectCount: result.redirectCount,
    },
  });
  return { status: "fetched", result };
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresArticleFetchStore implements ArticleFetchStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async recordFetch(record: ArticleFetchRecord): Promise<void> {
    const [existing] = await this.database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.storyId, record.storyId),
          eq(documents.sourceUrl, record.sourceUrl),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);

    const values = {
      canonicalUrl: record.canonicalUrl,
      status: record.status,
      extractionMetadata: { ...record.metadata },
      fetchedAt: record.fetchedAt,
      updatedAt: record.fetchedAt,
    } as const;
    if (existing) {
      await this.database
        .update(documents)
        .set(values)
        .where(eq(documents.id, existing.id));
      return;
    }

    await this.database.insert(documents).values({
      storyId: record.storyId,
      sourceUrl: record.sourceUrl,
      ...values,
    });
  }
}

export function createArticleAcquisition() {
  const config = getConfig();
  const fetcher = new ArticleFetcher({
    timeoutMs: config.articleFetch.timeoutMs,
    maximumBytes: config.articleFetch.maximumBytes,
    maximumRedirects: config.articleFetch.maximumRedirects,
  });
  const store = new PostgresArticleFetchStore();
  return (storyId: number, sourceUrl: string) =>
    acquireArticle({ storyId, sourceUrl, fetcher, store });
}
