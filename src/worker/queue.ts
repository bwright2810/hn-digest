import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export interface ClaimedAnalysisJob {
  readonly id: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly leasedUntil: Date;
}

export type AttemptOutcome =
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly errorCode: string }
  | {
      readonly status: "retry";
      readonly errorCode: string;
      readonly availableAt: Date;
    };

export async function claimAnalysisJob(
  db: Database,
  options: {
    readonly workerId: string;
    readonly leaseMs: number;
    readonly now?: Date;
  },
): Promise<ClaimedAnalysisJob | null> {
  validateWorkerOptions(options.workerId, options.leaseMs);
  const now = options.now ?? new Date();
  const leasedUntil = new Date(now.getTime() + options.leaseMs);

  return db.transaction(async (transaction) => {
    const result = await transaction.execute<{
      id: string;
      attempt_count: number;
      lease_owner: string;
      leased_until: Date;
    }>(sql`
      WITH candidate AS (
        SELECT id
        FROM analysis_jobs
        WHERE (
          (status = 'queued' AND available_at <= ${now})
          OR (status = 'running' AND (leased_until IS NULL OR leased_until <= ${now}))
        )
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), abandoned AS (
        UPDATE analysis_job_attempts
        SET status = 'abandoned', finished_at = ${now}, error_code = 'lease_expired'
        WHERE analysis_job_id = (SELECT id FROM candidate)
          AND status = 'running'
      ), claimed AS (
        UPDATE analysis_jobs
        SET status = 'running', lease_owner = ${options.workerId},
            leased_until = ${leasedUntil}, started_at = ${now},
            finished_at = NULL, error_code = NULL,
            attempt_count = attempt_count + 1, updated_at = ${now}
        WHERE id = (SELECT id FROM candidate)
        RETURNING id, attempt_count, lease_owner, leased_until
      ), recorded AS (
        INSERT INTO analysis_job_attempts (
          analysis_job_id, attempt, worker_id, status, started_at
        )
        SELECT id, attempt_count, lease_owner, 'running', ${now}
        FROM claimed
        RETURNING analysis_job_id
      )
      SELECT claimed.* FROM claimed
      INNER JOIN recorded ON recorded.analysis_job_id = claimed.id
    `);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          attempt: row.attempt_count,
          workerId: row.lease_owner,
          leasedUntil: row.leased_until,
        }
      : null;
  });
}

export async function extendAnalysisJobLease(
  db: Database,
  claim: ClaimedAnalysisJob,
  leaseMs: number,
  now = new Date(),
): Promise<boolean> {
  validateWorkerOptions(claim.workerId, leaseMs);
  const leasedUntil = new Date(now.getTime() + leaseMs);
  const result = await db.execute(sql`
    UPDATE analysis_jobs
    SET leased_until = ${leasedUntil}, updated_at = ${now}
    WHERE id = ${claim.id} AND status = 'running'
      AND lease_owner = ${claim.workerId} AND attempt_count = ${claim.attempt}
  `);
  return result.rowCount === 1;
}

export async function finishAnalysisJobAttempt(
  db: Database,
  claim: ClaimedAnalysisJob,
  outcome: AttemptOutcome,
  now = new Date(),
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const nextStatus = outcome.status === "retry" ? "queued" : outcome.status;
    const errorCode = outcome.status === "succeeded" ? null : outcome.errorCode;
    const availableAt =
      outcome.status === "retry" ? outcome.availableAt : claim.leasedUntil;
    const result = await transaction.execute<{ id: string }>(sql`
      UPDATE analysis_jobs
      SET status = ${nextStatus}, error_code = ${errorCode},
          available_at = ${availableAt}, finished_at = ${
            outcome.status === "retry" ? null : now
          },
          lease_owner = NULL, leased_until = NULL, updated_at = ${now}
      WHERE id = ${claim.id} AND status = 'running'
        AND lease_owner = ${claim.workerId} AND attempt_count = ${claim.attempt}
      RETURNING id
    `);
    if (result.rowCount !== 1) return false;

    await transaction.execute(sql`
      UPDATE analysis_job_attempts
      SET status = ${outcome.status === "retry" ? "failed" : outcome.status},
          finished_at = ${now}, error_code = ${errorCode}
      WHERE analysis_job_id = ${claim.id} AND attempt = ${claim.attempt}
        AND worker_id = ${claim.workerId} AND status = 'running'
    `);
    return true;
  });
}

function validateWorkerOptions(workerId: string, leaseMs: number): void {
  if (!workerId.trim() || workerId.length > 160) {
    throw new RangeError("workerId must contain 1 to 160 characters");
  }
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new RangeError("leaseMs must be a positive integer");
  }
}
