import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import {
  subscriberActionTokens,
  subscriberConsentEvents,
  subscribers,
} from "../db/schema";

import {
  createSubscriberActionToken,
  digestSubscriberValue,
  encryptSubscriberEmail,
  normalizeSubscriberEmail,
  type SubscriberKeys,
} from "./crypto";

type Database = NodePgDatabase<typeof schema>;
type EditionPreferences = {
  readonly morning: boolean;
  readonly evening: boolean;
};

const CONFIRMATION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const PREFERENCE_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export interface SignupRequest extends EditionPreferences {
  readonly email: string;
  readonly consentPolicyVersion: string;
  readonly requestedAt?: Date;
}

export interface SignupPersistenceResult {
  readonly subscriberId: string | null;
  readonly confirmationToken: string | null;
}

function requireEdition(preferences: EditionPreferences): void {
  if (!preferences.morning && !preferences.evening) {
    throw new RangeError("at least one newsletter edition must be selected");
  }
}

export async function persistSignupRequest(
  database: Database,
  keys: SubscriberKeys,
  request: SignupRequest,
): Promise<SignupPersistenceResult> {
  requireEdition(request);
  const requestedAt = request.requestedAt ?? new Date();
  const email = normalizeSubscriberEmail(request.email);
  const emailLookupDigest = digestSubscriberValue(
    email,
    keys.lookupHmacKey,
    "email",
  );
  const emailCiphertext = encryptSubscriberEmail(
    email,
    keys.emailEncryptionKey,
  );

  return database.transaction(async (transaction) => {
    // Serialize requests for the same address so concurrent first signups are
    // idempotent instead of racing the unique lookup-digest constraint.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${emailLookupDigest}, 0))`,
    );
    const [existing] = await transaction
      .select()
      .from(subscribers)
      .where(eq(subscribers.emailLookupDigest, emailLookupDigest))
      .for("update");

    if (existing?.suppressionReason) {
      return { subscriberId: null, confirmationToken: null };
    }

    if (existing?.status === "confirmed") {
      return { subscriberId: null, confirmationToken: null };
    }

    let subscriberId: string;
    let eventKind: "signup_requested" | "resubscribe_requested" =
      "signup_requested";

    if (existing) {
      eventKind =
        existing.status === "unsubscribed"
          ? "resubscribe_requested"
          : "signup_requested";
      subscriberId = existing.id;
      await transaction
        .update(subscribers)
        .set({
          emailCiphertext,
          emailEncryptionKeyVersion: keys.keyVersion,
          emailLookupKeyVersion: keys.keyVersion,
          status: "unconfirmed",
          morningEnabled: request.morning,
          eveningEnabled: request.evening,
          confirmedAt: null,
          unsubscribedAt: null,
          lastPreferenceChangedAt: requestedAt,
          updatedAt: requestedAt,
        })
        .where(eq(subscribers.id, subscriberId));
    } else {
      const [created] = await transaction
        .insert(subscribers)
        .values({
          emailCiphertext,
          emailEncryptionKeyVersion: keys.keyVersion,
          emailLookupDigest,
          emailLookupKeyVersion: keys.keyVersion,
          status: "unconfirmed",
          morningEnabled: request.morning,
          eveningEnabled: request.evening,
          lastPreferenceChangedAt: requestedAt,
          createdAt: requestedAt,
          updatedAt: requestedAt,
        })
        .returning({ id: subscribers.id });
      if (!created) {
        throw new Error("subscriber insert did not return an identifier");
      }
      subscriberId = created.id;
    }

    await transaction.insert(subscriberConsentEvents).values({
      subscriberId,
      kind: eventKind,
      morningEnabled: request.morning,
      eveningEnabled: request.evening,
      consentPolicyVersion: request.consentPolicyVersion,
      source: "public_signup",
      requestedAt,
      createdAt: requestedAt,
    });

    await transaction
      .update(subscriberActionTokens)
      .set({ invalidatedAt: requestedAt })
      .where(
        and(
          eq(subscriberActionTokens.subscriberId, subscriberId),
          eq(subscriberActionTokens.purpose, "confirmation"),
          isNull(subscriberActionTokens.consumedAt),
          isNull(subscriberActionTokens.invalidatedAt),
        ),
      );

    const generated = createSubscriberActionToken(keys.lookupHmacKey);
    await transaction.insert(subscriberActionTokens).values({
      subscriberId,
      purpose: "confirmation",
      tokenDigest: generated.digest,
      tokenKeyVersion: keys.keyVersion,
      expiresAt: new Date(
        requestedAt.getTime() + CONFIRMATION_TOKEN_LIFETIME_MS,
      ),
      createdAt: requestedAt,
    });

    return { subscriberId, confirmationToken: generated.token };
  });
}

