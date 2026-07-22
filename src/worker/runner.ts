import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "../db/schema";
import { ConcurrencyGate, HostConcurrencyGate } from "./concurrency";
import {
  claimAnalysisJob,
  finishAnalysisJobAttempt,
  type ClaimedAnalysisJob,
} from "./queue";

type Database = NodePgDatabase<typeof schema>;

export interface WorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly llmConcurrency: number;
  readonly fetchConcurrencyPerHost: number;
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
    process: (job: ClaimedAnalysisJob) => Promise<void>,
  ): Promise<number> {
    const tasks = Array.from({ length: this.options.llmConcurrency }, () =>
      this.processOne(process),
    );
    const results = await Promise.all(tasks);
    return results.filter(Boolean).length;
  }

  private async processOne(
    process: (job: ClaimedAnalysisJob) => Promise<void>,
  ): Promise<boolean> {
    const claim = await claimAnalysisJob(this.db, this.options);
    if (!claim) return false;
    await this.llm.run(async () => {
      try {
        await process(claim);
        await finishAnalysisJobAttempt(this.db, claim, { status: "succeeded" });
      } catch (error) {
        await finishAnalysisJobAttempt(this.db, claim, {
          status: "failed",
          errorCode: classifyError(error),
        });
      }
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
