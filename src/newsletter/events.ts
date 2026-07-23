import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import * as schema from "../db/schema";
import {
  newsletterDeliveries,
  newsletterProviderEvents,
  subscriberConsentEvents,
  subscribers,
} from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

const supportedEventTypes = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
  "email.unsubscribed",
] as const;

const providerEventSchema = z.object({
  type: z.string().max(80),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1).max(160),
    bounce: z.object({ type: z.string().max(80).optional() }).optional(),
    suppressed: z.object({ type: z.string().max(100).optional() }).optional(),
  }),
});

export interface VerifiedProviderEvent {
  readonly providerEventId: string;
  readonly payload: unknown;
}

export interface ProviderEventResult {
  readonly outcome: "processed" | "duplicate" | "ignored";
}

export async function processProviderEvent(
  database: Database,
  event: VerifiedProviderEvent,
  consentPolicyVersion: string,
  receivedAt = new Date(),
): Promise<ProviderEventResult> {
  if (!event.providerEventId || event.providerEventId.length > 160)
    throw new Error("invalid_provider_event_id");
  const parsed = providerEventSchema.safeParse(event.payload);
  if (!parsed.success) throw new Error("invalid_provider_event");
  if (!isSupportedEventType(parsed.data.type)) return { outcome: "ignored" };
  const eventType = parsed.data.type;

  const occurredAt = new Date(parsed.data.created_at);
  return database.transaction(async (transaction) => {
    const [delivery] = await transaction
      .select({
        id: newsletterDeliveries.id,
        subscriberId: newsletterDeliveries.subscriberId,
      })
      .from(newsletterDeliveries)
      .where(
        eq(newsletterDeliveries.providerMessageId, parsed.data.data.email_id),
      )
      .limit(1);
    // Confirmation messages and other provider traffic are intentionally not
    // retained because they have no digest-delivery record.
    if (!delivery) return { outcome: "ignored" as const };

    const [inserted] = await transaction
      .insert(newsletterProviderEvents)
      .values({
        providerEventId: event.providerEventId,
        deliveryId: delivery.id,
        type: eventType,
        providerOccurredAt: occurredAt,
        detailCode: classifyDetail(parsed.data),
        receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: newsletterProviderEvents.id });
    if (!inserted) return { outcome: "duplicate" as const };

    const providerStatus = statusForEvent(eventType);
    await transaction
      .update(newsletterDeliveries)
      .set({
        providerStatus,
        providerStatusAt: occurredAt,
        updatedAt: receivedAt,
      })
      .where(
        and(
          eq(newsletterDeliveries.id, delivery.id),
          or(
            isNull(newsletterDeliveries.providerStatusAt),
            lte(newsletterDeliveries.providerStatusAt, occurredAt),
          ),
        ),
      );

    const suppressionReason = suppressionForEvent(eventType);
    if (suppressionReason) {
      const [suppressed] = await transaction
        .update(subscribers)
        .set({
          suppressionReason,
          suppressedAt: receivedAt,
          ...(suppressionReason === "provider_unsubscribe"
            ? {
                status: "unsubscribed" as const,
                morningEnabled: false,
                eveningEnabled: false,
                unsubscribedAt: receivedAt,
              }
            : {}),
          updatedAt: receivedAt,
        })
        .where(
          and(
            eq(subscribers.id, delivery.subscriberId),
            isNull(subscribers.suppressionReason),
          ),
        )
        .returning({
          morningEnabled: subscribers.morningEnabled,
          eveningEnabled: subscribers.eveningEnabled,
        });
      if (suppressed) {
        await transaction.insert(subscriberConsentEvents).values({
          subscriberId: delivery.subscriberId,
          kind: "suppressed",
          morningEnabled: suppressed.morningEnabled,
          eveningEnabled: suppressed.eveningEnabled,
          consentPolicyVersion,
          source: "operator_review",
          requestedAt: occurredAt,
          confirmedAt: occurredAt,
          createdAt: receivedAt,
        });
      }
    }
    return { outcome: "processed" as const };
  });
}

export async function refreshNewsletterAlerts(
  database: Database,
  now = new Date(),
): Promise<void> {
  const from = new Date(now.getTime() - 60 * 60 * 1_000);
  const bucket = now.toISOString().slice(0, 13);
  await database.execute(sql`
    INSERT INTO operational_alerts (kind, deduplication_key, message, metadata)
    SELECT 'newsletter_sustained_send_failures',
      ${`newsletter-send-failures:${bucket}`},
      'Newsletter delivery failures are sustained above the operator threshold.',
      jsonb_build_object(
        'windowMinutes', 60,
        'failedCount', COUNT(*) FILTER (WHERE status = 'failed'),
        'deliveryCount', COUNT(*)
      )
    FROM newsletter_deliveries
    WHERE updated_at >= ${from} AND updated_at < ${now}
      AND status IN ('sent', 'failed')
    HAVING COUNT(*) FILTER (WHERE status = 'failed') >= 3
      AND COUNT(*) FILTER (WHERE status = 'failed')::numeric / COUNT(*) >= 0.25
    ON CONFLICT (deduplication_key) DO NOTHING
  `);
  await database.execute(sql`
    INSERT INTO operational_alerts (kind, deduplication_key, message, metadata)
    SELECT 'newsletter_provider_rejection',
      'newsletter-provider-rejection:' || id::text,
      'The newsletter provider rejected a delivery request.',
      jsonb_build_object('deliveryId', id, 'errorCode', last_error_code)
    FROM newsletter_deliveries
    WHERE updated_at >= ${from} AND updated_at < ${now}
      AND last_error_code IN ('authentication', 'rejected')
    ON CONFLICT (deduplication_key) DO NOTHING
  `);
}

function isSupportedEventType(
  type: string,
): type is (typeof supportedEventTypes)[number] {
  return supportedEventTypes.some((supported) => supported === type);
}

function statusForEvent(type: (typeof supportedEventTypes)[number]) {
  return type.slice("email.".length).replace("delivery_", "") as
    | "sent"
    | "delivered"
    | "delayed"
    | "failed"
    | "bounced"
    | "complained"
    | "suppressed"
    | "unsubscribed";
}

function suppressionForEvent(type: (typeof supportedEventTypes)[number]) {
  if (type === "email.bounced") return "hard_bounce" as const;
  if (type === "email.complained") return "complaint" as const;
  if (type === "email.suppressed") return "provider_suppressed" as const;
  if (type === "email.unsubscribed") return "provider_unsubscribe" as const;
  return null;
}

function classifyDetail(
  event: z.infer<typeof providerEventSchema>,
): string | null {
  if (event.type === "email.bounced")
    return event.data.bounce?.type === "Permanent"
      ? "permanent"
      : "provider_bounce";
  if (event.type === "email.complained") return "spam_complaint";
  if (event.type === "email.suppressed") return "provider_suppression_list";
  if (event.type === "email.failed") return "provider_failure";
  return null;
}
