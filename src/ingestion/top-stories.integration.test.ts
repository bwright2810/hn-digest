import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { digestRuns, storySnapshots, stories } from "../db/schema";

import { PostgresDigestRunStore } from "./top-stories";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-012 top-story persistence", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresDigestRunStore(connection.db);
  const hnItemId = 91_000_012;

  beforeAll(async () => {
    await connection.db
      .delete(stories)
      // This fixture ID is reserved for this test and cascades prior test runs.
      .where(eq(stories.hnItemId, hnItemId));
  });

  afterAll(async () => {
    await connection.db.delete(stories).where(eq(stories.hnItemId, hnItemId));
    await connection.pool.end();
  });

  it("updates a story without changing an earlier run's snapshot", async () => {
    const firstRunId = await store.createRun(1);
    const collectedAt = new Date("2026-07-22T12:00:00Z");
    const baseStory = {
      by: "alice",
      descendants: 10,
      id: hnItemId,
      score: 100,
      time: 1_720_000_000,
      title: "Original title",
      type: "story" as const,
      url: "https://example.com/hd-012",
    };

    await store.saveStory(firstRunId, 1, baseStory, collectedAt);
    await store.finishRun(firstRunId, "complete", collectedAt, null);
    const secondRunId = await store.createRun(1);
    await store.saveStory(
      secondRunId,
      1,
      { ...baseStory, descendants: 15, score: 125, title: "Updated title" },
      new Date("2026-07-22T13:00:00Z"),
    );
    await store.finishRun(
      secondRunId,
      "complete",
      new Date("2026-07-22T13:00:00Z"),
      null,
    );

    const storedStories = await connection.db.select().from(stories);
    const snapshots = await connection.db
      .select()
      .from(storySnapshots)
      .orderBy(storySnapshots.collectedAt);

    expect(
      storedStories.filter((item) => item.hnItemId === hnItemId),
    ).toHaveLength(1);
    expect(
      snapshots
        .filter((snapshot) =>
          [firstRunId, secondRunId].includes(snapshot.digestRunId),
        )
        .map(({ rank, score, title }) => ({ rank, score, title })),
    ).toEqual([
      { rank: 1, score: 100, title: "Original title" },
      { rank: 1, score: 125, title: "Updated title" },
    ]);

    await connection.db
      .delete(digestRuns)
      .where(inArray(digestRuns.id, [firstRunId, secondRunId]));
  });
});
