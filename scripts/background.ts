import { hostname } from "node:os";

import { getConfig } from "../src/config/server";
import { createDatabase } from "../src/db/client";
import { DigestPipeline } from "../src/pipeline/digest-pipeline";
import { runPollLoop } from "../src/runtime/poll-loop";
import { ensureScheduledDigestRun } from "../src/scheduler/digest-scheduler";
import { AnalysisWorker } from "../src/worker/runner";

const config = getConfig();
const connection = createDatabase(config.database.url);
const controller = new AbortController();
const workerId = `${hostname()}:${process.pid}`;
const pipeline = new DigestPipeline(connection.db, config);
const worker = new AnalysisWorker(connection.db, {
  workerId,
  leaseMs: config.worker.leaseMs,
  llmConcurrency: config.worker.llmConcurrency,
  fetchConcurrencyPerHost: config.worker.fetchConcurrencyPerHost,
  spendLimits: config.spend,
});

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function logFailure(loop: string, error: unknown) {
  const code = error instanceof Error ? error.name : "unknown_error";
  console.error(
    JSON.stringify({ event: "background_iteration_failed", loop, code }),
  );
}

async function schedulerIteration() {
  const result = await ensureScheduledDigestRun(
    connection.db,
    {
      timeZone: config.schedule.timeZone,
      morningTime: config.schedule.morningTime,
      eveningTime: config.schedule.eveningTime,
      storyCount: config.stories.perRun,
      missedRunGraceMs: config.schedule.missedRunGraceMs,
    },
    new Date(),
  );
  if (result.created)
    log("scheduled_digest_created", {
      runId: result.runId,
      scheduleKey: result.slot?.key,
    });
  const runId = await pipeline.processNextRun();
  if (runId) log("digest_run_enqueued", { runId });
}

async function workerIteration() {
  const processed = await worker.processAvailable(
    (claim) => pipeline.processClaimedJob(claim),
    (claim, outcome) => pipeline.finishClaimedJob(claim, outcome),
  );
  if (processed > 0) log("analysis_jobs_processed", { count: processed });
}

async function main() {
  await connection.pool.query("SELECT 1");
  log("background_runtime_started", { workerId });
  await Promise.all([
    runPollLoop({
      name: "scheduler",
      intervalMs: config.runtime.schedulerPollIntervalMs,
      signal: controller.signal,
      run: schedulerIteration,
      onError: (error) => logFailure("scheduler", error),
    }),
    runPollLoop({
      name: "worker",
      intervalMs: config.worker.pollIntervalMs,
      signal: controller.signal,
      run: workerIteration,
      onError: (error) => logFailure("worker", error),
    }),
  ]);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => controller.abort());
}

void main()
  .catch((error: unknown) => {
    logFailure("startup", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.pool.end();
    log("background_runtime_stopped");
  });
