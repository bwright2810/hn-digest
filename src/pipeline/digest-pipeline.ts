import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";

import {
  type AnalysisCacheComponents,
  createAnalysisCacheKeys,
  resolveAnalysisCache,
} from "../analysis/cache";
import {
  instructionsForCitationAttempt,
  InvalidCommentCitationError,
} from "../analysis/citations";
import {
  ANALYSIS_PROMPT,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  analysisOutputJsonSchema,
  type AnalysisOutput,
} from "../analysis/contract";
import {
  OpenAIAnalysisClient,
  type AnalysisResponseOutcome,
} from "../analysis/openai-client";
import {
  assembleAnalysisRequest,
  type AssembledAnalysisRequest,
} from "../analysis/request";
import {
  LLM_PRICE_ASSUMPTIONS_VERSION,
  recordLlmUsage,
  type LlmPriceAssumptions,
} from "../analysis/usage";
import {
  acquireArticle,
  PostgresArticleFetchStore,
} from "../articles/acquisition";
import {
  extractArticle,
  PostgresArticleExtractionStore,
} from "../articles/extraction";
import { ArticleExtractor } from "../articles/extractor";
import { ArticleFetcher } from "../articles/fetcher";
import { selectArticleContext } from "../articles/selection";
import {
  acquireTextPost,
  PostgresTextPostDocumentStore,
} from "../articles/text-post";
import { selectComments } from "../comments/ranking";
import type { AppConfig } from "../config/server";
import type { createDatabase } from "../db/client";
import {
  analysisJobs,
  articleAnalyses,
  comments,
  digestRuns,
  digestRunStories,
  discussionAnalyses,
  documents,
  stories,
} from "../db/schema";
import { HackerNewsClient } from "../hn/client";
import type { HackerNewsStory } from "../hn/schemas";
import {
  ingestStoryComments,
  PostgresCommentStore,
} from "../ingestion/comments";
import {
  ingestTopStories,
  PostgresDigestRunStore,
} from "../ingestion/top-stories";
import type { ClaimedAnalysisJob, AttemptOutcome } from "../worker/queue";

type Database = ReturnType<typeof createDatabase>["db"];

const COLLECTION_LEASE_MS = 5 * 60 * 1_000;

interface StoredJobContext {
  readonly selectedCommentIds: number[];
  readonly articleTruncated: boolean;
  readonly discussionOnly: boolean;
}

export interface DigestPipelineDependencies {
  readonly hnClient?: HackerNewsClient;
  readonly openaiClient?: OpenAIAnalysisClient;
}

