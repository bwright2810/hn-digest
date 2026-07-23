import { eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { subscriberSignupLimits } from "../db/schema";

import { digestSubscriberValue, type SubscriberKeys } from "./crypto";

type Database = NodePgDatabase<typeof schema>;

export async function consumeSignupRateLimit(
  database: Database,
  keys: SubscriberKeys,
  identities: readonly string[],
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<boolean> {
  const digests = identities.map((identity) =>
    digestSubscriberValue(identity, keys.lookupHmacKey, "rate-limit"),
  );
  return database.transaction(async (transaction) => {
    await transaction
      .delete(subscriberSignupLimits)
      .where(lt(subscriberSignupLimits.expiresAt, now));
    let allowed = true;
    for (const keyDigest of digests) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${keyDigest}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(subscriberSignupLimits)
        .where(eq(subscriberSignupLimits.keyDigest, keyDigest))
        .for("update");
      if (!existing || existing.expiresAt <= now) {
        await transaction
          .insert(subscriberSignupLimits)
          .values({
            keyDigest,
            windowStartedAt: now,
            attemptCount: 1,
            expiresAt: new Date(now.getTime() + windowMs),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: subscriberSignupLimits.keyDigest,
            set: {
              windowStartedAt: now,
              attemptCount: 1,
              expiresAt: new Date(now.getTime() + windowMs),
              updatedAt: now,
            },
          });
      } else {
        const attemptCount = existing.attemptCount + 1;
        await transaction
          .update(subscriberSignupLimits)
          .set({ attemptCount, updatedAt: now })
          .where(eq(subscriberSignupLimits.keyDigest, keyDigest));
        if (attemptCount > limit) allowed = false;
      }
    }
    return allowed;
  });
}

export function signupClientIdentity(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return `client:${realIp}`;
  const forwarded = headers.get("x-forwarded-for");
  const closest = forwarded?.split(",").at(-1)?.trim();
  return `client:${closest || "unavailable"}`;
}
