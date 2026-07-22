import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { documents, stories } from "../db/schema";

import { PostgresArticleFetchStore } from "./acquisition";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-020 fetch metadata persistence", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresArticleFetchStore(connection.db);
  const storyHnItemId = 91_000_020;
  const sourceUrl = "https://example.com/hd-020";
  let storyId: number;

  beforeAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    const [story] = await connection.db
      .insert(stories)
      .values({
        hnItemId: storyHnItemId,
        title: "HD-020 fixture",
        url: sourceUrl,
        hnCreatedAt: new Date("2026-07-22T12:00:00Z"),
      })
      .returning({ id: stories.id });
    if (!story) throw new Error("Failed to create HD-020 fixture");
    storyId = story.id;
  });

  afterAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    await connection.pool.end();
  });

  it("updates one document record from failure to a successful fetch", async () => {
    await store.recordFetch({
      storyId,
      sourceUrl,
      canonicalUrl: null,
      status: "failed",
      fetchedAt: new Date("2026-07-22T12:00:00Z"),
      metadata: { fetchStatus: "failed", failureCode: "timeout" },
    });
    await store.recordFetch({
      storyId,
      sourceUrl,
      canonicalUrl: "https://www.example.com/hd-020",
      status: "pending",
      fetchedAt: new Date("2026-07-22T13:00:00Z"),
      metadata: {
        fetchStatus: "fetched",
        contentType: "text/html",
        byteLength: 1234,
      },
    });

    const stored = await connection.db
      .select()
      .from(documents)
      .where(eq(documents.storyId, storyId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sourceUrl,
      canonicalUrl: "https://www.example.com/hd-020",
      status: "pending",
      extractionMetadata: {
        fetchStatus: "fetched",
        contentType: "text/html",
        byteLength: 1234,
      },
    });
  });
});
