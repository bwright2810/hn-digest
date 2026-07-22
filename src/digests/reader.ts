import { desc, eq } from "drizzle-orm";

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
  stories as storyRecords,
  storySnapshots,
} from "../db/schema";

export type DigestRunState =
  "pending" | "collecting" | "analyzing" | "complete" | "partial" | "failed";

export type DigestStoryState =
  | "pending"
  | "collecting"
  | "analyzing"
  | "complete"
  | "discussion_only"
  | "failed";

export interface DigestStoryView {
  readonly id: string;
  readonly rank: number;
  readonly title: string;
  readonly articleUrl: string | null;
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
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresDigestReader implements DigestReader {
  constructor(private readonly database: Database = getDatabase()) {}

  async latest(): Promise<DigestRunView | null> {
    const [run] = await this.database
      .select()
      .from(digestRuns)
      .orderBy(desc(digestRuns.createdAt))
      .limit(1);

    if (!run) return null;

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
              columns: { result: true },
              where: eq(discussionAnalyses.analysisJobId, job.id),
            }),
          ]);
          analysis = parseStoredAnalysis(article?.result, discussion?.result);
        }

        return {
          id: row.id,
          rank: row.rank,
          title: row.title,
          articleUrl: row.articleUrl,
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