export async function confirmSubscription(
  database: Database,
  keys: SubscriberKeys,
  token: string,
  consentPolicyVersion: string,
  confirmedAt = new Date(),
): Promise<boolean> {
  const tokenDigest = digestSubscriberValue(
    token,
    keys.lookupHmacKey,
    "action-token",
  );

  return database.transaction(async (transaction) => {
    const [actionToken] = await transaction
      .select()
      .from(subscriberActionTokens)
      .where(
        and(
          eq(subscriberActionTokens.tokenDigest, tokenDigest),
          eq(subscriberActionTokens.purpose, "confirmation"),
        ),
      )
      .for("update");

    if (!actionToken || actionToken.invalidatedAt) {
      return false;
    }
    const [subscriber] = await transaction
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, actionToken.subscriberId))
      .for("update");
    if (!subscriber || subscriber.suppressionReason) {
      return false;
    }
    if (actionToken.consumedAt) {
      return subscriber.status === "confirmed";
    }
    if (actionToken.expiresAt <= confirmedAt) {
      return false;
    }

    await transaction
      .update(subscriberActionTokens)
      .set({ consumedAt: confirmedAt })
      .where(eq(subscriberActionTokens.id, actionToken.id));
    await transaction
      .update(subscribers)
      .set({
        status: "confirmed",
        confirmedAt,
        unsubscribedAt: null,
        updatedAt: confirmedAt,
      })
      .where(eq(subscribers.id, subscriber.id));
    await transaction.insert(subscriberConsentEvents).values({
      subscriberId: subscriber.id,
      kind: "subscription_confirmed",
      morningEnabled: subscriber.morningEnabled,
      eveningEnabled: subscriber.eveningEnabled,
      consentPolicyVersion,
      source: "public_signup",
      requestedAt: actionToken.createdAt,
      confirmedAt,
      createdAt: confirmedAt,
    });
    return true;
  });
}

export async function createPreferenceToken(
  database: Database,
  keys: SubscriberKeys,
  subscriberId: string,
  createdAt = new Date(),
): Promise<string | null> {
  return database.transaction(async (transaction) => {
    const [subscriber] = await transaction
      .select({ id: subscribers.id, status: subscribers.status })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.id, subscriberId),
          eq(subscribers.status, "confirmed"),
          isNull(subscribers.suppressionReason),
        ),
      );
    if (!subscriber) return null;

    await transaction
      .update(subscriberActionTokens)
      .set({ invalidatedAt: createdAt })
      .where(
        and(
          eq(subscriberActionTokens.subscriberId, subscriberId),
          eq(subscriberActionTokens.purpose, "preferences"),
          isNull(subscriberActionTokens.consumedAt),
          isNull(subscriberActionTokens.invalidatedAt),
        ),
      );
    const generated = createSubscriberActionToken(keys.lookupHmacKey);
    await transaction.insert(subscriberActionTokens).values({
      subscriberId,
      purpose: "preferences",
      tokenDigest: generated.digest,
      tokenKeyVersion: keys.keyVersion,
      expiresAt: new Date(createdAt.getTime() + PREFERENCE_TOKEN_LIFETIME_MS),
      createdAt,
    });
    return generated.token;
  });
}

export async function getSubscriberPreferences(
  database: Database,
  keys: SubscriberKeys,
  token: string,
  now = new Date(),
): Promise<EditionPreferences | null> {
  const tokenDigest = digestSubscriberValue(
    token,
    keys.lookupHmacKey,
    "action-token",
  );
  const [row] = await database
    .select({
      morning: subscribers.morningEnabled,
      evening: subscribers.eveningEnabled,
      status: subscribers.status,
      suppressionReason: subscribers.suppressionReason,
      expiresAt: subscriberActionTokens.expiresAt,
      consumedAt: subscriberActionTokens.consumedAt,
      invalidatedAt: subscriberActionTokens.invalidatedAt,
    })
    .from(subscriberActionTokens)
    .innerJoin(
      subscribers,
      eq(subscribers.id, subscriberActionTokens.subscriberId),
    )
    .where(
      and(
        eq(subscriberActionTokens.tokenDigest, tokenDigest),
        eq(subscriberActionTokens.purpose, "preferences"),
      ),
    );
  if (
    !row ||
    row.status !== "confirmed" ||
    row.suppressionReason ||
    row.consumedAt ||
    row.invalidatedAt ||
    row.expiresAt <= now
  ) {
    return null;
  }
  return { morning: row.morning, evening: row.evening };
}

