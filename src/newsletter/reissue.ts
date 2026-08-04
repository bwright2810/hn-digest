import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { newsletterDeliveries } from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export async function reissueNewsletterDelivery(
  database: Database,
  sourceDeliveryId: string,
  now = new Date(),
): Promise<{ readonly id: string; readonly sequence: number }> {
  return database.transaction(async (transaction) => {
    const [source] = await transaction
      .select()
      .from(newsletterDeliveries)
      .where(eq(newsletterDeliveries.id, sourceDeliveryId))
      .for("update")
      .limit(1);
    if (!source) throw new RangeError("delivery not found");
    if (source.status !== "sent")
      throw new RangeError("only a sent delivery can be reissued");

    const [latest] = await transaction
      .select({
        id: newsletterDeliveries.id,
        sequence: newsletterDeliveries.sequence,
      })
      .from(newsletterDeliveries)
      .where(
        and(
          eq(newsletterDeliveries.digestRunId, source.digestRunId),
          eq(newsletterDeliveries.subscriberId, source.subscriberId),
        ),
      )
      .orderBy(desc(newsletterDeliveries.sequence))
      .limit(1);
    if (latest?.id !== source.id)
      throw new RangeError("only the latest delivery can be reissued");
    const sequence = (latest?.sequence ?? 0) + 1;
    const [delivery] = await transaction
      .insert(newsletterDeliveries)
      .values({
        digestRunId: source.digestRunId,
        subscriberId: source.subscriberId,
        edition: source.edition,
        sequence,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: newsletterDeliveries.id });
    if (!delivery) throw new Error("delivery reissue was not created");
    return { id: delivery.id, sequence };
  });
}
