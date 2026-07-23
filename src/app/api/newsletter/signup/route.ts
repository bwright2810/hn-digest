import { NextResponse } from "next/server";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { normalizeSubscriberEmail } from "../../../../subscribers/crypto";
import { persistSignupRequest } from "../../../../subscribers/persistence";
import { sendConfirmationMessage } from "../../../../subscribers/provider";
import {
  consumeSignupRateLimit,
  signupClientIdentity,
} from "../../../../subscribers/rate-limit";
import { hasSameOrigin } from "../../../../subscribers/request-security";

export async function POST(request: Request) {
  const config = getConfig();
  if (
    !config.newsletter.publicSignupEnabled ||
    !config.newsletter.resendApiKey ||
    !config.newsletter.fromEmail
  ) {
    return redirect(config.application.url, "unavailable");
  }
  if (!hasSameOrigin(request, config.application.url)) {
    return new NextResponse("Invalid request origin", { status: 403 });
  }

  const form = await request.formData();
  const morning = form.get("morning") === "1";
  const evening = form.get("evening") === "1";
  let email: string;
  try {
    email = normalizeSubscriberEmail(String(form.get("email") ?? ""));
    if (!morning && !evening) throw new RangeError("missing edition");
  } catch {
    return redirect(config.application.url, "invalid");
  }

  const database = getDatabase();
  const allowed = await consumeSignupRateLimit(
    database,
    config.subscribers,
    [`address:${email}`, signupClientIdentity(request.headers)],
    config.newsletter.signupRateLimit,
    config.newsletter.signupRateWindowMs,
  );
  if (!allowed) return redirect(config.application.url, "check-email");

  const result = await persistSignupRequest(database, config.subscribers, {
    email,
    morning,
    evening,
    consentPolicyVersion: config.newsletter.consentPolicyVersion,
  });
  if (result.confirmationToken) {
    const confirmationUrl = new URL(
      "/newsletter/confirm",
      config.application.url,
    );
    confirmationUrl.searchParams.set("token", result.confirmationToken);
    try {
      await sendConfirmationMessage({
        recipient: email,
        confirmationUrl,
        fromEmail: config.newsletter.fromEmail,
        apiKey: config.newsletter.resendApiKey,
      });
    } catch {
      // The public response stays enumeration-safe. A repeat request rotates the
      // token and safely retries confirmation delivery.
    }
  }
  return redirect(config.application.url, "check-email");
}

function redirect(applicationUrl: URL, state: string): NextResponse {
  const url = new URL("/newsletter", applicationUrl);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url, 303);
}
