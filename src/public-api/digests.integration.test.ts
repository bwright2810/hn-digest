import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import { digestRuns } from "../db/schema";

import { readPublicDigest } from "./digests";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-110 public digest lookup", () => {
  const connection = createDatabase(databaseUrl!);
  const prefix = randomUUID();

  beforeAll(async () => {
    await connection.pool.query("SELECT 1");
    await connection.db.insert(digestRuns).values([
      {
        trigger: "scheduled",
        scheduleKey: `America/New_York|2026-11-02|07:00|${prefix}`,
        scheduledFor: new Date("2026-11-02T12:00:00Z"),
        collectedAt: new Date("2026-11-02T12:05:00Z"),
        requestedStoryCount: 1,
        status: "complete",
      },
      {
        trigger: "scheduled",
        scheduleKey: `America/New_York|2026-11-02|19:00|${prefix}`,
        scheduledFor: new Date("2026-11-03T00:00:00Z"),
        collectedAt: new Date("2026-11-03T00:05:00Z"),
        requestedStoryCount: 1,
        status: "partial",
      },
    ]);
  });

  afterAll(async () => {
    await connection.pool.query(
      "DELETE FROM digest_runs WHERE schedule_key LIKE $1",
      [`%${prefix}`],
    );
    await connection.pool.end();
  });

  it("uses the named timezone and returns only complete scheduled editions", async () => {
    await expect(
      readPublicDigest(connection.db, {
        date: "2026-11-02",
        edition: "morning",
        timeZone: "America/New_York",
        morningTime: "07:00",
        eveningTime: "19:00",
      }),
    ).resolves.toMatchObject({
      version: "v1",
      date: "2026-11-02",
      edition: "morning",
      scheduledFor: "2026-11-02T12:00:00.000Z",
    });
    await expect(
      readPublicDigest(connection.db, {
        date: "2026-11-02",
        edition: "evening",
        timeZone: "America/New_York",
        morningTime: "07:00",
        eveningTime: "19:00",
      }),
    ).resolves.toBeNull();
  });
});
