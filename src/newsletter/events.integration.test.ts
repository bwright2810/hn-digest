import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import {
  digestRuns,
  newsletterDeliveries,
  newsletterProviderEvents,
  subscribers,
} from "../db/schema";

import { processProviderEvent } from "./events";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-104 provider delivery events", () => {
  const connection = createDatabase(databaseUrl!);
  const prefix = randomUUID();
  let subscriberId: string;
  let deliveryId: string;

  beforeAll(async () => {
    await connection.pool.query("SELECT 1");
    const now = new Date("2026-07-23T12:00:00Z");
    const [subscriber] = await connection.db
      .insert(subscribers)
      .values({
        emailCiphertext: "encrypted-fixture",
        emailEncryptionKeyVersion: 1,
        emailLookupDigest: prefix,
        emailLookupKeyVersion: 1,
        status: "confirmed",
        morningEnabled: true,
        eveningEnabled: true,
        confirmedAt: now,
      })
      .returning({ id: subscribers.id });
    const [run] = await connection.db
      .insert(digestRuns)
      .values({
        trigger: "scheduled",
        scheduleKey: `fixture-${prefix}`,
        scheduledFor: now,
        requestedStoryCount: 1,
        status: "complete",
        newsletterReadyAt: now,
      })
      .returning({ id: digestRuns.id });
    const [delivery] = await connection.db
      .insert(newsletterDeliveries)
      .values({
        digestRunId: run!.id,
        subscriberId: subscriber!.id,
        edition: "morning",
        status: "sent",
        attemptCount: 1,
        providerMessageId: `provider-${prefix}`,
        providerStatus: "sent",
        providerStatusAt: now,
        sentAt: now,
      })
      .returning({ id: newsletterDeliveries.id });
    subscriberId = subscriber!.id;
    deliveryId = delivery!.id;
  });

  afterAll(async () => {
    await connection.pool.query(
      "DELETE FROM digest_runs WHERE schedule_key = $1",
      [`fixture-${prefix}`],
    );
    await connection.pool.query(
      "DELETE FROM subscribers WHERE email_lookup_digest = $1",
      [prefix],
    );
    await connection.pool.end();
  });

  it("is replay-safe, applies events in provider order, and suppresses complaints", async () => {
    const delivered = providerEvent("email.delivered", "2026-07-23T12:02:00Z");
    await expect(
      processProviderEvent(
        connection.db,
        { providerEventId: `event-delivered-${prefix}`, payload: delivered },
        "newsletter-v1",
      ),
    ).resolves.toEqual({ outcome: "processed" });
    await expect(
      processProviderEvent(
        connection.db,
        { providerEventId: `event-delivered-${prefix}`, payload: delivered },
        "newsletter-v1",
      ),
    ).resolves.toEqual({ outcome: "duplicate" });

    await processProviderEvent(
      connection.db,
      {
        providerEventId: `event-old-sent-${prefix}`,
        payload: providerEvent("email.sent", "2026-07-23T12:01:00Z"),
      },
      "newsletter-v1",
    );
    await processProviderEvent(
      connection.db,
      {
        providerEventId: `event-complaint-${prefix}`,
        payload: providerEvent("email.complained", "2026-07-23T12:03:00Z"),
      },
      "newsletter-v1",
    );

    const [delivery, subscriber, events] = await Promise.all([
      connection.db.query.newsletterDeliveries.findFirst({
        where: eq(newsletterDeliveries.id, deliveryId),
      }),
      connection.db.query.subscribers.findFirst({
        where: eq(subscribers.id, subscriberId),
      }),
      connection.db.query.newsletterProviderEvents.findMany({
        where: eq(newsletterProviderEvents.deliveryId, deliveryId),
      }),
    ]);
    expect(delivery?.providerStatus).toBe("complained");
    expect(subscriber?.suppressionReason).toBe("complaint");
    expect(events).toHaveLength(3);
    expect(events.map(({ detailCode }) => detailCode)).toContain(
      "spam_complaint",
    );
    expect(JSON.stringify(events)).not.toContain("private@example.com");
  });

  it("ignores provider traffic that is unrelated to digest deliveries", async () => {
    await expect(
      processProviderEvent(
        connection.db,
        {
          providerEventId: `event-unrelated-${prefix}`,
          payload: {
            ...providerEvent("email.bounced", "2026-07-23T12:04:00Z"),
            data: {
              ...providerEvent("email.bounced", "2026-07-23T12:04:00Z").data,
              email_id: "confirmation-message",
            },
          },
        },
        "newsletter-v1",
      ),
    ).resolves.toEqual({ outcome: "ignored" });
  });

  function providerEvent(type: string, createdAt: string) {
    return {
      type,
      created_at: createdAt,
      data: {
        email_id: `provider-${prefix}`,
        to: ["private@example.com"],
        subject: "must not be retained",
      },
    };
  }
});
