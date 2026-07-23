import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import { subscriberSignupLimits } from "../db/schema";

import type { SubscriberKeys } from "./crypto";
import { consumeSignupRateLimit, signupClientIdentity } from "./rate-limit";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-102 signup throttling", () => {
  const { db, pool } = createDatabase(databaseUrl!);
  const keys: SubscriberKeys = {
    emailEncryptionKey: Buffer.alloc(32, 71),
    lookupHmacKey: Buffer.alloc(32, 73),
    keyVersion: 1,
  };

  beforeEach(async () => {
    await db.delete(subscriberSignupLimits);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("limits address and client identities without retaining either value", async () => {
    const identities = ["address:reader@example.com", "client:192.0.2.1"];
    const now = new Date("2026-07-23T14:00:00Z");
    expect(
      await consumeSignupRateLimit(db, keys, identities, 2, 60_000, now),
    ).toBe(true);
    expect(
      await consumeSignupRateLimit(db, keys, identities, 2, 60_000, now),
    ).toBe(true);
    expect(
      await consumeSignupRateLimit(db, keys, identities, 2, 60_000, now),
    ).toBe(false);

    const rows = await db.select().from(subscriberSignupLimits);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[a-f0-9]{64}$/u.test(row.keyDigest))).toBe(
      true,
    );
    expect(JSON.stringify(rows)).not.toContain("reader@example.com");
    expect(JSON.stringify(rows)).not.toContain("192.0.2.1");
  });

  it("starts a new window after expiry", async () => {
    const identities = ["address:window@example.com"];
    expect(
      await consumeSignupRateLimit(
        db,
        keys,
        identities,
        1,
        1_000,
        new Date("2026-07-23T14:00:00Z"),
      ),
    ).toBe(true);
    expect(
      await consumeSignupRateLimit(
        db,
        keys,
        identities,
        1,
        1_000,
        new Date("2026-07-23T14:00:02Z"),
      ),
    ).toBe(true);
  });

  it("uses the closest proxy-provided client identity", () => {
    expect(
      signupClientIdentity(
        new Headers({ "x-forwarded-for": "198.51.100.2, 192.0.2.9" }),
      ),
    ).toBe("client:192.0.2.9");
    expect(
      signupClientIdentity(
        new Headers({
          "x-forwarded-for": "198.51.100.2",
          "x-real-ip": "203.0.113.4",
        }),
      ),
    ).toBe("client:203.0.113.4");
  });
});
