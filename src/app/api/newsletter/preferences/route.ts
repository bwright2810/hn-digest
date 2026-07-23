import { NextResponse } from "next/server";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { updateSubscriberPreferences } from "../../../../subscribers/persistence";
import { hasSameOrigin } from "../../../../subscribers/request-security";

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.newsletter.publicSignupEnabled)
    return new NextResponse("Newsletter unavailable", { status: 503 });
  if (!hasSameOrigin(request, config.application.url))
    return new NextResponse("Invalid request origin", { status: 403 });

  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const unsubscribe = form.get("unsubscribe") === "1";
  const preferences = {
    morning: !unsubscribe && form.get("morning") === "1",
    evening: !unsubscribe && form.get("evening") === "1",
  };
  const updated = token
    ? await updateSubscriberPreferences(
        getDatabase(),
        config.subscribers,
        token,
        preferences,
        config.newsletter.consentPolicyVersion,
      )
    : false;
  const url = new URL("/newsletter/preferences", config.application.url);
  url.searchParams.set("state", updated ? "saved" : "invalid");
  if (!updated) url.searchParams.set("token", token);
  return NextResponse.redirect(url, 303);
}
