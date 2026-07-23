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

describe.skipIf(!runDatabaseTests)("HD-090 scheduled story exclusions", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresDigestRunStore(connection.db);
  const fixtureIds = [91_000_090, 91_000_091];
  const runIds: string[] = [];

  afterAll(async () => {
    if (runIds.length > 0) {
      await connection.db
        .delete(digestRuns)
        .where(inArray(digestRuns.id, runIds));
    }
    await connection.db
      .delete(stories)
      .where(inArray(stories.hnItemId, fixtureIds));
    await connection.pool.end();
  });

  it("uses the previous published scheduled run across slots and ignores on-demand and failed runs", async () => {
    const morning = await scheduledRun("2032-07-22T11:00:00Z", "partial");
    await store.saveStory(
      morning,
      1,
      fixtureStory(fixtureIds[0]!),
      new Date("2032-07-22T11:01:00Z"),
    );

    const [onDemand] = await connection.db
      .insert(digestRuns)
      .values({
        trigger: "on_demand",
        requestedStoryCount: 1,
        status: "complete",
      })
      .returning({ id: digestRuns.id });
    runIds.push(onDemand!.id);
    await store.saveStory(
      onDemand!.id,
      1,
      fixtureStory(fixtureIds[1]!),
      new Date("2032-07-22T12:00:00Z"),
    );

    await scheduledRun("2032-07-22T15:00:00Z", "failed");
    const evening = await scheduledRun("2032-07-22T23:00:00Z", "collecting");

    expect(await store.getPreviousScheduledStoryIds(evening)).toEqual([
      fixtureIds[0],
    ]);
    expect(await store.getPreviousScheduledStoryIds(evening)).toEqual([
      fixtureIds[0],
    ]);
    expect(await store.getPreviousScheduledStoryIds(onDemand!.id)).toEqual([]);

    const recordedAt = new Date("2032-07-22T23:01:00Z");
    await store.recordStoryExclusions(evening, [fixtureIds[0]!], recordedAt);
    await store.recordStoryExclusions(evening, [fixtureIds[0]!], recordedAt);
    const recorded = await connection.db.query.digestRuns.findFirst({
      where: eq(digestRuns.id, evening),
    });
    expect(recorded).toMatchObject({
      excludedStoryCount: 1,
      excludedHnItemIds: [fixtureIds[0]],
    });
  });

  async function scheduledRun(
    scheduledFor: string,
    status: "collecting" | "complete" | "partial" | "failed",
  ): Promise<string> {
    const [run] = await connection.db
      .insert(digestRuns)
      .values({
        trigger: "scheduled",
        scheduleKey: `hd-090-${scheduledFor}`,
        scheduledFor: new Date(scheduledFor),
        requestedStoryCount: 2,
        status,
      })
      .returning({ id: digestRuns.id });
    runIds.push(run!.id);
    return run!.id;
  }
});

function fixtureStory(id: number) {
  return {
    by: "hd-090",
    descendants: 12,
    id,
    score: 100,
    time: 1_972_000_000,
    title: `HD-090 story ${id}`,
    type: "story" as const,
    url: `https://example.com/hd-090/${id}`,
  };
}
