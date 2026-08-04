import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export interface SubscriberCleanupResult {
  readonly tokens: number;
  readonly unconfirmedSubscribers: number;
  readonly deliveries: number;
  readonly minimizedSubscribers: number;
}

const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);

export async function cleanupSubscriberData(
  database: Database,
  now = new Date(),
): Promise<SubscriberCleanupResult> {
  const sevenDaysAgo = daysBefore(now, 7);
  const thirtyDaysAgo = daysBefore(now, 30);
  const ninetyDaysAgo = daysBefore(now, 90);

  return database.transaction(async (transaction) => {
    const tokens = await transaction.execute(sql`
      delete from subscriber_action_tokens
      where (purpose = 'confirmation'
          and coalesce(consumed_at, invalidated_at, expires_at) < ${sevenDaysAgo})
        or (purpose = 'preferences' and expires_at < ${daysBefore(now, 45)})
    `);
    const unconfirmed = await transaction.execute(sql`
      delete from subscribers s
      where s.status = 'unconfirmed'
        and s.suppression_reason is null
        and s.updated_at < ${sevenDaysAgo}
        and not exists (
          select 1 from subscriber_action_tokens t
          where t.subscriber_id = s.id and t.expires_at >= ${sevenDaysAgo}
        )
    `);
    const deliveries = await transaction.execute(sql`
      delete from newsletter_deliveries
      where status in ('sent', 'failed')
        and coalesce(sent_at, failed_at, updated_at) < ${ninetyDaysAgo}
    `);
    const minimized = await transaction.execute(sql`
      with eligible as (
        select id from subscribers
        where status = 'unsubscribed'
          and unsubscribed_at < ${thirtyDaysAgo}
          and email_ciphertext is not null
        for update
      ), deleted_tokens as (
        delete from subscriber_action_tokens
        where subscriber_id in (select id from eligible)
      ), deleted_deliveries as (
        delete from newsletter_deliveries
        where subscriber_id in (select id from eligible)
      ), ranked_consent as (
        select id, row_number() over (
          partition by subscriber_id order by created_at desc, id desc
        ) as position
        from subscriber_consent_events
        where subscriber_id in (select id from eligible)
      ), deleted_consent as (
        delete from subscriber_consent_events
        where id in (select id from ranked_consent where position > 1)
      )
      update subscribers
      set email_ciphertext = null,
          email_encryption_key_version = null,
          updated_at = ${now}
      where id in (select id from eligible)
    `);
    return {
      tokens: tokens.rowCount ?? 0,
      unconfirmedSubscribers: unconfirmed.rowCount ?? 0,
      deliveries: deliveries.rowCount ?? 0,
      minimizedSubscribers: minimized.rowCount ?? 0,
    };
  });
}
