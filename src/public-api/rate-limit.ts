import { eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { publicApiRateLimits } from "../db/schema";
import { digestSubscriberValue } from "../subscribers/crypto";

type Database = NodePgDatabase<typeof schema>;

export interface PublicApiRateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;
}

export async function consumePublicApiRateLimit(
  database: Database,
  hmacKey: Buffer,
  identity: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<PublicApiRateLimitResult> {
  const keyDigest = digestSubscriberValue(
    identity,
    hmacKey,
    "public-api-rate-limit",
  );
  return database.transaction(async (transaction) => {
    await transaction
      .delete(publicApiRateLimits)
      .where(lt(publicApiRateLimits.expiresAt, now));
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${keyDigest}, 0))`,
    );
    const [existing] = await transaction
      .select()
      .from(publicApiRateLimits)
      .where(eq(publicApiRateLimits.keyDigest, keyDigest))
      .for("update");
    const resetAt = new Date(now.getTime() + windowMs);
    if (!existing || existing.expiresAt <= now) {
      await transaction
        .insert(publicApiRateLimits)
        .values({
          keyDigest,
          windowStartedAt: now,
          requestCount: 1,
          expiresAt: resetAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: publicApiRateLimits.keyDigest,
          set: {
            windowStartedAt: now,
            requestCount: 1,
            expiresAt: resetAt,
            updatedAt: now,
          },
        });
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetAt,
      };
    }
    const requestCount = existing.requestCount + 1;
    await transaction
      .update(publicApiRateLimits)
      .set({ requestCount, updatedAt: now })
      .where(eq(publicApiRateLimits.keyDigest, keyDigest));
    return {
      allowed: requestCount <= limit,
      limit,
      remaining: Math.max(0, limit - requestCount),
      resetAt: existing.expiresAt,
    };
  });
}
