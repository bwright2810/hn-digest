import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "../db/client";
import { documents } from "../db/schema";

import type { ArticleFetchResult } from "./fetcher";
import {
  ArticleExtractor,
  type ArticleExtraction,
  type ArticleExtractionStatus,
} from "./extractor";

export interface ArticleExtractionRecord {
  readonly storyId: number;
  readonly sourceUrl: string;
  readonly canonicalUrl: string;
  readonly extractedAt: Date;
  readonly extraction: ArticleExtraction;
}

export interface ArticleExtractionStore {
  recordExtraction(record: ArticleExtractionRecord): Promise<void>;
}

interface ExtractArticleClient {
  extract(
    content: string | Uint8Array,
    sourceUrl: string | URL,
    contentType?: string,
  ): ArticleExtraction;
}

export async function extractArticle(options: {
  readonly storyId: number;
  readonly fetched: ArticleFetchResult;
  readonly extractor: ExtractArticleClient;
  readonly store: ArticleExtractionStore;
  readonly now?: () => Date;
}): Promise<ArticleExtraction> {
  const extraction = options.extractor.extract(
    options.fetched.body,
    options.fetched.finalUrl,
    options.fetched.contentType,
  );
  await options.store.recordExtraction({
    storyId: options.storyId,
    sourceUrl: options.fetched.sourceUrl,
    canonicalUrl: options.fetched.finalUrl,
    extractedAt: (options.now ?? (() => new Date()))(),
    extraction,
  });
  return extraction;
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresArticleExtractionStore implements ArticleExtractionStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async recordExtraction(record: ArticleExtractionRecord): Promise<void> {
    const [document] = await this.database
      .select({ id: documents.id, metadata: documents.extractionMetadata })
      .from(documents)
      .where(
        and(
          eq(documents.storyId, record.storyId),
          eq(documents.sourceUrl, record.sourceUrl),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);
    if (!document) {
      throw new Error("Cannot store extraction for an unknown document");
    }

    const extraction = record.extraction;
    await this.database
      .update(documents)
      .set({
        canonicalUrl: record.canonicalUrl,
        status: databaseStatus(extraction.status),
        contentHash: extraction.contentHash,
        title: extraction.title,
        byline: extraction.byline,
        publishedAt: extraction.publishedAt,
        extractedText: extraction.text,
        extractionMetadata: {
          ...document.metadata,
          extraction: {
            status: extraction.status,
            headings: extraction.headings,
            wordCount: extraction.wordCount,
            characterCount: extraction.characterCount,
            confidenceReasons: extraction.confidenceReasons,
            extractedAt: record.extractedAt.toISOString(),
          },
        },
        updatedAt: record.extractedAt,
      })
      .where(eq(documents.id, document.id));
  }
}

function databaseStatus(
  status: ArticleExtractionStatus,
): "extracted" | "low_confidence" {
  return status === "extracted" ? "extracted" : "low_confidence";
}

export function createArticleExtraction() {
  const extractor = new ArticleExtractor();
  const store = new PostgresArticleExtractionStore();
  return (storyId: number, fetched: ArticleFetchResult) =>
    extractArticle({ storyId, fetched, extractor, store });
}
