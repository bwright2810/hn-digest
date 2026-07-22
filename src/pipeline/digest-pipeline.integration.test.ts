import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnalysisOutput } from "../analysis/contract";
import type { OpenAIAnalysisClient } from "../analysis/openai-client";
import { loadConfig } from "../config/server";
import { createDatabase } from "../db/client";
import {
  analysisJobs,
  digestRuns,
  digestRunStories,
  discussionAnalyses,
  llmUsage,
} from "../db/schema";
import type { HackerNewsClient } from "../hn/client";
import type { HackerNewsStory } from "../hn/schemas";
import { AnalysisWorker } from "../worker/runner";
import { DigestPipeline } from "./digest-pipeline";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("DigestPipeline", () => {
  const connection = createDatabase(databaseUrl!);
  const story: HackerNewsStory = {
    id: 44_000_001,
    type: "story",
    by: "author",
    time: 1_750_000_000,
    title: "A deterministic test story",
    text: "This text post explains a small but important systems idea.",
    score: 100,
    descendants: 1,
    kids: [44_000_002],
    deleted: false,
    dead: false,
  };

  beforeAll(async () => {
    await connection.db.delete(llmUsage);
    await connection.db.delete(discussionAnalyses);
    await connection.db.delete(analysisJobs);
    await connection.db.delete(digestRunStories);
    await connection.db.delete(digestRuns);
  });

  afterAll(async () => connection.pool.end());

  it("collects, queues, analyzes, persists usage, and reuses unchanged work", async () => {
    let providerCalls = 0;
    const hnClient = {
      getTopStoryIds: async () => [story.id],
      getItems: async () => [story],
      getItem: async () => story,
      getCommentDescendants: async () => ({
        comments: [
          {
            id: 44_000_002,
            type: "comment" as const,
            by: "commenter",
            time: 1_750_000_100,
            parent: story.id,
            text: "The strongest implication is operational simplicity.",
            deleted: false,
            dead: false,
          },
        ],
        unavailableComments: [],
        unavailableItemIds: [],
        failures: [],
      }),
    } as unknown as HackerNewsClient;
    const output = analysisOutput();
    const openaiClient = {
      analyze: async () => {
        providerCalls += 1;
        return {
          kind: "completed" as const,
          responseId: `response-${providerCalls}`,
          model: "gpt-5.6-luna",
          usage: {
            inputTokens: 500,
            outputTokens: 200,
            cachedReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 50,
          },
          output,
        };
      },
    } as unknown as OpenAIAnalysisClient;
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      OPENAI_API_KEY: "test-only",
      DIGEST_STORY_COUNT: "1",
    });
    const pipeline = new DigestPipeline(connection.db, config, {
      hnClient,
      openaiClient,
    });

    const firstRunId = await createPendingRun();
    await pipeline.collectAndEnqueue(firstRunId);
    const [queued] = await connection.db
      .select()
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(eq(digestRunStories.digestRunId, firstRunId));
    expect(queued?.analysis_jobs.status).toBe("queued");
    expect(JSON.stringify(queued?.analysis_jobs.contextMetadata)).not.toContain(
      story.text,
    );

    const worker = new AnalysisWorker(connection.db, {
      workerId: `integration:${randomUUID()}`,
      leaseMs: 60_000,
      llmConcurrency: 1,
      fetchConcurrencyPerHost: 1,
      spendLimits: config.spend,
    });
    expect(
      await worker.processAvailable(
        (claim) => pipeline.processClaimedJob(claim),
        (claim, outcome) => pipeline.finishClaimedJob(claim, outcome),
      ),
    ).toBe(1);
    expect(providerCalls).toBe(1);
    expect(
      (
        await connection.db.query.digestRuns.findFirst({
          where: eq(digestRuns.id, firstRunId),
        })
      )?.status,
    ).toBe("complete");
    expect(await connection.db.select().from(llmUsage)).toHaveLength(1);

    const secondRunId = await createPendingRun();
    await pipeline.collectAndEnqueue(secondRunId);
    const reused = await connection.db
      .select({
        status: analysisJobs.status,
        reusedFrom: analysisJobs.reusedFromAnalysisJobId,
      })
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(eq(digestRunStories.digestRunId, secondRunId));
    expect(reused[0]?.status).toBe("succeeded");
    expect(reused[0]?.reusedFrom).toBeTruthy();
    expect(providerCalls).toBe(1);
    expect(
      (
        await connection.db.query.digestRuns.findFirst({
          where: eq(digestRuns.id, secondRunId),
        })
      )?.status,
    ).toBe("complete");
  });

  async function createPendingRun(): Promise<string> {
    const [run] = await connection.db
      .insert(digestRuns)
      .values({
        trigger: "scheduled",
        scheduleKey: `integration-${randomUUID()}`,
        requestedStoryCount: 1,
      })
      .returning({ id: digestRuns.id });
    return run!.id;
  }
});

function analysisOutput(): AnalysisOutput {
  const discussionClaim = {
    claim: "Commenters value the operational simplicity.",
    supportingCommentIds: [44_000_002],
  };
  return {
    promptVersion: "analysis-prompt-v1",
    schemaVersion: "analysis-schema-v1",
    article: {
      thesis: {
        claim: "The post argues for a simpler system.",
        citations: [{ locator: "text post", sourceUrl: null }],
      },
      keyPoints: [],
      evidence: [],
      limitations: [],
      confidence: "medium",
      sourceQualityNotes: [],
    },
    discussion: {
      consensus: [discussionClaim],
      competingViewpoints: [],
      insightfulComments: [
        {
          commentId: 44_000_002,
          insight: "Operational simplicity is the central implication.",
          whyNotable: "It connects the idea to practice.",
        },
      ],
      unresolvedQuestions: [],
      confidence: "medium",
      sourceQualityNotes: [],
    },
    combinedTakeaway: {
      summary: "A small design choice can materially simplify operations.",
      tensions: [],
      confidence: "medium",
    },
  };
}
