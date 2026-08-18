import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getConfig } from "../../../../config/server";
import { getDatabase } from "../../../../db/client";
import { digestRuns } from "../../../../db/schema";
import { parseOnDemandStoryCount } from "../../../../digests/on-demand";

export async function POST(request: Request): Promise<NextResponse> {
  const config = getConfig();
  if (
    !constantTimeEqual(
      request.headers.get("x-digest-trigger-secret") ?? "",
      config.application.digestTriggerSecret,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let storyCount: number;
  try {
    const body = await request.json();
    storyCount = parseOnDemandStoryCount(
      String(body.storyCount ?? config.stories.perRun),
      config.stories.perRun,
    );
  } catch {
    return NextResponse.json({ error: "Invalid story count" }, { status: 400 });
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
  if (!runId)
    return NextResponse.json({ error: "Unable to queue run" }, { status: 503 });
  return NextResponse.json(
    { runId, coalesced },
    { status: created ? 202 : 200 },
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
