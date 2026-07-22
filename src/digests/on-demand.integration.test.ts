import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase } from "../db/client";
import { digestRuns } from "../db/schema";
import {
  ActiveOnDemandRunError,
  PostgresDigestRunStore,
} from "../ingestion/top-stories";
import { getDigestRunProgress } from "./on-demand";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-053 on-demand run control", () => {
  const connection = createDatabase(databaseUrl!);
  const store = new PostgresDigestRunStore(connection.db);
  const runIds: string[] = [];

  afterAll(async () => {
    for (const runId of runIds) {
      await connection.db.delete(digestRuns).where(eq(digestRuns.id, runId));
    }
    await connection.pool.end();
  });

  it("admits only one concurrent on-demand run and exposes its progress", async () => {
    const attempts = await Promise.allSettled([
      store.createRun(3),
      store.createRun(3),
    ]);
    const admitted = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<string> =>
        attempt.status === "fulfilled",
    );
    expect(admitted).toBeDefined();
    runIds.push(admitted!.value);

    const rejected = attempts.find(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );
    expect(rejected?.reason).toEqual(
      expect.objectContaining({
        name: "ActiveOnDemandRunError",
        runId: admitted!.value,
      }) satisfies Partial<ActiveOnDemandRunError>,
    );

    await expect(
      getDigestRunProgress(connection.db, admitted!.value),
    ).resolves.toMatchObject({
      id: admitted!.value,
      trigger: "on_demand",
      status: "collecting",
      requestedStoryCount: 3,
      collectedStoryCount: 0,
    });
  });
});
