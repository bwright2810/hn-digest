import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";

import { consumePublicApiRateLimit } from "./rate-limit";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)(
  "HD-110 shared public API rate limit",
  () => {
    const connection = createDatabase(databaseUrl!);
    const key = Buffer.alloc(32, 71);
    const identity = randomUUID();

    beforeAll(() => connection.pool.query("SELECT 1"));
    afterAll(async () => {
      await connection.pool.query("DELETE FROM public_api_rate_limits");
      await connection.pool.end();
    });

    it("enforces one fixed window across database clients and resets", async () => {
      const now = new Date("2026-07-23T12:00:00Z");
      for (let count = 1; count <= 10; count += 1) {
        const result = await consumePublicApiRateLimit(
          connection.db,
          key,
          identity,
          10,
          60_000,
          now,
        );
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10 - count);
      }
      await expect(
        consumePublicApiRateLimit(
          connection.db,
          key,
          identity,
          10,
          60_000,
          now,
        ),
      ).resolves.toMatchObject({ allowed: false, remaining: 0 });
      await expect(
        consumePublicApiRateLimit(
          connection.db,
          key,
          identity,
          10,
          60_000,
          new Date(now.getTime() + 60_001),
        ),
      ).resolves.toMatchObject({ allowed: true, remaining: 9 });
    });
  },
);
