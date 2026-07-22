import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { documents, stories } from "../db/schema";

import { PostgresTextPostDocumentStore } from "./text-post";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-022 text-post persistence", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresTextPostDocumentStore(connection.db);
  const storyHnItemId = 91_000_022;
  let storyId: number;

  beforeAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    const [story] = await connection.db
      .insert(stories)
      .values({
        hnItemId: storyHnItemId,
        title: "HD-022 text fixture",
        hnCreatedAt: new Date("2026-07-22T12:00:00Z"),
      })
      .returning({ id: stories.id });
    if (!story) throw new Error("Failed to create HD-022 fixture");
    storyId = story.id;
  });

  afterAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    await connection.pool.end();
  });

  it("stores normalized HN text as an extracted document", async () => {
    await store.recordTextPost({
      storyId,
      hnItemId: storyHnItemId,
      title: "HD-022 text fixture",
      text: "A normalized text post.",
      contentHash: "a".repeat(64),
      recordedAt: new Date("2026-07-22T12:00:00Z"),
    });

    const stored = await connection.db
      .select()
      .from(documents)
      .where(eq(documents.storyId, storyId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sourceUrl: `https://news.ycombinator.com/item?id=${storyHnItemId}`,
      status: "extracted",
      contentHash: "a".repeat(64),
      extractedText: "A normalized text post.",
      extractionMetadata: {
        sourceType: "hn_text_post",
        wordCount: 4,
        characterCount: 23,
      },
    });
  });
});
