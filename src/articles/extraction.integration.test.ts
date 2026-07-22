import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { documents, stories } from "../db/schema";

import { PostgresArticleFetchStore } from "./acquisition";
import { PostgresArticleExtractionStore } from "./extraction";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-021 extraction persistence", () => {
  const connection = createDatabase(databaseUrl!);
  const fetchStore = new PostgresArticleFetchStore(connection.db);
  const extractionStore = new PostgresArticleExtractionStore(connection.db);
  const storyHnItemId = 91_000_021;
  const sourceUrl = "https://example.com/hd-021";
  let storyId: number;

  beforeAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    const [story] = await connection.db
      .insert(stories)
      .values({
        hnItemId: storyHnItemId,
        title: "HD-021 fixture",
        url: sourceUrl,
        hnCreatedAt: new Date("2026-07-22T12:00:00Z"),
      })
      .returning({ id: stories.id });
    if (!story) throw new Error("Failed to create HD-021 fixture");
    storyId = story.id;
    await fetchStore.recordFetch({
      storyId,
      sourceUrl,
      canonicalUrl: sourceUrl,
      status: "pending",
      fetchedAt: new Date("2026-07-22T12:00:00Z"),
      metadata: {
        fetchStatus: "fetched",
        contentType: "text/html",
        byteLength: 1000,
      },
    });
  });

  afterAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    await connection.pool.end();
  });

  it("persists normalized content while preserving fetch metadata", async () => {
    await extractionStore.recordExtraction({
      storyId,
      sourceUrl,
      canonicalUrl: "https://www.example.com/hd-021",
      extractedAt: new Date("2026-07-22T12:01:00Z"),
      extraction: {
        status: "extracted",
        title: "Readable fixture",
        byline: "Ada Example",
        publishedAt: new Date("2026-07-20T14:30:00Z"),
        headings: [{ level: 2, text: "Evidence" }],
        text: "Normalized fixture content.",
        contentHash: "d".repeat(64),
        wordCount: 3,
        characterCount: 27,
        confidenceReasons: [],
      },
    });

    const [stored] = await connection.db
      .select()
      .from(documents)
      .where(eq(documents.storyId, storyId));
    expect(stored).toMatchObject({
      status: "extracted",
      canonicalUrl: "https://www.example.com/hd-021",
      contentHash: "d".repeat(64),
      title: "Readable fixture",
      byline: "Ada Example",
      extractedText: "Normalized fixture content.",
      extractionMetadata: {
        fetchStatus: "fetched",
        contentType: "text/html",
        byteLength: 1000,
        extraction: {
          status: "extracted",
          headings: [{ level: 2, text: "Evidence" }],
          wordCount: 3,
          characterCount: 27,
          confidenceReasons: [],
          extractedAt: "2026-07-22T12:01:00.000Z",
        },
      },
    });

    await extractionStore.recordExtraction({
      storyId,
      sourceUrl,
      canonicalUrl: sourceUrl,
      extractedAt: new Date("2026-07-22T12:02:00Z"),
      extraction: {
        status: "empty",
        title: "Empty fixture",
        byline: null,
        publishedAt: null,
        headings: [],
        text: null,
        contentHash: null,
        wordCount: 0,
        characterCount: 0,
        confidenceReasons: ["normalized_article_was_empty"],
      },
    });
    const [empty] = await connection.db
      .select()
      .from(documents)
      .where(eq(documents.storyId, storyId));
    expect(empty).toMatchObject({
      status: "low_confidence",
      contentHash: null,
      extractedText: null,
      extractionMetadata: {
        extraction: {
          status: "empty",
          confidenceReasons: ["normalized_article_was_empty"],
        },
      },
    });
  });
});
