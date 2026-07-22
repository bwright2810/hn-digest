import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import { digestRuns } from "../db/schema";
import { ensureScheduledDigestRun } from "./digest-scheduler";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-051 scheduled run persistence", () => {
  const database = createDatabase(databaseUrl!);
  const options = {
    timeZone: "America/New_York",
    morningTime: "07:00",
    eveningTime: "19:00",
    storyCount: 5,
    missedRunGraceMs: 6 * 60 * 60 * 1_000,
  } as const;

  afterAll(async () => database.pool.end());

  it("does not duplicate a scheduled run across concurrent scheduler ticks", async () => {
    const now = new Date("2031-07-22T11:05:00Z");
    const key = "America/New_York|2031-07-22|07:00";
    await database.db.delete(digestRuns).where(eq(digestRuns.scheduleKey, key));
    try {
      const results = await Promise.all([
        ensureScheduledDigestRun(database.db, options, now),
        ensureScheduledDigestRun(database.db, options, now),
      ]);
      expect(results.filter(({ created }) => created)).toHaveLength(1);
      expect(new Set(results.map(({ runId }) => runId)).size).toBe(1);
      const [stored] = await database.db
        .select()
        .from(digestRuns)
        .where(eq(digestRuns.scheduleKey, key));
      expect(stored).toMatchObject({
        trigger: "scheduled",
        scheduledFor: new Date("2031-07-22T11:00:00Z"),
        requestedStoryCount: 5,
      });
    } finally {
      await database.db
        .delete(digestRuns)
        .where(eq(digestRuns.scheduleKey, key));
    }
  });
});
