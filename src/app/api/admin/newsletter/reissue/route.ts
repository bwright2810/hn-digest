import { z } from "zod";

import { getConfig } from "../../../../../config/server";
import { getDatabase } from "../../../../../db/client";
import { reissueNewsletterDelivery } from "../../../../../newsletter/reissue";

const requestSchema = z.object({ deliveryId: z.uuid() }).strict();

export async function POST(request: Request) {
  const config = getConfig();
  if (request.headers.get("origin") !== config.application.url.origin)
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const delivery = await reissueNewsletterDelivery(
      getDatabase(),
      parsed.data.deliveryId,
    );
    return Response.json({ queued: true, delivery });
  } catch (error) {
    if (error instanceof RangeError)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
