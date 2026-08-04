import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import * as schema from "../db/schema";
import { digestRuns } from "../db/schema";
import { PostgresDigestReader } from "../digests/reader";
import { localDateTimeToUtc } from "../scheduler/schedule";

type Database = NodePgDatabase<typeof schema>;
export type PublicDigestEdition = "morning" | "evening";

export const publicDigestQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  edition: z.enum(["morning", "evening"]),
});

export async function readPublicDigest(
  database: Database,
  options: {
    readonly date: string;
    readonly edition: PublicDigestEdition;
    readonly timeZone: string;
    readonly morningTime: string;
    readonly eveningTime: string;
  },
) {
  const [year, month, day] = options.date.split("-").map(Number);
  if (!isCalendarDate(year!, month!, day!)) return null;
  const time =
    options.edition === "morning" ? options.morningTime : options.eveningTime;
  const [hour, minute] = time.split(":").map(Number);
  const scheduledFor = localDateTimeToUtc(
    { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
    options.timeZone,
  );
  const [run] = await database
    .select({ id: digestRuns.id })
    .from(digestRuns)
    .where(
      and(
        eq(digestRuns.trigger, "scheduled"),
        eq(digestRuns.status, "complete"),
        eq(digestRuns.scheduledFor, scheduledFor),
      ),
    )
    .limit(1);
  if (!run) return null;
  const digest = await new PostgresDigestReader(database).byId(run.id);
  if (!digest || digest.status !== "complete") return null;
  return mapPublicDigest(digest, options.date, options.edition, scheduledFor);
}

export function mapPublicDigest(
  digest: Awaited<ReturnType<PostgresDigestReader["byId"]>> & {},
  date: string,
  edition: PublicDigestEdition,
  scheduledFor: Date,
) {
  return {
    version: "v1" as const,
    date,
    edition,
    scheduledFor: scheduledFor.toISOString(),
    collectedAt: digest.collectedAt?.toISOString() ?? null,
    storyCount: digest.stories.length,
    stories: digest.stories.map((story) => ({
      rank: story.rank,
      title: story.title,
      articleUrl: story.articleUrl,
      hnUrl: story.hnUrl,
      score: story.score,
      commentCount: story.commentCount,
      author: story.author,
      analysis: story.analysis
        ? {
            article: story.analysis.article,
            discussion: story.analysis.discussion,
            combinedTakeaway: story.analysis.combinedTakeaway,
          }
        : null,
    })),
  };
}

export function calendarDateToUtc(date: string): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  return isCalendarDate(year!, month!, day!)
    ? new Date(Date.UTC(year!, month! - 1, day!))
    : null;
}

function isCalendarDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}
