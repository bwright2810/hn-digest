import { desc, eq, sql } from "drizzle-orm";

import { getConfig } from "../src/config/server";
import { createDatabase } from "../src/db/client";
import {
  newsletterDeliveries,
  subscriberConsentEvents,
  subscribers,
} from "../src/db/schema";
import {
  decryptSubscriberEmail,
  digestSubscriberValue,
  normalizeSubscriberEmail,
} from "../src/subscribers/crypto";
import { cleanupSubscriberData } from "../src/subscribers/lifecycle";

async function main() {
  const [command, rawEmail, confirmation] = process.argv.slice(2);
  const config = getConfig();
  const connection = createDatabase(config.database.url);

  try {
    if (command === "cleanup") {
      console.log(JSON.stringify(await cleanupSubscriberData(connection.db)));
    } else if (command === "export" || command === "delete") {
      if (!rawEmail) throw new Error("an email argument is required");
      const email = normalizeSubscriberEmail(rawEmail);
      const digest = digestSubscriberValue(
        email,
        config.subscribers.lookupHmacKey,
        "email",
      );
      const subscriber = await connection.db.query.subscribers.findFirst({
        where: eq(subscribers.emailLookupDigest, digest),
      });
      if (!subscriber) throw new Error("subscriber not found");
      if (command === "export") {
        const [consent, deliveries] = await Promise.all([
          connection.db
            .select()
            .from(subscriberConsentEvents)
            .where(eq(subscriberConsentEvents.subscriberId, subscriber.id))
            .orderBy(desc(subscriberConsentEvents.createdAt)),
          connection.db
            .select({
              edition: newsletterDeliveries.edition,
              status: newsletterDeliveries.status,
              sentAt: newsletterDeliveries.sentAt,
              providerStatus: newsletterDeliveries.providerStatus,
            })
            .from(newsletterDeliveries)
            .where(eq(newsletterDeliveries.subscriberId, subscriber.id)),
        ]);
        console.log(
          JSON.stringify(
            {
              email: subscriber.emailCiphertext
                ? decryptSubscriberEmail(
                    subscriber.emailCiphertext,
                    config.subscribers.emailEncryptionKey,
                  )
                : null,
              status: subscriber.status,
              preferences: {
                morning: subscriber.morningEnabled,
                evening: subscriber.eveningEnabled,
              },
              confirmedAt: subscriber.confirmedAt,
              unsubscribedAt: subscriber.unsubscribedAt,
              suppressionReason: subscriber.suppressionReason,
              consent,
              deliveries,
            },
            null,
            2,
          ),
        );
      } else {
        if (confirmation !== "--confirm")
          throw new Error(
            "deletion requires --confirm after the email argument",
          );
        await connection.db.transaction(async (transaction) => {
          const now = new Date();
          await transaction.execute(sql`
          delete from subscriber_action_tokens
          where subscriber_id = ${subscriber.id}
        `);
          await transaction.execute(sql`
          delete from newsletter_deliveries
          where subscriber_id = ${subscriber.id}
        `);
          await transaction.execute(sql`
          delete from subscriber_consent_events
          where subscriber_id = ${subscriber.id}
            and id not in (
              select id from subscriber_consent_events
              where subscriber_id = ${subscriber.id}
              order by created_at desc, id desc limit 1
            )
        `);
          await transaction.execute(sql`
          update subscribers
          set status = 'unsubscribed', morning_enabled = false,
              evening_enabled = false, email_ciphertext = null,
              email_encryption_key_version = null,
              unsubscribed_at = coalesce(unsubscribed_at, ${now}),
              updated_at = ${now}
          where id = ${subscriber.id} and email_lookup_digest = ${digest}
        `);
        });
        console.log(JSON.stringify({ deleted: true }));
      }
    } else {
      throw new Error(
        "usage: subscribers.ts cleanup | export <email> | delete <email> --confirm",
      );
    }
  } finally {
    await connection.pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "subscriber_command_failed",
  );
  process.exitCode = 1;
});
