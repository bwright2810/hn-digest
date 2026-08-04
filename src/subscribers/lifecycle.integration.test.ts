import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import { subscriberActionTokens, subscribers } from "../db/schema";

import { cleanupSubscriberData } from "./lifecycle";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)(
  "HD-105 subscriber lifecycle cleanup",
  () => {
    const connection = createDatabase(databaseUrl!);
    const ids: string[] = [];

    afterAll(async () => {
      for (const id of ids)
        await connection.db.delete(subscribers).where(eq(subscribers.id, id));
      await connection.pool.end();
    });

    it("removes stale unconfirmed data and minimizes old unsubscribed addresses", async () => {
      const now = new Date("2026-07-23T12:00:00Z");
      const old = new Date("2026-05-01T12:00:00Z");
      const [unconfirmed, unsubscribed] = await connection.db
        .insert(subscribers)
        .values([
          {
            emailCiphertext: "stale-encrypted",
            emailEncryptionKeyVersion: 1,
            emailLookupDigest: randomUUID().replaceAll("-", ""),
            emailLookupKeyVersion: 1,
            status: "unconfirmed" as const,
            morningEnabled: true,
            eveningEnabled: false,
            createdAt: old,
            updatedAt: old,
          },
          {
            emailCiphertext: "unsubscribed-encrypted",
            emailEncryptionKeyVersion: 1,
            emailLookupDigest: randomUUID().replaceAll("-", ""),
            emailLookupKeyVersion: 1,
            status: "unsubscribed" as const,
            morningEnabled: false,
            eveningEnabled: false,
            unsubscribedAt: old,
            createdAt: old,
            updatedAt: old,
          },
        ])
        .returning({ id: subscribers.id });
      ids.push(unconfirmed!.id, unsubscribed!.id);
      await connection.db.insert(subscriberActionTokens).values({
        subscriberId: unconfirmed!.id,
        purpose: "confirmation",
        tokenDigest: randomUUID().replaceAll("-", ""),
        tokenKeyVersion: 1,
        expiresAt: new Date("2026-05-02T12:00:00Z"),
        createdAt: old,
      });

      const result = await cleanupSubscriberData(connection.db, now);
      expect(result.tokens).toBeGreaterThanOrEqual(1);
      expect(result.unconfirmedSubscribers).toBeGreaterThanOrEqual(1);
      expect(result.minimizedSubscribers).toBeGreaterThanOrEqual(1);
      expect(
        await connection.db.query.subscribers.findFirst({
          where: eq(subscribers.id, unconfirmed!.id),
        }),
      ).toBeUndefined();
      expect(
        await connection.db.query.subscribers.findFirst({
          where: eq(subscribers.id, unsubscribed!.id),
        }),
      ).toMatchObject({
        emailCiphertext: null,
        emailEncryptionKeyVersion: null,
        emailLookupDigest: expect.any(String),
        status: "unsubscribed",
      });
    });
  },
);
