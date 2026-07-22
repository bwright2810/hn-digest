import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { digestRuns } from "../db/schema";
import { findLatestEligibleSlot, type DigestScheduleSlot } from "./schedule";

type Database = NodePgDatabase<typeof schema>;

export interface DigestSchedulerOptions {
  readonly timeZone: string;
  readonly morningTime: string;
  readonly eveningTime: string;
  readonly storyCount: number;
  readonly missedRunGraceMs: number;
}

export interface ScheduledDigestResult {
  readonly slot: DigestScheduleSlot | null;
  readonly runId: string | null;
  readonly created: boolean;
}

export async function ensureScheduledDigestRun(
  db: Database,
  options: DigestSchedulerOptions,
  now = new Date(),
): Promise<ScheduledDigestResult> {
  if (!Number.isInteger(options.storyCount) || options.storyCount <= 0) {
    throw new RangeError("storyCount must be a positive integer");
  }
  const slot = findLatestEligibleSlot({
    now,
    timeZone: options.timeZone,
    times: [options.morningTime, options.eveningTime],
    missedRunGraceMs: options.missedRunGraceMs,
  });
  if (!slot) return { slot: null, runId: null, created: false };

  const [created] = await db
    .insert(digestRuns)
    .values({
      trigger: "scheduled",
      scheduleKey: slot.key,
      scheduledFor: slot.scheduledFor,
      requestedStoryCount: options.storyCount,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: digestRuns.id });
  if (created) return { slot, runId: created.id, created: true };

  const existing = await db.query.digestRuns.findFirst({
    columns: { id: true },
    where: (run, { eq }) => eq(run.scheduleKey, slot.key),
  });
  if (!existing) {
    throw new Error(
      "Scheduled digest conflict did not resolve to an existing run",
    );
  }
  return { slot, runId: existing.id, created: false };
}
