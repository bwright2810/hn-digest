import { createHmac } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import {
  digestRuns,
  newsletterDeliveries,
  subscriberActionTokens,
  subscribers,
} from "../db/schema";
import { PostgresDigestReader } from "../digests/reader";
import {
  decryptSubscriberEmail,
  digestSubscriberValue,
  type SubscriberKeys,
} from "../subscribers/crypto";

import { DeliveryProviderError, type DeliveryProvider } from "./provider";
import { renderNewsletter } from "./render";

type Database = NodePgDatabase<typeof schema>;
type Edition = "morning" | "evening";

export interface NewsletterDeliveryOptions {
  readonly applicationUrl: URL;
  readonly fromEmail: string;
  readonly replyToEmail: string;
  readonly postalAddress: string;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly maximumAttempts: number;
  readonly morningTime: string;
  readonly eveningTime: string;
  readonly keys: SubscriberKeys;
}

export interface DeliveryIterationResult {
  readonly queued: number;
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
}

export class NewsletterDeliveryWorker {
  constructor(
    private readonly database: Database,
    private readonly provider: DeliveryProvider,
    private readonly options: NewsletterDeliveryOptions,
  ) {
    for (const [name, value, maximum] of [
      ["batchSize", options.batchSize, 100],
      ["concurrency", options.concurrency, 5],
      ["maximumAttempts", options.maximumAttempts, 5],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0 || value > maximum)
        throw new RangeError(`${name} must be between 1 and ${maximum}`);
    }
  }

  async process(now = new Date()): Promise<DeliveryIterationResult> {
    const queued = await this.enqueueDeliverableRuns(now);
    const claims = await this.claim(now);
    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (
      let offset = 0;
      offset < claims.length;
      offset += this.options.concurrency
    ) {
      const outcomes = await Promise.all(
        claims
          .slice(offset, offset + this.options.concurrency)
          .map((claim) => this.deliver(claim, now)),
      );
      for (const outcome of outcomes) {
        if (outcome === "sent") sent += 1;
        else if (outcome === "retry") retried += 1;
        else failed += 1;
      }
    }
    return { queued, claimed: claims.length, sent, retried, failed };
  }

