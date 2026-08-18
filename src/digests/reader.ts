import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  analysisOutputSchema,
  type AnalysisOutput,
} from "../analysis/contract";
import { getDatabase } from "../db/client";
import {
  analysisJobs,
  articleAnalyses,
  digestRuns,
  digestRunStories,
  discussionAnalyses,
  documents,
  stories as storyRecords,
  storySnapshots,
} from "../db/schema";
import * as schema from "../db/schema";

export type DigestRunState =
  "pending" | "collecting" | "analyzing" | "complete" | "partial" | "failed";

export type DigestStoryState =
  | "pending"
  | "collecting"
  | "analyzing"
  | "complete"
  | "discussion_only"
  | "failed";

export type SourceAvailability =
  "available" | "unavailable" | "discussion_only";

export type SourceMediaType =
  "site" | "pdf" | "plain_text" | "markdown" | "other";

export interface DigestSourceView {
  readonly url: string | null;
  readonly mediaType: SourceMediaType | null;
  readonly availability: SourceAvailability;
}

export interface DigestStoryView {
  readonly id: string;
  readonly rank: number;
  readonly title: string;
  readonly articleUrl: string | null;
  readonly source: DigestSourceView;
  readonly hnUrl: string;
  readonly score: number;
  readonly commentCount: number;
  readonly author: string | null;
  readonly status: DigestStoryState;
  readonly failureCode: string | null;
  readonly analysis: AnalysisOutput | null;
}

export interface DigestRunView {
  readonly id: string;
  readonly status: DigestRunState;
  readonly collectedAt: Date | null;
  readonly createdAt: Date;
  readonly requestedStoryCount: number;
  readonly stories: readonly DigestStoryView[];
}

export interface DigestReader {
  latest(): Promise<DigestRunView | null>;
  byId(id: string): Promise<DigestRunView | null>;
}

type Database = NodePgDatabase<typeof schema>;

export class PostgresDigestReader implements DigestReader {
  constructor(private readonly database: Database = getDatabase()) {}

  async latest(): Promise<DigestRunView | null> {
    const [run] = await this.database
      .select()
      .from(digestRuns)
      .orderBy(desc(digestRuns.createdAt))
      .limit(1);

    if (!run) return null;
    return this.readRun(run);
  }

  async byId(id: string): Promise<DigestRunView | null> {
    const [run] = await this.database
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.id, id))
      .limit(1);
    if (!run) return null;
    return this.readRun(run);
  }

  private async readRun(
    run: typeof digestRuns.$inferSelect,
  ): Promise<DigestRunView> {
    const rows = await this.database
      .select({
        id: digestRunStories.id,
        storyId: digestRunStories.storyId,
        hnItemId: storyRecords.hnItemId,
        rank: digestRunStories.rank,
        status: digestRunStories.status,
        failureCode: digestRunStories.failureCode,
        title: storySnapshots.title,
        articleUrl: storySnapshots.url,
        score: storySnapshots.score,
        commentCount: storySnapshots.commentCount,
        author: storySnapshots.author,
      })
      .from(digestRunStories)
      .innerJoin(
        storySnapshots,
        eq(digestRunStories.storySnapshotId, storySnapshots.id),
      )
      .innerJoin(storyRecords, eq(digestRunStories.storyId, storyRecords.id))
      .where(eq(digestRunStories.digestRunId, run.id))
      .orderBy(digestRunStories.rank);

    const stories = await Promise.all(
      rows.map(async (row): Promise<DigestStoryView> => {
        const [document] = row.articleUrl
          ? await this.database
              .select({
                sourceUrl: documents.sourceUrl,
                status: documents.status,
                metadata: documents.extractionMetadata,
              })
              .from(documents)
              .where(
                and(
                  eq(documents.storyId, row.storyId),
                  eq(documents.sourceUrl, row.articleUrl),
                ),
              )
              .orderBy(desc(documents.updatedAt))
              .limit(1)
          : [];
        const [job] = await this.database
          .select({ id: analysisJobs.id })
          .from(analysisJobs)
          .where(eq(analysisJobs.digestRunStoryId, row.id))
          .orderBy(desc(analysisJobs.finishedAt), desc(analysisJobs.createdAt))
          .limit(1);

        let analysis: AnalysisOutput | null = null;
        if (job) {
          const [article, discussion] = await Promise.all([
            this.database.query.articleAnalyses.findFirst({
              columns: { result: true },
              where: eq(articleAnalyses.analysisJobId, job.id),
            }),
            this.database.query.discussionAnalyses.findFirst({
              columns: { result: true, humanizedResult: true },
              where: eq(discussionAnalyses.analysisJobId, job.id),
            }),
          ]);
          analysis =
            parseStoredAnalysis(
              article?.result,
              discussion?.humanizedResult ?? undefined,
            ) ?? parseStoredAnalysis(article?.result, discussion?.result);
        }

        return {
          id: row.id,
          rank: row.rank,
          title: row.title,
          articleUrl: row.articleUrl,
          source: sourceView({
            articleUrl: row.articleUrl,
            documentSourceUrl: document?.sourceUrl ?? null,
            documentStatus: document?.status ?? null,
            documentMetadata: document?.metadata ?? null,
          }),
          hnUrl: `https://news.ycombinator.com/item?id=${row.hnItemId}`,
          score: row.score,
          commentCount: row.commentCount,
          author: row.author,
          status: row.status,
          failureCode: row.failureCode,
          analysis,
        };
      }),
    );

    return {
      id: run.id,
      status: run.status,
      collectedAt: run.collectedAt,
      createdAt: run.createdAt,
      requestedStoryCount: run.requestedStoryCount,
      stories,
    };
  }
}

export function sourceView(row: {
  readonly articleUrl: string | null;
  readonly documentSourceUrl: string | null;
  readonly documentStatus: (typeof documents.$inferSelect)["status"] | null;
  readonly documentMetadata: Record<string, unknown> | null;
}): DigestSourceView {
  if (!row.articleUrl) {
    return {
      url: null,
      mediaType: null,
      availability: "discussion_only",
    };
  }

  const available =
    row.documentStatus === "extracted" ||
    row.documentStatus === "low_confidence";
  return {
    url: row.documentSourceUrl ?? row.articleUrl,
    mediaType: available ? sourceMediaType(row.documentMetadata) : null,
    availability: available ? "available" : "unavailable",
  };
}

function sourceMediaType(
  metadata: Record<string, unknown> | null,
): SourceMediaType {
  const sourceType = metadata?.sourceType;
  if (sourceType === "pdf") return "pdf";
  if (sourceType === "plain_text") return "plain_text";
  if (sourceType === "markdown") return "markdown";
  if (
    sourceType === "html" ||
    sourceType === "github_repository" ||
    sourceType === "github_file" ||
    sourceType === "hn_text_post"
  ) {
    return "site";
  }
  return "other";
}

export function parseStoredAnalysis(
  articleResult: Record<string, unknown> | undefined,
  discussionResult: Record<string, unknown> | undefined,
): AnalysisOutput | null {
  for (const candidate of [articleResult, discussionResult]) {
    const parsed = analysisOutputSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }

  if (!articleResult || !discussionResult) return null;
  const candidate = {
    promptVersion:
      articleResult.promptVersion ?? discussionResult.promptVersion,
    schemaVersion:
      articleResult.schemaVersion ?? discussionResult.schemaVersion,
    article: articleResult.article ?? articleResult,
    discussion: discussionResult.discussion ?? discussionResult,
    combinedTakeaway:
      articleResult.combinedTakeaway ?? discussionResult.combinedTakeaway,
  };
  const parsed = analysisOutputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