export async function updateSubscriberPreferences(
  database: Database,
  keys: SubscriberKeys,
  token: string,
  preferences: EditionPreferences,
  consentPolicyVersion: string,
  changedAt = new Date(),
): Promise<boolean> {
  const tokenDigest = digestSubscriberValue(
    token,
    keys.lookupHmacKey,
    "action-token",
  );
  return database.transaction(async (transaction) => {
    const [actionToken] = await transaction
      .select()
      .from(subscriberActionTokens)
      .where(
        and(
          eq(subscriberActionTokens.tokenDigest, tokenDigest),
          eq(subscriberActionTokens.purpose, "preferences"),
        ),
      )
      .for("update");
    if (!actionToken || actionToken.invalidatedAt) return false;

    const [subscriber] = await transaction
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, actionToken.subscriberId))
      .for("update");
    if (!subscriber || subscriber.suppressionReason) return false;
    const isUnsubscribe = !preferences.morning && !preferences.evening;
    const targetStatus = isUnsubscribe ? "unsubscribed" : "confirmed";
    if (actionToken.consumedAt) {
      return (
        subscriber.status === targetStatus &&
        subscriber.morningEnabled === preferences.morning &&
        subscriber.eveningEnabled === preferences.evening
      );
    }
    if (actionToken.expiresAt <= changedAt) return false;

    await transaction
      .update(subscriberActionTokens)
      .set({ consumedAt: changedAt })
      .where(eq(subscriberActionTokens.id, actionToken.id));
    await transaction
      .update(subscribers)
      .set({
        status: targetStatus,
        morningEnabled: preferences.morning,
        eveningEnabled: preferences.evening,
        unsubscribedAt: isUnsubscribe ? changedAt : null,
        lastPreferenceChangedAt: changedAt,
        updatedAt: changedAt,
      })
      .where(eq(subscribers.id, subscriber.id));
    await transaction.insert(subscriberConsentEvents).values({
      subscriberId: subscriber.id,
      kind: isUnsubscribe ? "unsubscribed" : "preferences_changed",
      morningEnabled: preferences.morning,
      eveningEnabled: preferences.evening,
      consentPolicyVersion,
      source: "public_signup",
      requestedAt: changedAt,
      confirmedAt: changedAt,
      createdAt: changedAt,
    });
    return true;
  });
}

export async function suppressSubscriber(
  database: Database,
  subscriberId: string,
  reason:
    | "hard_bounce"
    | "complaint"
    | "provider_unsubscribe"
    | "provider_suppressed",
  consentPolicyVersion: string,
  suppressedAt = new Date(),
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const [subscriber] = await transaction
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, subscriberId))
      .for("update");
    if (!subscriber) return false;
    if (subscriber.suppressionReason) {
      return subscriber.suppressionReason === reason;
    }
    await transaction
      .update(subscribers)
      .set({
        status: "unsubscribed",
        morningEnabled: false,
        eveningEnabled: false,
        unsubscribedAt: suppressedAt,
        suppressionReason: reason,
        suppressedAt,
        updatedAt: suppressedAt,
      })
      .where(eq(subscribers.id, subscriber.id));
    await transaction
      .update(subscriberActionTokens)
      .set({ invalidatedAt: suppressedAt })
      .where(
        and(
          eq(subscriberActionTokens.subscriberId, subscriber.id),
          isNull(subscriberActionTokens.consumedAt),
          isNull(subscriberActionTokens.invalidatedAt),
          gt(subscriberActionTokens.expiresAt, suppressedAt),
        ),
      );
    await transaction.insert(subscriberConsentEvents).values({
      subscriberId: subscriber.id,
      kind: "suppressed",
      morningEnabled: false,
      eveningEnabled: false,
      consentPolicyVersion,
      source: "operator_review",
      requestedAt: suppressedAt,
      confirmedAt: suppressedAt,
      createdAt: suppressedAt,
    });
    return true;
  });
}
