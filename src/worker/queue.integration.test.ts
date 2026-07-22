import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import {
  analysisJobAttempts,
  analysisJobs,
  digestRuns,
  digestRunStories,
  stories,
  storySnapshots,
} from "../db/schema";
import {
  claimAnalysisJob,
  finishAnalysisJobAttempt,
  extendAnalysisJobLease,
} from "./queue";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-050 PostgreSQL worker queue", () => {
  const database = createDatabase(databaseUrl!);

  afterAll(async () => database.pool.end());

  it("claims once, recovers an expired lease, and fences the stale worker", async () => {
    const suffix = randomUUID();
    const [story] = await database.db
      .insert(stories)
      .values({
        hnItemId: Date.now(),
        title: `Worker test ${suffix}`,
        hnCreatedAt: new Date(),
      })
      .returning();
    const [run] = await database.db
      .insert(digestRuns)
      .values({ trigger: "on_demand", requestedStoryCount: 1 })
      .returning();
    const [snapshot] = await database.db
      .insert(storySnapshots)
      .values({
        digestRunId: run!.id,
        storyId: story!.id,
        rank: 1,
        score: 1,
        commentCount: 0,
        title: story!.title,
        hnCreatedAt: story!.hnCreatedAt,
        metadataHash: "a".repeat(64),
      })
      .returning();
    const [runStory] = await database.db
      .insert(digestRunStories)
      .values({
        digestRunId: run!.id,
        storyId: story!.id,
        storySnapshotId: snapshot!.id,
        rank: 1,
      })
      .returning();
    const [job] = await database.db
      .insert(analysisJobs)
      .values({
        digestRunStoryId: runStory!.id,
        cacheKey: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        selectedCommentHash: "b".repeat(64),
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        model: "test-model",
        reasoningConfig: { effort: "low" },
        estimatedInputTokens: 100,
        maximumOutputTokens: 100,
        estimatedCostUsd: "0.00100000",
      })
      .returning();

    try {
      const start = new Date("2030-01-01T00:00:00Z");
      const [first, competing] = await Promise.all([
        claimAnalysisJob(database.db, {
          workerId: "worker-one",
          leaseMs: 1_000,
          now: start,
        }),
        claimAnalysisJob(database.db, {
          workerId: "worker-two",
          leaseMs: 1_000,
          now: start,
        }),
      ]);
      const initial = first ?? competing;
      expect(initial).not.toBeNull();
      expect([first, competing].filter(Boolean)).toHaveLength(1);

      expect(
        await extendAnalysisJobLease(
          database.db,
          initial!,
          1_000,
          new Date("2030-01-01T00:00:00.500Z"),
        ),
      ).toBe(true);
      const reclaimed = await claimAnalysisJob(database.db, {
        workerId: "worker-three",
        leaseMs: 1_000,
        now: new Date("2030-01-01T00:00:02Z"),
      });
      expect(reclaimed).toMatchObject({ id: job!.id, attempt: 2 });
      expect(
        await finishAnalysisJobAttempt(
          database.db,
          initial!,
          { status: "succeeded" },
          new Date("2030-01-01T00:00:02.100Z"),
        ),
      ).toBe(false);
      expect(
        await finishAnalysisJobAttempt(
          database.db,
          reclaimed!,
          { status: "succeeded" },
          new Date("2030-01-01T00:00:02.200Z"),
        ),
      ).toBe(true);

      const attempts = await database.db
        .select()
        .from(analysisJobAttempts)
        .where(eq(analysisJobAttempts.analysisJobId, job!.id));
      expect(attempts.map(({ status }) => status).sort()).toEqual([
        "abandoned",
        "succeeded",
      ]);
    } finally {
      await database.db.delete(digestRuns).where(eq(digestRuns.id, run!.id));
      await database.db.delete(stories).where(eq(stories.id, story!.id));
    }
  });
});
