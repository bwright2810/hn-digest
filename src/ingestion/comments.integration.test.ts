import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { comments, stories } from "../db/schema";

import { PostgresCommentStore } from "./comments";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-013 comment persistence", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresCommentStore(connection.db);
  const storyHnItemId = 91_000_013;
  const commentIds = [91_100_013, 91_100_014];

  beforeAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    await connection.db.insert(stories).values({
      hnItemId: storyHnItemId,
      title: "HD-013 fixture",
      hnCreatedAt: new Date("2026-07-22T12:00:00Z"),
    });
  });

  afterAll(async () => {
    await connection.db
      .delete(stories)
      .where(eq(stories.hnItemId, storyHnItemId));
    await connection.pool.end();
  });

  it("updates changed comments, reuses rows, and links the tree", async () => {
    const firstFetch = new Date("2026-07-22T12:00:00Z");
    const base = {
      parentHnItemId: storyHnItemId,
      author: "bob",
      text: "Original",
      contentHash: "a".repeat(64),
      isDeleted: false,
      isDead: false,
      hnCreatedAt: firstFetch,
    };
    await store.saveComments({
      storyHnItemId,
      fetchedAt: firstFetch,
      comments: [
        { ...base, hnItemId: commentIds[0] },
        {
          ...base,
          hnItemId: commentIds[1],
          parentHnItemId: commentIds[0],
          text: "Child",
          contentHash: "b".repeat(64),
        },
      ],
    });
    await store.saveComments({
      storyHnItemId,
      fetchedAt: new Date("2026-07-22T13:00:00Z"),
      comments: [
        {
          ...base,
          hnItemId: commentIds[0],
          text: "Updated",
          contentHash: "c".repeat(64),
        },
        {
          ...base,
          hnItemId: commentIds[1],
          parentHnItemId: commentIds[0],
          author: null,
          text: null,
          contentHash: null,
          isDeleted: true,
          hnCreatedAt: null,
        },
      ],
    });

    const stored = await connection.db
      .select()
      .from(comments)
      .where(inArray(comments.hnItemId, commentIds));
    const parent = stored.find(({ hnItemId }) => hnItemId === commentIds[0]);
    const child = stored.find(({ hnItemId }) => hnItemId === commentIds[1]);

    expect(stored).toHaveLength(2);
    expect(parent).toMatchObject({
      text: "Updated",
      contentHash: "c".repeat(64),
    });
    expect(child).toMatchObject({
      parentCommentId: parent?.id,
      text: null,
      contentHash: null,
      isDeleted: true,
    });
  });
});
