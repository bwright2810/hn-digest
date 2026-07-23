import { desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import {
  analysisJobAttempts,
  analysisJobs,
  digestRuns,
  digestRunStories,
  storySnapshots,
  newsletterDeliveries,
} from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export interface AdminFailureView {
  readonly storyTitle: string;
  readonly storyRank: number;
  readonly storyStatus: string;
  readonly storyFailureCode: string | null;
  readonly jobStatus: string | null;
  readonly jobErrorCode: string | null;
  readonly attemptStatus: string | null;
  readonly attempt: number | null;
  readonly attemptErrorCode: string | null;
}

export interface AdminRunView {
  readonly id: string;
  readonly trigger: string;
  readonly status: string;
  readonly requestedStoryCount: number;
  readonly excludedStoryCount: number;
  readonly excludedHnItemIds: readonly number[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly errorCode: string | null;
  readonly failures: readonly AdminFailureView[];
}

export interface NewsletterDiagnostics {
  readonly totals: readonly {
    readonly status: string;
    readonly count: number;
  }[];
  readonly recent: readonly {
    readonly id: string;
    readonly digestRunId: string;
    readonly edition: string;
    readonly status: string;
    readonly providerStatus: string | null;
    readonly attemptCount: number;
    readonly lastErrorCode: string | null;
    readonly updatedAt: Date;
  }[];
}

export async function collectNewsletterDiagnostics(
  database: Database,
  limit = 20,
): Promise<NewsletterDiagnostics> {
  const [totals, recent] = await Promise.all([
    database
      .select({
        status: newsletterDeliveries.status,
        count: sql<number>`count(*)::int`,
      })
      .from(newsletterDeliveries)
      .groupBy(newsletterDeliveries.status)
      .orderBy(newsletterDeliveries.status),
    database
      .select({
        id: newsletterDeliveries.id,
        digestRunId: newsletterDeliveries.digestRunId,
        edition: newsletterDeliveries.edition,
        status: newsletterDeliveries.status,
        providerStatus: newsletterDeliveries.providerStatus,
        attemptCount: newsletterDeliveries.attemptCount,
        lastErrorCode: newsletterDeliveries.lastErrorCode,
        updatedAt: newsletterDeliveries.updatedAt,
      })
      .from(newsletterDeliveries)
      .orderBy(desc(newsletterDeliveries.updatedAt))
      .limit(limit),
  ]);
  return { totals, recent };
}

export async function collectAdminRuns(
  database: Database,
  limit = 20,
): Promise<readonly AdminRunView[]> {
  const runs = await database
    .select()
    .from(digestRuns)
    .orderBy(desc(digestRuns.createdAt))
    .limit(limit);
  if (runs.length === 0) return [];

  const rows = await database
    .select({
      runId: digestRunStories.digestRunId,
      storyTitle: storySnapshots.title,
      storyRank: digestRunStories.rank,
      storyStatus: digestRunStories.status,
      storyFailureCode: digestRunStories.failureCode,
      jobStatus: analysisJobs.status,
      jobErrorCode: analysisJobs.errorCode,
      attemptStatus: analysisJobAttempts.status,
      attempt: analysisJobAttempts.attempt,
      attemptErrorCode: analysisJobAttempts.errorCode,
    })
    .from(digestRunStories)
    .innerJoin(
      storySnapshots,
      eq(digestRunStories.storySnapshotId, storySnapshots.id),
    )
    .leftJoin(
      analysisJobs,
      eq(analysisJobs.digestRunStoryId, digestRunStories.id),
    )
    .leftJoin(
      analysisJobAttempts,
      eq(analysisJobAttempts.analysisJobId, analysisJobs.id),
    )
    .where(
      inArray(
        digestRunStories.digestRunId,
        runs.map(({ id }) => id),
      ),
    )
    .orderBy(digestRunStories.rank, desc(analysisJobAttempts.attempt));

  return runs.map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    requestedStoryCount: run.requestedStoryCount,
    excludedStoryCount: run.excludedStoryCount,
    excludedHnItemIds: run.excludedHnItemIds,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    errorCode: run.errorCode,
    failures: rows
      .filter(
        (row) =>
          row.runId === run.id &&
          (row.storyStatus === "failed" ||
            ["failed", "refused", "incomplete", "skipped_budget"].includes(
              row.jobStatus ?? "",
            ) ||
            row.attemptStatus === "failed"),
      )
      .map((row) => ({
        storyTitle: row.storyTitle,
        storyRank: row.storyRank,
        storyStatus: row.storyStatus,
        storyFailureCode: row.storyFailureCode,
        jobStatus: row.jobStatus,
        jobErrorCode: row.jobErrorCode,
        attemptStatus: row.attemptStatus,
        attempt: row.attempt,
        attemptErrorCode: row.attemptErrorCode,
      })),
  }));
}
