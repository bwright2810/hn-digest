import { hostname } from "node:os";

import { getConfig } from "../src/config/server";
import { createDatabase } from "../src/db/client";
import { DigestPipeline } from "../src/pipeline/digest-pipeline";
import { NewsletterDeliveryWorker } from "../src/newsletter/delivery";
import { refreshNewsletterAlerts } from "../src/newsletter/events";
import { cleanupSubscriberData } from "../src/subscribers/lifecycle";
import { ResendDeliveryProvider } from "../src/newsletter/provider";
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
const newsletterWorker =
  config.newsletter.deliveryEnabled &&
  config.newsletter.resendApiKey &&
  config.newsletter.fromEmail
    ? new NewsletterDeliveryWorker(
        connection.db,
        new ResendDeliveryProvider(config.newsletter.resendApiKey),
        {
          applicationUrl: config.application.url,
          fromEmail: config.newsletter.fromEmail,
          replyToEmail: config.newsletter.replyToEmail,
          postalAddress: config.newsletter.postalAddress,
          batchSize: config.newsletter.deliveryBatchSize,
          concurrency: config.newsletter.deliveryConcurrency,
          maximumAttempts: config.newsletter.deliveryMaximumAttempts,
          morningTime: config.schedule.morningTime,
          eveningTime: config.schedule.eveningTime,
          keys: config.subscribers,
        },
      )
    : null;

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

async function newsletterIteration() {
  if (!newsletterWorker) return;
  const result = await newsletterWorker.process();
  await refreshNewsletterAlerts(connection.db);
  if (result.queued > 0 || result.claimed > 0) {
    log("newsletter_delivery_iteration", { ...result });
  }
}

async function retentionIteration() {
  const result = await cleanupSubscriberData(connection.db);
  if (Object.values(result).some((count) => count > 0))
    log("subscriber_retention_completed", { ...result });
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
    runPollLoop({
      name: "newsletter",
      intervalMs: config.newsletter.deliveryPollIntervalMs,
      signal: controller.signal,
      run: newsletterIteration,
      onError: (error) => logFailure("newsletter", error),
    }),
    runPollLoop({
      name: "subscriber-retention",
      intervalMs: config.newsletter.retentionPollIntervalMs,
      signal: controller.signal,
      run: retentionIteration,
      onError: (error) => logFailure("subscriber-retention", error),
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
