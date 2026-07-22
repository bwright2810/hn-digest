import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import {
  analysisJobs,
  digestRuns,
  digestRunStories,
  llmUsage,
  stories,
  storySnapshots,
} from "../db/schema";
import { getUsageReport, recordLlmUsage } from "./usage";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-042 usage persistence", () => {
  const database = createDatabase(databaseUrl!);

  afterAll(async () => {
    await database.pool.end();
  });

  it("persists raw usage and reports estimated versus actual cost", async () => {
    const suffix = randomUUID();
    const hnItemId = Date.now();
    const [story] = await database.db
      .insert(stories)
      .values({
        hnItemId,
        title: `Usage test ${suffix}`,
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
        estimatedCostUsd: "0.00400000",
      })
      .returning();

    try {
      await recordLlmUsage(database.db, {
        analysisJobId: job!.id,
        attempt: 1,
        providerRequestId: `response-${suffix}`,
        model: "test-model",
        promptVersion: "prompt-v1",
        usage: {
          inputTokens: 1_000,
          outputTokens: 500,
          cachedReadTokens: 400,
          cacheWriteTokens: 100,
          reasoningTokens: 200,
        },
        estimatedCostUsd: 0.004,
        prices: {
          version: "test-prices-v1",
          currency: "USD",
          inputUsdPerMillionTokens: 2,
          outputUsdPerMillionTokens: 8,
          cachedReadUsdPerMillionTokens: 0.5,
          cacheWriteUsdPerMillionTokens: 2.5,
        },
      });

      const [stored] = await database.db
        .select()
        .from(llmUsage)
        .where(eq(llmUsage.analysisJobId, job!.id));
      expect(stored).toMatchObject({
        inputTokens: 1_000,
        outputTokens: 500,
        cachedReadTokens: 400,
        cacheWriteTokens: 100,
        reasoningTokens: 200,
        estimatedCostUsd: "0.00400000",
        actualCostUsd: "0.00545000",
        priceAssumptions: { version: "test-prices-v1", currency: "USD" },
      });

      await expect(
        getUsageReport(database.db, {
          model: "test-model",
          promptVersion: "prompt-v1",
        }),
      ).resolves.toContainEqual(
        expect.objectContaining({
          storyId: story!.id,
          digestRunId: run!.id,
          attempts: 1,
          estimatedCostUsd: 0.004,
          actualCostUsd: 0.00545,
        }),
      );
    } finally {
      await database.db.delete(digestRuns).where(eq(digestRuns.id, run!.id));
      await database.db.delete(stories).where(eq(stories.id, story!.id));
    }
  });
});
