import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  type AnalysisOutput,
} from "../analysis/contract";
import type { HumanizerClient } from "../analysis/humanizer-client";
import {
  HUMANIZER_PROMPT_VERSION,
  HUMANIZER_SCHEMA_VERSION,
} from "../analysis/humanizer-contract";
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
import { PostgresDigestReader } from "../digests/reader";
import type { HackerNewsClient } from "../hn/client";
import type { HackerNewsStory } from "../hn/schemas";
import type { ClaimedAnalysisJob } from "../worker/queue";
import { AnalysisWorker } from "../worker/runner";
import { DigestPipeline } from "./digest-pipeline";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("DigestPipeline", () => {
  const connection = createDatabase(databaseUrl!);
  const storyId = 40_000_000 + Math.floor(Math.random() * 1_000_000);
  const commentId = storyId + 1;
  const story: HackerNewsStory = {
    id: storyId,
    type: "story",
    by: "author",
    time: 1_750_000_000,
    title: "A deterministic test story",
    text: "This text post explains a small but important systems idea.",
    score: 100,
    descendants: 1,
    kids: [commentId],
    deleted: false,
    dead: false,
  };

  afterAll(async () => connection.pool.end());

  it("collects, queues, analyzes, persists usage, and reuses unchanged work", async () => {
    let providerCalls = 0;
    const responsePrefix = randomUUID();
    const hnClient = {
      getTopStoryIds: async () => [story.id],
      getItems: async () => [story],
      getItem: async () => story,
      getCommentDescendants: async () => ({
        comments: [
          {
            id: commentId,
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
    const output = analysisOutput(commentId);
    const openaiClient = {
      analyze: async () => {
        providerCalls += 1;
        return {
          kind: "completed" as const,
          responseId: `${responsePrefix}-${providerCalls}`,
          model: "gpt-5.6-luna",
          usage: {
            inputTokens: 500,
            outputTokens: 200,
            cachedReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 50,
          },
          output:
            providerCalls === 1 ? analysisOutput(commentId + 999) : output,
        };
      },
    } as unknown as OpenAIAnalysisClient;
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      OPENAI_API_KEY: "test-only",
      SUBSCRIBER_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 61).toString("base64"),
      SUBSCRIBER_LOOKUP_HMAC_KEY: Buffer.alloc(32, 67).toString("base64"),
      DIGEST_STORY_COUNT: "1",
      DIGEST_MINIMUM_COMMENT_COUNT: "1",
    });
    const pipeline = new DigestPipeline(connection.db, config, {
      hnClient,
      openaiClient,
    });

    const firstRunId = await createPendingRun();
    const claims = await Promise.all([
      pipeline.processNextRun(),
      pipeline.processNextRun(),
    ]);
    expect(claims.filter(Boolean)).toEqual([firstRunId]);
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
        await connection.db.query.analysisJobs.findFirst({
          where: eq(analysisJobs.id, queued!.analysis_jobs.id),
        })
      )?.status,
    ).toBe("queued");
    expect(
      await worker.processAvailable(
        (claim) => pipeline.processClaimedJob(claim),
        (claim, outcome) => pipeline.finishClaimedJob(claim, outcome),
      ),
    ).toBe(1);
    expect(providerCalls).toBe(2);
    expect(
      await connection.db.query.digestRuns.findFirst({
        columns: { status: true, newsletterReadyAt: true },
        where: eq(digestRuns.id, firstRunId),
      }),
    ).toMatchObject({
      status: "complete",
      newsletterReadyAt: expect.any(Date),
    });
    expect(
      await connection.db
        .select()
        .from(llmUsage)
        .where(eq(llmUsage.analysisJobId, queued!.analysis_jobs.id)),
    ).toHaveLength(2);

    const secondRunId = await createPendingRun("on_demand");
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
    expect(providerCalls).toBe(2);
    expect(
      await connection.db.query.digestRuns.findFirst({
        columns: { status: true, newsletterReadyAt: true },
        where: eq(digestRuns.id, secondRunId),
      }),
    ).toEqual({ status: "complete", newsletterReadyAt: null });
  });

  it("humanizes displayed prose while preserving citations and comment IDs, and only runs once per run", async () => {
    const fixture = makeHnFixture();
    const openaiClient = {
      analyze: async () => ({
        kind: "completed" as const,
        responseId: `analysis-${randomUUID()}`,
        model: "gpt-5.6-luna",
        usage: {
          inputTokens: 500,
          outputTokens: 200,
          cachedReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 50,
        },
        output: analysisOutput(fixture.commentId),
      }),
    } as unknown as OpenAIAnalysisClient;
    let humanizerCalls = 0;
    const humanizerClient = {
      humanize: async (request: { storyIds: readonly string[] }) => {
        humanizerCalls += 1;
        return {
          kind: "completed" as const,
          responseId: `humanizer-${randomUUID()}`,
          model: "gpt-5.6-luna",
          usage: {
            inputTokens: 80,
            outputTokens: 40,
            cachedReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          },
          output: {
            promptVersion: HUMANIZER_PROMPT_VERSION,
            schemaVersion: HUMANIZER_SCHEMA_VERSION,
            stories: request.storyIds.map((storyId) => ({
              storyId,
              article: "Rewritten article claim.",
              discussion: "Rewritten discussion claim.",
              takeaway: "Rewritten takeaway.",
            })),
          },
        };
      },
    } as unknown as HumanizerClient;
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      OPENAI_API_KEY: "test-only",
      SUBSCRIBER_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 61).toString("base64"),
      SUBSCRIBER_LOOKUP_HMAC_KEY: Buffer.alloc(32, 67).toString("base64"),
      DIGEST_STORY_COUNT: "1",
      DIGEST_MINIMUM_COMMENT_COUNT: "1",
      HUMANIZER_ENABLED: "true",
    });
    const pipeline = new DigestPipeline(connection.db, config, {
      hnClient: fixture.hnClient,
      openaiClient,
      humanizerClient,
    });

    const runId = await createPendingRun();
    await pipeline.processNextRun();
    const [queued] = await connection.db
      .select()
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(eq(digestRunStories.digestRunId, runId));
    const worker = new AnalysisWorker(connection.db, {
      workerId: `integration:${randomUUID()}`,
      leaseMs: 60_000,
      llmConcurrency: 1,
      fetchConcurrencyPerHost: 1,
      spendLimits: config.spend,
    });
    await worker.processAvailable(
      (claim) => pipeline.processClaimedJob(claim),
      (claim, outcome) => pipeline.finishClaimedJob(claim, outcome),
    );

    expect(humanizerCalls).toBe(1);
    const run = await connection.db.query.digestRuns.findFirst({
      columns: { status: true, humanizedAt: true },
      where: eq(digestRuns.id, runId),
    });
    expect(run).toMatchObject({ status: "complete" });
    expect(run?.humanizedAt).toBeInstanceOf(Date);

    const stored = await connection.db.query.discussionAnalyses.findFirst({
      columns: { result: true, humanizedResult: true },
      where: eq(discussionAnalyses.analysisJobId, queued!.analysis_jobs.id),
    });
    const original = analysisOutput(fixture.commentId);
    const humanized = stored?.humanizedResult as AnalysisOutput | undefined;
    expect(humanized?.article.thesis?.claim).toBe("Rewritten article claim.");
    expect(humanized?.discussion.consensus[0]?.claim).toBe(
      "Rewritten discussion claim.",
    );
    expect(humanized?.combinedTakeaway.summary).toBe("Rewritten takeaway.");
    // Citations and comment IDs are byte-identical to the original.
    expect(humanized?.article.thesis?.citations).toEqual(
      original.article.thesis?.citations,
    );
    expect(humanized?.discussion.consensus[0]?.supportingCommentIds).toEqual(
      original.discussion.consensus[0]?.supportingCommentIds,
    );
    expect(humanized?.discussion.insightfulComments).toEqual(
      original.discussion.insightfulComments,
    );

    // The reader serves the humanized text.
    const reader = new PostgresDigestReader(connection.db);
    const view = await reader.byId(runId);
    expect(view?.stories[0]?.analysis?.combinedTakeaway.summary).toBe(
      "Rewritten takeaway.",
    );

    // Re-triggering reconcileRun for an already-humanized run must not call
    // the humanizer again.
    const fakeClaim: ClaimedAnalysisJob = {
      id: queued!.analysis_jobs.id,
      attempt: 1,
      workerId: "integration-test",
      leasedUntil: new Date(),
    };
    await pipeline.finishClaimedJob(fakeClaim, { status: "succeeded" });
    expect(humanizerCalls).toBe(1);
  });

  it("completes normally with the original text when the humanizer fails", async () => {
    const fixture = makeHnFixture();
    const openaiClient = {
      analyze: async () => ({
        kind: "completed" as const,
        responseId: `analysis-${randomUUID()}`,
        model: "gpt-5.6-luna",
        usage: {
          inputTokens: 500,
          outputTokens: 200,
          cachedReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 50,
        },
        output: analysisOutput(fixture.commentId),
      }),
    } as unknown as OpenAIAnalysisClient;
    const humanizerClient = {
      humanize: async () => {
        throw new Error("network exhausted");
      },
    } as unknown as HumanizerClient;
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      OPENAI_API_KEY: "test-only",
      SUBSCRIBER_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 61).toString("base64"),
      SUBSCRIBER_LOOKUP_HMAC_KEY: Buffer.alloc(32, 67).toString("base64"),
      DIGEST_STORY_COUNT: "1",
      DIGEST_MINIMUM_COMMENT_COUNT: "1",
      HUMANIZER_ENABLED: "true",
    });
    const pipeline = new DigestPipeline(connection.db, config, {
      hnClient: fixture.hnClient,
      openaiClient,
      humanizerClient,
    });

    const runId = await createPendingRun();
    await pipeline.processNextRun();
    const worker = new AnalysisWorker(connection.db, {
      workerId: `integration:${randomUUID()}`,
      leaseMs: 60_000,
      llmConcurrency: 1,
      fetchConcurrencyPerHost: 1,
      spendLimits: config.spend,
    });
    await worker.processAvailable(
      (claim) => pipeline.processClaimedJob(claim),
      (claim, outcome) => pipeline.finishClaimedJob(claim, outcome),
    );

    const run = await connection.db.query.digestRuns.findFirst({
      columns: { status: true, newsletterReadyAt: true, humanizedAt: true },
      where: eq(digestRuns.id, runId),
    });
    expect(run).toMatchObject({
      status: "complete",
      newsletterReadyAt: expect.any(Date),
    });
    // A thrown error never reaches the humanizedAt write, so a later
    // reconcile can try again once the transient failure clears.
    expect(run?.humanizedAt).toBeNull();

    const reader = new PostgresDigestReader(connection.db);
    const view = await reader.byId(runId);
    expect(view?.stories[0]?.analysis?.combinedTakeaway.summary).toBe(
      analysisOutput(fixture.commentId).combinedTakeaway.summary,
    );
  });

  function makeHnFixture(): {
    readonly hnClient: HackerNewsClient;
    readonly commentId: number;
  } {
    const fixtureStoryId = 40_000_000 + Math.floor(Math.random() * 1_000_000);
    const fixtureCommentId = fixtureStoryId + 1;
    const fixtureStory: HackerNewsStory = {
      id: fixtureStoryId,
      type: "story",
      by: "author",
      time: 1_750_000_000,
      title: "A deterministic humanizer test story",
      text: "This text post explains a small but important systems idea.",
      score: 100,
      descendants: 1,
      kids: [fixtureCommentId],
      deleted: false,
      dead: false,
    };
    return {
      commentId: fixtureCommentId,
      hnClient: {
        getTopStoryIds: async () => [fixtureStory.id],
        getItems: async () => [fixtureStory],
        getItem: async () => fixtureStory,
        getCommentDescendants: async () => ({
          comments: [
            {
              id: fixtureCommentId,
              type: "comment" as const,
              by: "commenter",
              time: 1_750_000_100,
              parent: fixtureStory.id,
              text: "The strongest implication is operational simplicity.",
              deleted: false,
              dead: false,
            },
          ],
          unavailableComments: [],
          unavailableItemIds: [],
          failures: [],
        }),
      } as unknown as HackerNewsClient,
    };
  }

  async function createPendingRun(
    trigger: "scheduled" | "on_demand" = "scheduled",
  ): Promise<string> {
    const [run] = await connection.db
      .insert(digestRuns)
      .values({
        trigger,
        scheduleKey:
          trigger === "scheduled" ? `integration-${randomUUID()}` : null,
        scheduledFor: trigger === "scheduled" ? new Date() : null,
        requestedStoryCount: 1,
      })
      .returning({ id: digestRuns.id });
    return run!.id;
  }
});

function analysisOutput(commentId: number): AnalysisOutput {
  const discussionClaim = {
    claim: "Commenters value the operational simplicity.",
    supportingCommentIds: [commentId],
  };
  return {
    promptVersion: ANALYSIS_PROMPT_VERSION,
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
          commentId,
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
