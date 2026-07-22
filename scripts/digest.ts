import { createDatabase } from "../src/db/client";
import { getConfig } from "../src/config/server";
import {
  getDigestRunProgress,
  parseOnDemandStoryCount,
} from "../src/digests/on-demand";
import { HackerNewsClient } from "../src/hn/client";
import {
  ActiveOnDemandRunError,
  ingestTopStories,
  PostgresDigestRunStore,
} from "../src/ingestion/top-stories";

async function main(): Promise<void> {
  const config = getConfig();
  const connection = createDatabase(config.database.url);

  try {
    const [command, argument, extra] = process.argv.slice(2);
    if (extra !== undefined) usage();

    if (command === "run") {
      const storyCount = parseOnDemandStoryCount(
        argument,
        config.stories.perRun,
      );
      try {
        const result = await ingestTopStories({
          storyCount,
          client: new HackerNewsClient(),
          store: new PostgresDigestRunStore(connection.db),
          onRunCreated: (runId) =>
            writeJson({ event: "started", runId, storyCount }),
        });
        writeJson({ event: "finished", coalesced: false, ...result });
      } catch (error) {
        if (error instanceof ActiveOnDemandRunError) {
          const progress = await getDigestRunProgress(
            connection.db,
            error.runId,
          );
          writeJson({ coalesced: true, runId: error.runId, progress });
          return;
        }
        throw error;
      }
      return;
    }

    if (command === "status" && argument) {
      const progress = await getDigestRunProgress(connection.db, argument);
      if (!progress) {
        process.stderr.write(`Digest run not found: ${argument}\n`);
        process.exitCode = 2;
        return;
      }
      writeJson(progress);
      return;
    }

    usage();
  } finally {
    await connection.pool.end();
  }
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): never {
  throw new Error(
    "Usage: pnpm digest:run [story-count] | pnpm digest:status <run-id>",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
