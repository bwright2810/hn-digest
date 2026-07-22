import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "../db/client";
import { documents } from "../db/schema";
import { normalizeHackerNewsText } from "../ingestion/comments";

export interface TextPostDocumentRecord {
  readonly storyId: number;
  readonly hnItemId: number;
  readonly title: string;
  readonly text: string;
  readonly contentHash: string;
  readonly recordedAt: Date;
}

export interface TextPostDocumentStore {
  recordTextPost(record: TextPostDocumentRecord): Promise<void>;
}

export type TextPostOutcome =
  | {
      readonly status: "extracted";
      readonly sourceType: "hn_text_post";
      readonly contentHash: string;
      readonly text: string;
    }
  | {
      readonly status: "unsupported";
      readonly sourceType: "empty_text_post";
      readonly discussionOnly: true;
    };

export async function acquireTextPost(options: {
  readonly storyId: number;
  readonly hnItemId: number;
  readonly title: string;
  readonly html?: string;
  readonly store: TextPostDocumentStore;
  readonly now?: () => Date;
}): Promise<TextPostOutcome> {
  const text = normalizeHackerNewsText(options.html);
  if (text === null) {
    return {
      status: "unsupported",
      sourceType: "empty_text_post",
      discussionOnly: true,
    };
  }

  const contentHash = createHash("sha256").update(text).digest("hex");
  await options.store.recordTextPost({
    storyId: options.storyId,
    hnItemId: options.hnItemId,
    title: options.title,
    text,
    contentHash,
    recordedAt: (options.now ?? (() => new Date()))(),
  });
  return { status: "extracted", sourceType: "hn_text_post", contentHash, text };
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresTextPostDocumentStore implements TextPostDocumentStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async recordTextPost(record: TextPostDocumentRecord): Promise<void> {
    const sourceUrl = hackerNewsItemUrl(record.hnItemId);
    const [existing] = await this.database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.storyId, record.storyId),
          eq(documents.sourceUrl, sourceUrl),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);
    const values = {
      canonicalUrl: sourceUrl,
      status: "extracted" as const,
      contentHash: record.contentHash,
      title: record.title,
      extractedText: record.text,
      extractionMetadata: {
        sourceType: "hn_text_post",
        wordCount: record.text.split(/\s+/u).length,
        characterCount: record.text.length,
        extractedAt: record.recordedAt.toISOString(),
      },
      fetchedAt: record.recordedAt,
      updatedAt: record.recordedAt,
    };

    if (existing) {
      await this.database
        .update(documents)
        .set(values)
        .where(eq(documents.id, existing.id));
      return;
    }
    await this.database.insert(documents).values({
      storyId: record.storyId,
      sourceUrl,
      ...values,
    });
  }
}

function hackerNewsItemUrl(hnItemId: number): string {
  return `https://news.ycombinator.com/item?id=${hnItemId}`;
}
