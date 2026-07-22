import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { digestRuns } from "../../../../db/schema";
import { parseOnDemandStoryCount } from "../../../../digests/on-demand";

export async function POST(request: Request) {
  const config = getConfig();
  const form = await request.formData();
  let storyCount: number;
  try {
    storyCount = parseOnDemandStoryCount(
      String(form.get("storyCount") ?? ""),
      config.stories.perRun,
    );
  } catch {
    return new NextResponse("Invalid story count", { status: 400 });
  }

  const database = getDatabase();
  const [created] = await database
    .insert(digestRuns)
    .values({ trigger: "on_demand", requestedStoryCount: storyCount })
    .onConflictDoNothing()
    .returning({ id: digestRuns.id });

  let runId = created?.id;
  let coalesced = false;
  if (!runId) {
    const [active] = await database
      .select({ id: digestRuns.id })
      .from(digestRuns)
      .where(
        and(
          eq(digestRuns.trigger, "on_demand"),
          inArray(digestRuns.status, ["pending", "collecting", "analyzing"]),
        ),
      )
      .orderBy(desc(digestRuns.createdAt))
      .limit(1);
    runId = active?.id;
    coalesced = true;
  }
  if (!runId) return new NextResponse("Unable to queue run", { status: 503 });

  return NextResponse.redirect(
    adminRunRedirectUrl(config.application.url, runId, coalesced),
    303,
  );
}

export function adminRunRedirectUrl(
  applicationUrl: URL,
  runId: string,
  coalesced: boolean,
): URL {
  const url = new URL("/admin", applicationUrl);
  url.searchParams.set("started", runId);
  if (coalesced) url.searchParams.set("coalesced", "1");
  return url;
}
