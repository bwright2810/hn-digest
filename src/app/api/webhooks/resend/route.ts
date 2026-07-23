import { Webhook } from "svix";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { processProviderEvent } from "../../../../newsletter/events";

export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  const secret = config.newsletter.resendWebhookSecret;
  if (!secret) return new Response("Webhook unavailable", { status: 503 });

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature)
    return new Response("Invalid webhook", { status: 400 });

  let payload: unknown;
  try {
    const rawBody = await request.text();
    payload = new Webhook(secret).verify(rawBody, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    });
  } catch {
    return new Response("Invalid webhook", { status: 400 });
  }

  try {
    await processProviderEvent(
      getDatabase(),
      { providerEventId: id, payload },
      config.newsletter.consentPolicyVersion,
    );
    return new Response(null, { status: 200 });
  } catch {
    // A generic response avoids reflecting payload details or schema failures.
    return new Response("Webhook processing failed", { status: 400 });
  }
}
