import { summarizeStorySources } from "../src/articles/source-discovery";
import { HackerNewsClient } from "../src/hn/client";
import type { HackerNewsStory } from "../src/hn/schemas";

async function main(): Promise<void> {
  const limit = parseLimit(process.argv[2]);
  if (process.argv[3] !== undefined) usage();
  const client = new HackerNewsClient({ concurrency: 8 });
  const ids = (await client.getTopStoryIds()).slice(0, limit);
  const items = await client.getItems(ids);
  const sources = items.flatMap((item, index) =>
    isAvailableStory(item) ? [{ rank: index + 1, story: item }] : [],
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        requestedStories: ids.length,
        availableStories: sources.length,
        minimumCommentCount: 10,
        metrics: summarizeStorySources(sources, 10),
      },
      null,
      2,
    )}\n`,
  );
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 500) usage();
  return parsed;
}

function isAvailableStory(value: unknown): value is HackerNewsStory {
  return Boolean(
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "story" &&
    !("deleted" in value && value.deleted) &&
    !("dead" in value && value.dead),
  );
}

function usage(): never {
  throw new Error("Usage: node source-discovery.js [story-limit: 1-500]");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