export class DigestPipeline {
  private readonly hnClient: HackerNewsClient;
  private readonly openaiClient: OpenAIAnalysisClient;
  private readonly prices: LlmPriceAssumptions;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    dependencies: DigestPipelineDependencies = {},
  ) {
    this.hnClient = dependencies.hnClient ?? new HackerNewsClient();
    this.openaiClient =
      dependencies.openaiClient ??
      new OpenAIAnalysisClient({
        ...config.openai,
        logger: {
          info: (event) => console.log(JSON.stringify(event)),
          warn: (event) => console.error(JSON.stringify(event)),
        },
      });
    this.prices = {
      version: LLM_PRICE_ASSUMPTIONS_VERSION,
      currency: "USD",
      ...config.openai.prices,
    };
  }

  async processNextRun(): Promise<string | null> {
    const staleBefore = new Date(Date.now() - COLLECTION_LEASE_MS);
    const [run] = await this.db
      .select({
        id: digestRuns.id,
        status: digestRuns.status,
      })
      .from(digestRuns)
      .where(
        or(
          eq(digestRuns.status, "pending"),
          and(
            eq(digestRuns.status, "collecting"),
            lt(digestRuns.updatedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(digestRuns.createdAt))
      .limit(1);
    if (!run) return null;

    const [claimed] = await this.db
      .update(digestRuns)
      .set({ status: "collecting", updatedAt: new Date() })
      .where(
        and(
          eq(digestRuns.id, run.id),
          run.status === "pending"
            ? eq(digestRuns.status, "pending")
            : and(
                eq(digestRuns.status, "collecting"),
                lt(digestRuns.updatedAt, staleBefore),
              ),
        ),
      )
      .returning({ id: digestRuns.id });
    if (!claimed) return null;

    await this.collectAndEnqueue(run.id);
    return run.id;
  }

  async collectAndEnqueue(runId: string): Promise<void> {
    const run = await this.db.query.digestRuns.findFirst({
      columns: { requestedStoryCount: true, status: true },
      where: eq(digestRuns.id, runId),
    });
    if (!run) throw new Error("Digest run not found");

    if (run.status === "pending" || run.status === "collecting") {
      try {
        await ingestTopStories({
          storyCount: run.requestedStoryCount,
          minimumCommentCount: this.config.stories.minimumCommentCount,
          existingRunId: runId,
          client: this.hnClient,
          store: new PostgresDigestRunStore(this.db, true),
        });
      } catch (error) {
        await this.failRun(runId, classifyError(error));
        return;
      }
    }

    const runStories = await this.db
      .select({ id: digestRunStories.id })
      .from(digestRunStories)
      .where(eq(digestRunStories.digestRunId, runId))
      .orderBy(asc(digestRunStories.rank));

    for (const runStory of runStories) {
      const existing = await this.db.query.analysisJobs.findFirst({
        columns: { id: true },
        where: eq(analysisJobs.digestRunStoryId, runStory.id),
      });
      if (existing) continue;
      try {
        await this.prepareStory(runStory.id);
      } catch (error) {
        const errorCode = classifyError(error);
        console.error(
          JSON.stringify({
            event: "digest_story_preparation_failed",
            runId,
            digestRunStoryId: runStory.id,
            errorCode,
          }),
        );
        await this.db
          .update(digestRunStories)
          .set({
            status: "failed",
            failureCode: errorCode,
            updatedAt: new Date(),
          })
          .where(eq(digestRunStories.id, runStory.id));
      }
    }
    await this.reconcileRun(runId);
  }

  async processClaimedJob(claim: ClaimedAnalysisJob): Promise<AttemptOutcome> {
    const alreadyPersisted = await this.db.query.discussionAnalyses.findFirst({
      columns: { id: true },
      where: eq(discussionAnalyses.analysisJobId, claim.id),
    });
    if (alreadyPersisted) return { status: "succeeded" };
    const reconstructed = await this.reconstructRequest(claim.id);
    const request = {
      ...reconstructed,
      instructions: instructionsForCitationAttempt(
        reconstructed.instructions,
        claim.attempt,
      ),
    };
    const outcome = await this.openaiClient.analyze(request);
    await this.recordUsage(claim, outcome);

    if (outcome.kind === "refusal") {
      return { status: "refused", errorCode: "model_refusal" };
    }
    if (outcome.kind === "incomplete") {
      return { status: "incomplete", errorCode: safeCode(outcome.reason) };
    }
    if (outcome.kind === "failed") {
      return { status: "failed", errorCode: safeCode(outcome.code) };
    }

    await this.persistAnalysis(claim.id, outcome.output);
    return { status: "succeeded" };
  }

  async finishClaimedJob(
    claim: ClaimedAnalysisJob,
    outcome: AttemptOutcome,
  ): Promise<void> {
    if (outcome.status === "retry") return;
    const [job] = await this.db
      .select({
        digestRunStoryId: analysisJobs.digestRunStoryId,
        digestRunId: digestRunStories.digestRunId,
      })
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(eq(analysisJobs.id, claim.id))
      .limit(1);
    if (!job) return;

    if (outcome.status !== "succeeded") {
      await this.db
        .update(digestRunStories)
        .set({
          status: "failed",
          failureCode: outcome.errorCode,
          updatedAt: new Date(),
        })
        .where(eq(digestRunStories.id, job.digestRunStoryId));
    }
    await this.reconcileRun(job.digestRunId);
  }

  private async prepareStory(digestRunStoryId: string): Promise<void> {
    await this.db
      .update(digestRunStories)
      .set({ status: "collecting", failureCode: null, updatedAt: new Date() })
      .where(eq(digestRunStories.id, digestRunStoryId));

    const [record] = await this.db
      .select({
        storyId: stories.id,
        hnItemId: stories.hnItemId,
        title: stories.title,
        url: stories.url,
        text: stories.text,
      })
      .from(digestRunStories)
      .innerJoin(stories, eq(digestRunStories.storyId, stories.id))
      .where(eq(digestRunStories.id, digestRunStoryId))
      .limit(1);
    if (!record) throw new Error("Digest story not found");

    const item = await this.hnClient.getItem(record.hnItemId);
    if (!isAvailableStory(item)) throw new Error("HN story unavailable");
    await ingestStoryComments({
      story: item,
      client: this.hnClient,
      store: new PostgresCommentStore(this.db),
    });

    let discussionOnly = false;
    if (record.url) {
      const acquired = await acquireArticle({
        storyId: record.storyId,
        sourceUrl: record.url,
        fetcher: new ArticleFetcher({
          timeoutMs: this.config.articleFetch.timeoutMs,
          maximumBytes: this.config.articleFetch.maximumBytes,
          maximumRedirects: this.config.articleFetch.maximumRedirects,
        }),
        store: new PostgresArticleFetchStore(this.db),
      });
      if (acquired.status === "fetched") {
        await extractArticle({
          storyId: record.storyId,
          fetched: acquired.result,
          extractor: new ArticleExtractor(),
          store: new PostgresArticleExtractionStore(this.db),
        });
      } else discussionOnly = true;
    } else {
      const acquired = await acquireTextPost({
        storyId: record.storyId,
        hnItemId: record.hnItemId,
        title: record.title,
        html: record.text ?? undefined,
        store: new PostgresTextPostDocumentStore(this.db),
      });
      discussionOnly = acquired.status !== "extracted";
    }

    const [document] = await this.db
      .select({
        id: documents.id,
        contentHash: documents.contentHash,
        text: documents.extractedText,
      })
      .from(documents)
      .where(
        and(
          eq(documents.storyId, record.storyId),
          inArray(documents.status, ["extracted", "low_confidence"]),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(1);
    if (!hasArticleContent(document)) discussionOnly = true;

    const storedComments = await this.db
      .select({
        hnItemId: comments.hnItemId,
        parentHnItemId: comments.parentHnItemId,
        author: comments.author,
        text: comments.text,
        isDeleted: comments.isDeleted,
        isDead: comments.isDead,
      })
      .from(comments)
      .where(eq(comments.storyId, record.storyId));
    const selection = selectComments(
      storedComments.filter(
        (comment): comment is typeof comment & { parentHnItemId: number } =>
          comment.parentHnItemId !== null,
      ),
      {
        maximumComments: this.config.analysis.maximumSelectedComments,
      },
    );
    const article = selectArticleContext(document?.text ?? null, {
      maximumTokens: this.config.tokens.article,
      countTokens: estimateTokens,
    });
    const selectedCommentHash = hashJson(
      selection.selected.map(({ hnItemId, parentHnItemId, author, text }) => ({
        hnItemId,
        parentHnItemId,
        author,
        text,
      })),
    );
    const components = {
      articleContentHash: document?.contentHash ?? null,
      selectedCommentHash,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      model: this.config.openai.model,
      reasoningConfig: { effort: this.config.openai.reasoningEffort },
    } as const;
    const cache = await resolveAnalysisCache(
      this.db,
      record.storyId,
      components,
    );
    const request = this.assembleRequest({
      storyHnItemId: record.hnItemId,
      title: record.title,
      url: record.url,
      articleText: article.text,
      articleTruncated: article.metadata.truncated,
      comments: selection.selected,
    });
    const context: StoredJobContext = {
      selectedCommentIds: [...request.selectedCommentIds],
      articleTruncated: article.metadata.truncated,
      discussionOnly,
    };

    if (!cache.shouldSubmitRequest && cache.analysisJobId) {
      await this.reuseAnalysis({
        sourceJobId: cache.analysisJobId,
        digestRunStoryId,
        documentId: document?.id ?? null,
        cacheKey: cache.keys.analysis,
        components,
        request,
        context,
      });
      return;
    }

    await this.db.insert(analysisJobs).values({
      digestRunStoryId,
      documentId: document?.id ?? null,
      cacheKey: cache.keys.analysis,
      ...components,
      reasoningConfig: { ...components.reasoningConfig },
      contextMetadata: { ...context },
      estimatedInputTokens: request.tokens.totalInput,
      maximumOutputTokens: request.tokens.maximumOutput,
      estimatedCostUsd: request.cost.maximumRequestCostUsd.toFixed(8),
    });
    await this.db
      .update(digestRunStories)
      .set({ status: "analyzing", updatedAt: new Date() })
      .where(eq(digestRunStories.id, digestRunStoryId));
  }

  private async reconstructRequest(
    jobId: string,
  ): Promise<AssembledAnalysisRequest> {
    const [job] = await this.db
      .select({
        storyHnItemId: stories.hnItemId,
        title: stories.title,
        url: stories.url,
        documentText: documents.extractedText,
        context: analysisJobs.contextMetadata,
      })
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .innerJoin(stories, eq(digestRunStories.storyId, stories.id))
      .leftJoin(documents, eq(analysisJobs.documentId, documents.id))
      .where(eq(analysisJobs.id, jobId))
      .limit(1);
    if (!job) throw new Error("Analysis job not found");
    const context = parseContext(job.context);
    const selected =
      context.selectedCommentIds.length === 0
        ? []
        : await this.db
            .select({
              hnItemId: comments.hnItemId,
              parentHnItemId: comments.parentHnItemId,
              author: comments.author,
              text: comments.text,
            })
            .from(comments)
            .where(inArray(comments.hnItemId, context.selectedCommentIds));
    const byId = new Map(
      selected.map((comment) => [comment.hnItemId, comment]),
    );
    const ordered = context.selectedCommentIds
      .map((id) => byId.get(id))
      .filter(isDefined);
    if (ordered.length !== context.selectedCommentIds.length) {
      throw new Error("Selected comment context is incomplete");
    }
    const article = selectArticleContext(job.documentText ?? null, {
      maximumTokens: this.config.tokens.article,
      countTokens: estimateTokens,
    });
    return this.assembleRequest({
      storyHnItemId: job.storyHnItemId,
      title: job.title,
      url: job.url,
      articleText: article.text,
      articleTruncated: context.articleTruncated,
      comments: ordered.map((comment) => ({
        ...comment,
        parentHnItemId: comment.parentHnItemId ?? job.storyHnItemId,
        text: comment.text ?? "",
      })),
    });
  }

  private assembleRequest(
    source: Parameters<typeof assembleAnalysisRequest>[0]["source"],
  ) {
    return assembleAnalysisRequest({
      instructions: ANALYSIS_PROMPT,
      outputSchema: analysisOutputJsonSchema,
      source,
      tokenLimits: this.config.tokens,
      pricing: {
        inputUsdPerMillionTokens: this.prices.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: this.prices.outputUsdPerMillionTokens,
        maximumRequestCostUsd: this.config.analysis.maximumRequestCostUsd,
      },
      countTokens: estimateTokens,
    });
  }

  private async persistAnalysis(
    jobId: string,
    output: AnalysisOutput,
  ): Promise<void> {
    const [job] = await this.db
      .select({
        digestRunStoryId: analysisJobs.digestRunStoryId,
        storyId: digestRunStories.storyId,
        documentId: analysisJobs.documentId,
        articleContentHash: analysisJobs.articleContentHash,
        selectedCommentHash: analysisJobs.selectedCommentHash,
        context: analysisJobs.contextMetadata,
      })
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(eq(analysisJobs.id, jobId))
      .limit(1);
    if (!job) throw new Error("Analysis job not found");
    const context = parseContext(job.context);
    validateCitations(output, new Set(context.selectedCommentIds));
    const keys = createAnalysisCacheKeys({
      articleContentHash: job.articleContentHash,
      selectedCommentHash: job.selectedCommentHash,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      model: this.config.openai.model,
      reasoningConfig: { effort: this.config.openai.reasoningEffort },
    });

    await this.db.transaction(async (transaction) => {
      if (job.documentId && job.articleContentHash && keys.article) {
        await transaction.insert(articleAnalyses).values({
          analysisJobId: jobId,
          documentId: job.documentId,
          cacheKey: keys.article,
          contentHash: job.articleContentHash,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          model: this.config.openai.model,
          result: {
            promptVersion: output.promptVersion,
            schemaVersion: output.schemaVersion,
            article: output.article,
            combinedTakeaway: output.combinedTakeaway,
          },
        });
      }
      await transaction.insert(discussionAnalyses).values({
        analysisJobId: jobId,
        storyId: job.storyId,
        cacheKey: keys.discussion,
        selectedCommentHash: job.selectedCommentHash,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        model: this.config.openai.model,
        result: { ...output },
        citedCommentIds: citedCommentIds(output),
      });
      await transaction
        .update(digestRunStories)
        .set({
          status: context.discussionOnly ? "discussion_only" : "complete",
          failureCode: null,
          updatedAt: new Date(),
        })
        .where(eq(digestRunStories.id, job.digestRunStoryId));
    });
  }

  private async reuseAnalysis(options: {
    sourceJobId: string;
    digestRunStoryId: string;
    documentId: string | null;
    cacheKey: string;
    components: AnalysisCacheComponents;
    request: AssembledAnalysisRequest;
    context: StoredJobContext;
  }): Promise<void> {
    const [article, discussion] = await Promise.all([
      this.db.query.articleAnalyses.findFirst({
        where: eq(articleAnalyses.analysisJobId, options.sourceJobId),
      }),
      this.db.query.discussionAnalyses.findFirst({
        where: eq(discussionAnalyses.analysisJobId, options.sourceJobId),
      }),
    ]);
    if (!discussion) throw new Error("Cached discussion analysis is missing");
    await this.db.transaction(async (transaction) => {
      const [job] = await transaction
        .insert(analysisJobs)
        .values({
          digestRunStoryId: options.digestRunStoryId,
          documentId: options.documentId,
          reusedFromAnalysisJobId: options.sourceJobId,
          cacheKey: options.cacheKey,
          ...options.components,
          reasoningConfig: { ...options.components.reasoningConfig },
          contextMetadata: { ...options.context },
          status: "succeeded",
          estimatedInputTokens: options.request.tokens.totalInput,
          maximumOutputTokens: options.request.tokens.maximumOutput,
          estimatedCostUsd: "0",
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: analysisJobs.id });
      if (!job) throw new Error("Failed to record cache reuse");
      if (article && options.documentId) {
        await transaction.insert(articleAnalyses).values({
          ...article,
          id: undefined,
          analysisJobId: job.id,
          documentId: options.documentId,
          createdAt: new Date(),
        });
      }
      await transaction.insert(discussionAnalyses).values({
        ...discussion,
        id: undefined,
        analysisJobId: job.id,
        createdAt: new Date(),
      });
      await transaction
        .update(digestRunStories)
        .set({
          status: options.context.discussionOnly
            ? "discussion_only"
            : "complete",
          failureCode: null,
          updatedAt: new Date(),
        })
        .where(eq(digestRunStories.id, options.digestRunStoryId));
    });
  }

  private async recordUsage(
    claim: ClaimedAnalysisJob,
    outcome: AnalysisResponseOutcome,
  ): Promise<void> {
    if (!outcome.usage) return;
    const job = await this.db.query.analysisJobs.findFirst({
      columns: { estimatedCostUsd: true, promptVersion: true },
      where: eq(analysisJobs.id, claim.id),
    });
    if (!job) throw new Error("Analysis job not found");
    await recordLlmUsage(this.db, {
      analysisJobId: claim.id,
      attempt: claim.attempt,
      providerRequestId: outcome.responseId,
      model: outcome.model,
      promptVersion: job.promptVersion,
      usage: outcome.usage,
      estimatedCostUsd: Number(job.estimatedCostUsd),
      prices: this.prices,
    });
  }

  private async reconcileRun(runId: string): Promise<void> {
    const [statuses, run] = await Promise.all([
      this.db
        .select({ status: digestRunStories.status })
        .from(digestRunStories)
        .where(eq(digestRunStories.digestRunId, runId)),
      this.db.query.digestRuns.findFirst({
        columns: { errorCode: true },
        where: eq(digestRuns.id, runId),
      }),
    ]);
    if (statuses.length === 0) {
      await this.failRun(runId, "no_stories_collected");
      return;
    }
    const active = statuses.some(({ status }) =>
      ["pending", "collecting", "analyzing"].includes(status),
    );
    const nextStatus = active
      ? "analyzing"
      : statuses.every(({ status }) => status === "failed")
        ? "failed"
        : statuses.some(({ status }) => status === "failed") || run?.errorCode
          ? "partial"
          : "complete";
    const errorCode =
      nextStatus === "failed"
        ? (run?.errorCode ?? "all_stories_failed")
        : run?.errorCode;
    await this.db
      .update(digestRuns)
      .set({ status: nextStatus, errorCode, updatedAt: new Date() })
      .where(eq(digestRuns.id, runId));
  }

  private async failRun(runId: string, errorCode: string): Promise<void> {
    await this.db
      .update(digestRuns)
      .set({ status: "failed", errorCode, updatedAt: new Date() })
      .where(eq(digestRuns.id, runId));
  }
}

export function hasArticleContent(
  document: { readonly text: string | null } | undefined,
): boolean {
  return Boolean(document?.text);
}

function estimateTokens(text: string): number {
  // Conservative-enough planning estimate for English prose/JSON. Provider
  // usage remains the billing source of truth after submission.
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isAvailableStory(value: unknown): value is HackerNewsStory {
  return Boolean(
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "story" &&
    !("deleted" in value && value.deleted) &&
    !("dead" in value && value.dead),
  );
}

function parseContext(value: Record<string, unknown>): StoredJobContext {
  const selectedCommentIds = value.selectedCommentIds;
  if (
    !Array.isArray(selectedCommentIds) ||
    !selectedCommentIds.every((id) => Number.isInteger(id) && id > 0) ||
    typeof value.articleTruncated !== "boolean" ||
    typeof value.discussionOnly !== "boolean"
  ) {
    throw new Error("Analysis job context metadata is invalid");
  }
  return {
    selectedCommentIds: selectedCommentIds as number[],
    articleTruncated: value.articleTruncated,
    discussionOnly: value.discussionOnly,
  };
}

function validateCitations(
  output: AnalysisOutput,
  allowed: ReadonlySet<number>,
) {
  for (const id of citedCommentIds(output)) {
    if (!allowed.has(id)) throw new InvalidCommentCitationError();
  }
}

function citedCommentIds(output: AnalysisOutput): number[] {
  const claims = [
    ...output.discussion.consensus,
    ...output.discussion.competingViewpoints,
    ...output.discussion.unresolvedQuestions,
  ];
  return [
    ...new Set([
      ...claims.flatMap(({ supportingCommentIds }) => supportingCommentIds),
      ...output.discussion.insightfulComments.map(({ commentId }) => commentId),
    ]),
  ];
}

function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return "pipeline_error";
  return safeCode(error.name === "Error" ? error.message : error.name);
}

function safeCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .slice(0, 100);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
