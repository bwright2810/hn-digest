import { count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { digestRuns, digestRunStories } from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export interface DigestRunProgress {
  readonly id: string;
  readonly trigger: "scheduled" | "on_demand";
  readonly status:
    "pending" | "collecting" | "analyzing" | "complete" | "partial" | "failed";
  readonly requestedStoryCount: number;
  readonly collectedStoryCount: number;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly collectedAt: Date | null;
}

export async function getDigestRunProgress(
  database: Database,
  runId: string,
): Promise<DigestRunProgress | null> {
  const [row] = await database
    .select({
      id: digestRuns.id,
      trigger: digestRuns.trigger,
      status: digestRuns.status,
      requestedStoryCount: digestRuns.requestedStoryCount,
      errorCode: digestRuns.errorCode,
      createdAt: digestRuns.createdAt,
      updatedAt: digestRuns.updatedAt,
      collectedAt: digestRuns.collectedAt,
      collectedStoryCount: count(digestRunStories.id),
    })
    .from(digestRuns)
    .leftJoin(digestRunStories, eq(digestRunStories.digestRunId, digestRuns.id))
    .where(eq(digestRuns.id, runId))
    .groupBy(digestRuns.id);

  return row ?? null;
}

export function parseOnDemandStoryCount(
  value: string | undefined,
  maximum: number,
): number {
  const storyCount = value === undefined ? maximum : Number(value);
  if (
    !Number.isInteger(storyCount) ||
    storyCount <= 0 ||
    storyCount > maximum
  ) {
    throw new RangeError(`story count must be an integer from 1 to ${maximum}`);
  }
  return storyCount;
}
