import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { digestRuns } from "../../../../db/schema";
import { PostgresDigestReader } from "../../../../digests/reader";
import { localDateTimeToUtc } from "../../../../scheduler/schedule";
import { DigestPage } from "../../../page";

export const dynamic = "force-dynamic";

export default async function ArchivedEditionPage({
  params,
}: {
  readonly params: Promise<{ date: string; edition: string }>;
}) {
  const { date, edition } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) notFound();
  if (edition !== "morning" && edition !== "evening") notFound();

  const config = getConfig();
  const [year, month, day] = date.split("-").map(Number);
  if (!isCalendarDate(year!, month!, day!)) notFound();
  const time =
    edition === "morning"
      ? config.schedule.morningTime
      : config.schedule.eveningTime;
  const [hour, minute] = time.split(":").map(Number);
  const scheduledFor = localDateTimeToUtc(
    { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
    config.schedule.timeZone,
  );
  const database = getDatabase();
  const run = await findScheduledRun(database, scheduledFor);
  if (!run) notFound();

  const digest = await new PostgresDigestReader(database).byId(run.id);
  if (!digest || (digest.status !== "complete" && digest.status !== "partial"))
    notFound();

  return (
    <>
      <div className="archive-backlink">
        <Link href="/archive">← Back to archive</Link>
      </div>
      <DigestPage run={digest} newsletterEnabled={false} />
    </>
  );
}

function isCalendarDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

async function findScheduledRun(
  database: ReturnType<typeof getDatabase>,
  scheduledFor: Date,
) {
  const [run] = await database
    .select({ id: digestRuns.id })
    .from(digestRuns)
    .where(
      and(
        eq(digestRuns.trigger, "scheduled"),
        eq(digestRuns.scheduledFor, scheduledFor),
      ),
    )
    .limit(1);
  return run ?? null;
}
