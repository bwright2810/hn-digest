import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "../db/schema";
import { analysisJobs } from "../db/schema";
import {
  authorizeLlmSubmission,
  type SpendLimits,
} from "../operations/observability";
import { eq } from "drizzle-orm";
import { ConcurrencyGate, HostConcurrencyGate } from "./concurrency";
import {
  claimAnalysisJob,
  finishAnalysisJobAttempt,
  type AttemptOutcome,
  type ClaimedAnalysisJob,
} from "./queue";

type Database = NodePgDatabase<typeof schema>;

export interface WorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly llmConcurrency: number;
  readonly fetchConcurrencyPerHost: number;
  readonly spendLimits: SpendLimits;
}

export class AnalysisWorker {
  readonly llm: ConcurrencyGate;
  readonly fetch: HostConcurrencyGate;

  constructor(
    private readonly db: Database,
    private readonly options: WorkerOptions,
  ) {
    this.llm = new ConcurrencyGate(options.llmConcurrency);
    this.fetch = new HostConcurrencyGate(options.fetchConcurrencyPerHost);
  }

  async processAvailable(
    process: (job: ClaimedAnalysisJob) => Promise<AttemptOutcome | void>,
    onFinished?: (
      job: ClaimedAnalysisJob,
      outcome: AttemptOutcome,
    ) => Promise<void>,
  ): Promise<number> {
    const tasks = Array.from({ length: this.options.llmConcurrency }, () =>
      this.processOne(process, onFinished),
    );
    const results = await Promise.all(tasks);
    return results.filter(Boolean).length;
  }

  private async processOne(
    process: (job: ClaimedAnalysisJob) => Promise<AttemptOutcome | void>,
    onFinished?: (
      job: ClaimedAnalysisJob,
      outcome: AttemptOutcome,
    ) => Promise<void>,
  ): Promise<boolean> {
    const claim = await claimAnalysisJob(this.db, this.options);
    if (!claim) return false;
    await this.llm.run(async () => {
      let outcome: AttemptOutcome;
      try {
        const [job] = await this.db
          .select({ estimatedCostUsd: analysisJobs.estimatedCostUsd })
          .from(analysisJobs)
          .where(eq(analysisJobs.id, claim.id))
          .limit(1);
        if (!job) throw new Error("Claimed analysis job no longer exists");
        const budget = await authorizeLlmSubmission(
          this.db,
          Number(job.estimatedCostUsd),
          this.options.spendLimits,
          new Date(),
          claim.id,
        );
        if (!budget.allowed) {
          outcome = {
            status: "skipped_budget",
            errorCode: budget.reason ?? "spend_hard_limit",
          };
        } else {
          outcome = (await process(claim)) ?? { status: "succeeded" };
        }
      } catch (error) {
        outcome = {
          status: "failed",
          errorCode: classifyError(error),
        };
      }
      await finishAnalysisJobAttempt(this.db, claim, outcome);
      await onFinished?.(claim, outcome);
    });
    return true;
  }
}

function classifyError(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 100);
  }
  return "unknown_worker_error";
}