  private async enqueueDeliverableRuns(now: Date): Promise<number> {
    const runs = await this.database
      .select({
        id: digestRuns.id,
        scheduleKey: digestRuns.scheduleKey,
      })
      .from(digestRuns)
      .where(
        and(
          eq(digestRuns.trigger, "scheduled"),
          inArray(digestRuns.status, ["complete", "partial"]),
          lte(digestRuns.newsletterReadyAt, now),
        ),
      );
    let count = 0;
    for (const run of runs) {
      const edition = editionFromScheduleKey(
        run.scheduleKey,
        this.options.morningTime,
        this.options.eveningTime,
      );
      if (!edition) continue;
      const eligible = await this.database
        .select({ id: subscribers.id })
        .from(subscribers)
        .where(
          and(
            eq(subscribers.status, "confirmed"),
            isNull(subscribers.suppressionReason),
            isNull(subscribers.unsubscribedAt),
            eq(
              edition === "morning"
                ? subscribers.morningEnabled
                : subscribers.eveningEnabled,
              true,
            ),
          ),
        );
      if (eligible.length === 0) continue;
      const inserted = await this.database
        .insert(newsletterDeliveries)
        .values(
          eligible.map(({ id }) => ({
            digestRunId: run.id,
            subscriberId: id,
            edition,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: newsletterDeliveries.id });
      count += inserted.length;
    }
    return count;
  }

  private async claim(now: Date) {
    return this.database.transaction(async (transaction) => {
      const available = await transaction
        .select({ id: newsletterDeliveries.id })
        .from(newsletterDeliveries)
        .where(
          and(
            or(
              inArray(newsletterDeliveries.status, ["pending", "retry"]),
              and(
                eq(newsletterDeliveries.status, "sending"),
                lte(
                  newsletterDeliveries.sendingStartedAt,
                  new Date(now.getTime() - 60_000),
                ),
              ),
            ),
            lte(newsletterDeliveries.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(newsletterDeliveries.createdAt))
        .limit(this.options.batchSize)
        .for("update", { skipLocked: true });
      if (available.length === 0) return [];
      return transaction
        .update(newsletterDeliveries)
        .set({
          status: "sending",
          attemptCount: sql`${newsletterDeliveries.attemptCount} + 1`,
          sendingStartedAt: now,
          updatedAt: now,
        })
        .where(
          inArray(
            newsletterDeliveries.id,
            available.map(({ id }) => id),
          ),
        )
        .returning();
    });
  }

  private async deliver(
    delivery: typeof newsletterDeliveries.$inferSelect,
    now: Date,
  ): Promise<"sent" | "retry" | "failed"> {
    try {
      const [subscriber, digest] = await Promise.all([
        this.database.query.subscribers.findFirst({
          where: eq(subscribers.id, delivery.subscriberId),
        }),
        new PostgresDigestReader(this.database).byId(delivery.digestRunId),
      ]);
      const stillEligible =
        subscriber &&
        subscriber.status === "confirmed" &&
        !subscriber.suppressionReason &&
        (delivery.edition === "morning"
          ? subscriber.morningEnabled
          : subscriber.eveningEnabled);
      if (
        !stillEligible ||
        !subscriber.emailCiphertext ||
        !digest ||
        (digest.status !== "complete" && digest.status !== "partial")
      ) {
        return await this.finishFailed(delivery.id, "ineligible", now);
      }
      const token = await this.ensureDeliveryPreferenceToken(
        delivery.id,
        subscriber.id,
        delivery.createdAt,
      );
      const preferences = new URL(
        "/newsletter/preferences",
        this.options.applicationUrl,
      );
      preferences.searchParams.set("token", token);
      const unsubscribe = new URL(
        "/api/newsletter/unsubscribe",
        this.options.applicationUrl,
      );
      unsubscribe.searchParams.set("token", token);
      const rendered = renderNewsletter(
        digest,
        delivery.edition,
        {
          canonicalDigest: this.options.applicationUrl,
          preferences,
          unsubscribe,
        },
        this.options.postalAddress,
      );
      const result = await this.provider.send({
        recipient: decryptSubscriberEmail(
          subscriber.emailCiphertext,
          this.options.keys.emailEncryptionKey,
        ),
        from: this.options.fromEmail,
        replyTo: this.options.replyToEmail,
        ...rendered,
        unsubscribeUrl: unsubscribe,
        idempotencyKey: `digest/${delivery.id}`,
      });
      await this.database
        .update(newsletterDeliveries)
        .set({
          status: "sent",
          providerMessageId: result.messageId,
          providerStatus: "sent",
          providerStatusAt: now,
          sentAt: now,
          sendingStartedAt: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(newsletterDeliveries.id, delivery.id));
      return "sent";
    } catch (error) {
      const retryable =
        error instanceof DeliveryProviderError && error.retryable;
      const code =
        error instanceof DeliveryProviderError ? error.code : "internal";
      if (retryable && delivery.attemptCount < this.options.maximumAttempts) {
        const nextAttemptAt = new Date(
          now.getTime() + 1_000 * 2 ** delivery.attemptCount,
        );
        await this.database
          .update(newsletterDeliveries)
          .set({
            status: "retry",
            lastErrorCode: code,
            nextAttemptAt,
            sendingStartedAt: null,
            updatedAt: now,
          })
          .where(eq(newsletterDeliveries.id, delivery.id));
        return "retry";
      }
      return this.finishFailed(delivery.id, code, now);
    }
  }

  private async finishFailed(
    id: string,
    code: string,
    now: Date,
  ): Promise<"failed"> {
    await this.database
      .update(newsletterDeliveries)
      .set({
        status: "failed",
        lastErrorCode: code,
        failedAt: now,
        sendingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(newsletterDeliveries.id, id));
    return "failed";
  }

  private async ensureDeliveryPreferenceToken(
    deliveryId: string,
    subscriberId: string,
    createdAt: Date,
  ): Promise<string> {
    const token = createHmac("sha256", this.options.keys.lookupHmacKey)
      .update(`hn-digest:delivery-preferences:v1\0${deliveryId}`)
      .digest("base64url");
    const tokenDigest = digestSubscriberValue(
      token,
      this.options.keys.lookupHmacKey,
      "action-token",
    );
    await this.database
      .insert(subscriberActionTokens)
      .values({
        subscriberId,
        purpose: "preferences",
        tokenDigest,
        tokenKeyVersion: this.options.keys.keyVersion,
        expiresAt: new Date(createdAt.getTime() + 45 * 24 * 60 * 60 * 1_000),
        createdAt,
      })
      .onConflictDoNothing();
    return token;
  }
}

export function editionFromScheduleKey(
  value: string | null,
  morningTime: string,
  eveningTime: string,
): Edition | null {
  const time = value?.split("|")[2];
  if (time === morningTime) return "morning";
  if (time === eveningTime) return "evening";
  return null;
}
