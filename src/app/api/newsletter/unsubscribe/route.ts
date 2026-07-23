import { NextResponse } from "next/server";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { updateSubscriberPreferences } from "../../../../subscribers/persistence";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const destination = new URL(
    "/newsletter/preferences",
    getConfig().application.url,
  );
  destination.searchParams.set(
    "token",
    requestUrl.searchParams.get("token") ?? "",
  );
  destination.searchParams.set("unsubscribe", "1");
  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.newsletter.deliveryEnabled)
    return new NextResponse(null, { status: 503 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return new NextResponse(null, { status: 400 });
  const updated = await updateSubscriberPreferences(
    getDatabase(),
    config.subscribers,
    token,
    { morning: false, evening: false },
    config.newsletter.consentPolicyVersion,
  );
  return new NextResponse(null, { status: updated ? 200 : 400 });
}
