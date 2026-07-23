import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../db/client";
import {
  subscriberActionTokens,
  subscriberConsentEvents,
  subscribers,
} from "../db/schema";

import type { SubscriberKeys } from "./crypto";
import {
  confirmSubscription,
  createPreferenceToken,
  persistSignupRequest,
  suppressSubscriber,
  updateSubscriberPreferences,
} from "./persistence";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-101 subscriber persistence", () => {
  const { db, pool } = createDatabase(databaseUrl!);
  const createdSubscriberIds: string[] = [];
  const keys: SubscriberKeys = {
    emailEncryptionKey: Buffer.alloc(32, 41),
    lookupHmacKey: Buffer.alloc(32, 53),
    keyVersion: 1,
  };

  afterEach(async () => {
    for (const subscriberId of createdSubscriberIds.splice(0)) {
      await db.delete(subscribers).where(eq(subscribers.id, subscriberId));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("keeps repeated signup and confirmation idempotent without plaintext", async () => {
    const first = await persistSignupRequest(db, keys, {
      email: "Reader@EXAMPLE.com",
      morning: true,
      evening: false,
      consentPolicyVersion: "newsletter-v1",
      requestedAt: new Date("2026-07-23T12:00:00Z"),
    });
    expect(first.subscriberId).toBeTruthy();
    expect(first.confirmationToken).toBeTruthy();
    createdSubscriberIds.push(first.subscriberId!);

    const repeated = await persistSignupRequest(db, keys, {
      email: "Reader@example.COM",
      morning: false,
      evening: true,
      consentPolicyVersion: "newsletter-v1",
      requestedAt: new Date("2026-07-23T12:01:00Z"),
    });
    expect(repeated.subscriberId).toBe(first.subscriberId);
    expect(repeated.confirmationToken).not.toBe(first.confirmationToken);

    expect(
      await confirmSubscription(
        db,
        keys,
        first.confirmationToken!,
        "newsletter-v1",
        new Date("2026-07-23T12:02:00Z"),
      ),
    ).toBe(false);
    expect(
      await confirmSubscription(
        db,
        keys,
        repeated.confirmationToken!,
        "newsletter-v1",
        new Date("2026-07-23T12:02:00Z"),
      ),
    ).toBe(true);
    expect(
      await confirmSubscription(
        db,
        keys,
        repeated.confirmationToken!,
        "newsletter-v1",
        new Date("2026-07-23T12:03:00Z"),
      ),
    ).toBe(true);

    const storedSubscribers = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, first.subscriberId!));
    const storedTokens = await db
      .select()
      .from(subscriberActionTokens)
      .where(eq(subscriberActionTokens.subscriberId, first.subscriberId!));
    const storedEvents = await db
      .select()
      .from(subscriberConsentEvents)
      .where(eq(subscriberConsentEvents.subscriberId, first.subscriberId!));

    expect(storedSubscribers).toHaveLength(1);
    expect(storedSubscribers[0]).toMatchObject({
      status: "confirmed",
      morningEnabled: false,
      eveningEnabled: true,
    });
    expect(storedSubscribers[0]?.emailCiphertext).not.toContain(
      "Reader@example.com",
    );
    expect(storedTokens.every((row) => row.tokenDigest.length === 64)).toBe(
      true,
    );
    expect(
      storedTokens.some(
        (row) => row.tokenDigest === repeated.confirmationToken,
      ),
    ).toBe(false);
    expect(storedEvents.map((event) => event.kind)).toEqual([
      "signup_requested",
      "signup_requested",
      "subscription_confirmed",
    ]);
  });

  it("applies preferences, unsubscribe, resubscribe, and suppression safely", async () => {
    const signup = await persistSignupRequest(db, keys, {
      email: "lifecycle@example.com",
      morning: true,
      evening: true,
      consentPolicyVersion: "newsletter-v1",
    });
    createdSubscriberIds.push(signup.subscriberId!);
    await confirmSubscription(
      db,
      keys,
      signup.confirmationToken!,
      "newsletter-v1",
    );

    const morningOnlyToken = await createPreferenceToken(
      db,
      keys,
      signup.subscriberId!,
    );
    expect(
      await updateSubscriberPreferences(
        db,
        keys,
        morningOnlyToken!,
        { morning: true, evening: false },
        "newsletter-v1",
      ),
    ).toBe(true);
    expect(
      await updateSubscriberPreferences(
        db,
        keys,
        morningOnlyToken!,
        { morning: true, evening: false },
        "newsletter-v1",
      ),
    ).toBe(true);

    const unsubscribeToken = await createPreferenceToken(
      db,
      keys,
      signup.subscriberId!,
    );
    expect(
      await updateSubscriberPreferences(
        db,
        keys,
        unsubscribeToken!,
        { morning: false, evening: false },
        "newsletter-v1",
      ),
    ).toBe(true);

    const resubscribe = await persistSignupRequest(db, keys, {
      email: "lifecycle@EXAMPLE.COM",
      morning: false,
      evening: true,
      consentPolicyVersion: "newsletter-v1",
    });
    expect(resubscribe.subscriberId).toBe(signup.subscriberId);
    await confirmSubscription(
      db,
      keys,
      resubscribe.confirmationToken!,
      "newsletter-v1",
    );
    expect(
      await suppressSubscriber(
        db,
        signup.subscriberId!,
        "complaint",
        "newsletter-v1",
      ),
    ).toBe(true);
    expect(
      await suppressSubscriber(
        db,
        signup.subscriberId!,
        "complaint",
        "newsletter-v1",
      ),
    ).toBe(true);

    const suppressedSignup = await persistSignupRequest(db, keys, {
      email: "lifecycle@example.com",
      morning: true,
      evening: true,
      consentPolicyVersion: "newsletter-v1",
    });
    expect(suppressedSignup).toEqual({
      subscriberId: null,
      confirmationToken: null,
    });

    const [stored] = await db
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, signup.subscriberId!));
    expect(stored).toMatchObject({
      status: "unsubscribed",
      morningEnabled: false,
      eveningEnabled: false,
      suppressionReason: "complaint",
    });
  });

  it("rejects invalid preference and ciphertext states at the database", async () => {
    await expect(
      pool.query(
        `
        INSERT INTO subscribers (
          email_lookup_digest, email_lookup_key_version, status,
          morning_enabled, evening_enabled
        ) VALUES ($1, 1, 'confirmed', false, false)
      `,
        ["a".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(
        `
        INSERT INTO subscribers (
          email_ciphertext, email_lookup_digest, email_lookup_key_version,
          status, morning_enabled, evening_enabled
        ) VALUES ('ciphertext-without-key', $1, 1,
          'unconfirmed', true, false)
      `,
        ["b".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
