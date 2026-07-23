import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import {
  digestRuns,
  digestRunStories,
  stories,
  storySnapshots,
  subscribers,
} from "../db/schema";
import { encryptSubscriberEmail } from "../subscribers/crypto";

import { NewsletterDeliveryWorker } from "./delivery";
import { DeliveryProviderError, type DeliveryProvider } from "./provider";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-103 newsletter delivery", () => {
  const connection = createDatabase(databaseUrl!);
  const prefix = randomUUID();
  const keys = {
    emailEncryptionKey: Buffer.alloc(32, 41),
    lookupHmacKey: Buffer.alloc(32, 42),
    keyVersion: 1,
  };

  beforeAll(async () => {
    await connection.pool.query("SELECT 1");
  });

  afterAll(async () => {
    await connection.pool.query(
      "DELETE FROM digest_runs WHERE schedule_key LIKE $1",
      [`%${prefix}%`],
    );
    await connection.pool.query(
      "DELETE FROM subscribers WHERE email_lookup_digest LIKE $1",
      [`${prefix}%`],
    );
    await connection.pool.end();
  });

  it("enforces eligibility, isolates failures, retries, and remains idempotent", async () => {
    const now = new Date("2026-07-23T11:10:00Z");
    const [run] = await connection.db
      .insert(digestRuns)
      .values({
        trigger: "scheduled",
        scheduleKey: `America/New_York|2026-07-23|07:00|${prefix}`,
        scheduledFor: new Date("2026-07-23T11:00:00Z"),
        requestedStoryCount: 1,
        status: "partial",
        newsletterReadyAt: now,
      })
      .returning();
    const [story] = await connection.db
      .insert(stories)
      .values({
        hnItemId: Math.floor(100_000_000 + Math.random() * 800_000_000),
        title: "Fixture story",
        url: "https://example.com/fixture",
        hnCreatedAt: now,
      })
      .returning();
    const [snapshot] = await connection.db
      .insert(storySnapshots)
      .values({
        digestRunId: run!.id,
        storyId: story!.id,
        rank: 1,
        score: 50,
        commentCount: 12,
        title: "Fixture story",
        url: "https://example.com/fixture",
        hnCreatedAt: now,
        metadataHash: "a".repeat(64),
      })
      .returning();
    await connection.db.insert(digestRunStories).values({
      digestRunId: run!.id,
      storyId: story!.id,
      storySnapshotId: snapshot!.id,
      rank: 1,
      status: "failed",
    });

    for (const [suffix, morning, evening] of [
      ["success", true, false],
      ["retry", true, true],
      ["evening-only", false, true],
      ["unconfirmed", true, true],
    ] as const) {
      await connection.db.insert(subscribers).values({
        emailCiphertext: encryptSubscriberEmail(
          `${suffix}@example.com`,
          keys.emailEncryptionKey,
        ),
        emailEncryptionKeyVersion: 1,
        emailLookupDigest: `${prefix}-${suffix}`,
        emailLookupKeyVersion: 1,
        status: suffix === "unconfirmed" ? "unconfirmed" : "confirmed",
        morningEnabled: morning,
        eveningEnabled: evening,
        confirmedAt: suffix === "unconfirmed" ? null : now,
      });
    }

    const calls = new Map<string, number>();
    const provider: DeliveryProvider = {
      async send(message) {
        const count = (calls.get(message.recipient) ?? 0) + 1;
        calls.set(message.recipient, count);
        if (message.recipient === "retry@example.com" && count === 1)
          throw new DeliveryProviderError("unavailable", true);
        expect(message.idempotencyKey).toMatch(/^digest\//u);
        expect(message.html).toContain("Fixture story");
        expect(message.text).toContain("Fixture story");
        return { messageId: `provider-${message.recipient}` };
      },
    };
    const worker = new NewsletterDeliveryWorker(connection.db, provider, {
      applicationUrl: new URL("https://digest.example/"),
      fromEmail: "digest@example.com",
      postalAddress: "123 Example Street",
      batchSize: 25,
      concurrency: 2,
      maximumAttempts: 3,
      morningTime: "07:00",
      eveningTime: "19:00",
      keys,
    });

    expect(await worker.process(now)).toMatchObject({
      queued: 2,
      claimed: 2,
      sent: 1,
      retried: 1,
      failed: 0,
    });
    expect(
      await worker.process(new Date(now.getTime() + 10_000)),
    ).toMatchObject({
      queued: 0,
      claimed: 1,
      sent: 1,
    });
    expect(
      await worker.process(new Date(now.getTime() + 20_000)),
    ).toMatchObject({
      queued: 0,
      claimed: 0,
    });

    const deliveries = await connection.db.query.newsletterDeliveries.findMany({
      where: (delivery, { eq }) => eq(delivery.digestRunId, run!.id),
    });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((delivery) => delivery.status)).toEqual([
      "sent",
      "sent",
    ]);
    expect(calls.get("success@example.com")).toBe(1);
    expect(calls.get("retry@example.com")).toBe(2);
    expect(calls.has("evening-only@example.com")).toBe(false);
    expect(calls.has("unconfirmed@example.com")).toBe(false);
  });
});
