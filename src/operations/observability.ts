import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

export interface SpendLimits {
  readonly dailySoftLimitUsd: number;
  readonly dailyHardLimitUsd: number;
  readonly monthlySoftLimitUsd: number;
  readonly monthlyHardLimitUsd: number;
}

export interface SpendBudgetState {
  readonly dailySpendUsd: number;
  readonly monthlySpendUsd: number;
  readonly projectedDailySpendUsd: number;
  readonly projectedMonthlySpendUsd: number;
  readonly dailySoftLimitReached: boolean;
  readonly monthlySoftLimitReached: boolean;
  readonly allowed: boolean;
  readonly reason: "daily_hard_limit" | "monthly_hard_limit" | null;
}

export interface OperationalSnapshot {
  readonly generatedAt: Date;
  readonly runs: {
    readonly completed: number;
    readonly failed: number;
    readonly averageDurationMs: number;
    readonly latestScheduledFailureAt: Date | null;
  };
  readonly fetches: { readonly failed: number; readonly extracted: number };
  readonly sourceAcquisition: readonly SourceAcquisitionMetric[];
  readonly queue: { readonly queued: number; readonly running: number };
  readonly llm: {
    readonly failedJobs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly actualCostUsd: number;
  };
  readonly cache: {
    readonly hits: number;
    readonly misses: number;
    readonly hitRate: number | null;
  };
  readonly unacknowledgedAlerts: number;
}

export interface SourceAcquisitionMetric {
  readonly sourceType: string;
  readonly contentType: string;
  readonly outcome:
    | "access_restriction"
    | "unsupported_content_type"
    | "fetch_failure"
    | "extraction_failure"
    | "low_confidence"
    | "extracted";
  readonly count: number;
}

export function evaluateSpendBudget(
  dailySpendUsd: number,
  monthlySpendUsd: number,
  estimatedRequestCostUsd: number,
  limits: SpendLimits,
): SpendBudgetState {
  validateMoney(dailySpendUsd, "dailySpendUsd", true);
  validateMoney(monthlySpendUsd, "monthlySpendUsd", true);
  validateMoney(estimatedRequestCostUsd, "estimatedRequestCostUsd", true);
  validateLimits(limits);
  const projectedDailySpendUsd = roundUsd(
    dailySpendUsd + estimatedRequestCostUsd,
  );
  const projectedMonthlySpendUsd = roundUsd(
    monthlySpendUsd + estimatedRequestCostUsd,
  );
  const reason =
    projectedDailySpendUsd > limits.dailyHardLimitUsd
      ? "daily_hard_limit"
      : projectedMonthlySpendUsd > limits.monthlyHardLimitUsd
        ? "monthly_hard_limit"
        : null;
  return {
    dailySpendUsd,
    monthlySpendUsd,
    projectedDailySpendUsd,
    projectedMonthlySpendUsd,
    dailySoftLimitReached: dailySpendUsd >= limits.dailySoftLimitUsd,
    monthlySoftLimitReached: monthlySpendUsd >= limits.monthlySoftLimitUsd,
    allowed: reason === null,
    reason,
  };
}

export async function authorizeLlmSubmission(
  db: Database,
  estimatedRequestCostUsd: number,
  limits: SpendLimits,
  now = new Date(),
  analysisJobId?: string,
): Promise<SpendBudgetState> {
  validateMoney(estimatedRequestCostUsd, "estimatedRequestCostUsd", true);
  validateLimits(limits);
  const { dayStart, monthStart } = utcPeriodStarts(now);
  return db.transaction(async (transaction) => {
    // Serialize budget decisions so concurrent workers cannot all pass against
    // the same spend total. The lock is released with this transaction.
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(48440071)`);
    const result = await transaction.execute<{
      daily_spend: string;
      monthly_spend: string;
      reserved_spend: string;
    }>(sql`
      SELECT
        COALESCE(SUM(actual_cost_usd) FILTER (WHERE created_at >= ${dayStart}), 0)::text AS daily_spend,
        COALESCE(SUM(actual_cost_usd) FILTER (WHERE created_at >= ${monthStart}), 0)::text AS monthly_spend,
        (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM analysis_jobs
          WHERE status = 'running' AND (
            ${analysisJobId ?? null}::uuid IS NULL OR EXISTS (
              SELECT 1 FROM analysis_jobs current_job
              WHERE current_job.id = ${analysisJobId ?? null}::uuid
                AND (
                  analysis_jobs.started_at < current_job.started_at OR
                  (analysis_jobs.started_at = current_job.started_at AND analysis_jobs.id::text < current_job.id::text)
                )
            )
          ))::text AS reserved_spend
      FROM llm_usage
      WHERE created_at >= ${monthStart} AND created_at < ${now}
    `);
    const row = result.rows[0];
    const reservedSpend = Number(row?.reserved_spend ?? 0);
    return evaluateSpendBudget(
      Number(row?.daily_spend ?? 0) + reservedSpend,
      Number(row?.monthly_spend ?? 0) + reservedSpend,
      estimatedRequestCostUsd,
      limits,
    );
  });
}

export async function collectOperationalSnapshot(
  db: Database,
  options: { readonly from?: Date; readonly now?: Date } = {},
): Promise<OperationalSnapshot> {
  const now = options.now ?? new Date();
  const from = options.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  if (from >= now) throw new RangeError("from must be earlier than now");
  const result = await db.execute<Record<string, unknown>>(sql`
    SELECT
      (SELECT COUNT(*) FROM digest_runs WHERE status IN ('complete', 'partial') AND created_at >= ${from} AND created_at < ${now})::int AS runs_completed,
      (SELECT COUNT(*) FROM digest_runs WHERE status = 'failed' AND created_at >= ${from} AND created_at < ${now})::int AS runs_failed,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000), 0) FROM digest_runs WHERE status IN ('complete', 'partial', 'failed') AND created_at >= ${from} AND created_at < ${now})::float8 AS average_run_ms,
      (SELECT MAX(updated_at) FROM digest_runs WHERE trigger = 'scheduled' AND status = 'failed') AS latest_scheduled_failure_at,
      (SELECT COUNT(*) FROM documents WHERE status IN ('failed', 'unsupported', 'access_restricted') AND updated_at >= ${from} AND updated_at < ${now})::int AS fetches_failed,
      (SELECT COUNT(*) FROM documents WHERE status IN ('extracted', 'low_confidence') AND updated_at >= ${from} AND updated_at < ${now})::int AS fetches_extracted,
      (SELECT COUNT(*) FROM analysis_jobs WHERE status = 'queued')::int AS jobs_queued,
      (SELECT COUNT(*) FROM analysis_jobs WHERE status = 'running')::int AS jobs_running,
      (SELECT COUNT(*) FROM analysis_jobs WHERE status IN ('failed', 'refused', 'incomplete') AND updated_at >= ${from} AND updated_at < ${now})::int AS llm_failed_jobs,
      (SELECT COALESCE(SUM(input_tokens), 0) FROM llm_usage WHERE created_at >= ${from} AND created_at < ${now})::int AS input_tokens,
      (SELECT COALESCE(SUM(output_tokens), 0) FROM llm_usage WHERE created_at >= ${from} AND created_at < ${now})::int AS output_tokens,
      (SELECT COALESCE(SUM(actual_cost_usd), 0) FROM llm_usage WHERE created_at >= ${from} AND created_at < ${now})::text AS actual_cost_usd,
      (SELECT COUNT(*) FROM analysis_cache_lookups WHERE hit AND created_at >= ${from} AND created_at < ${now})::int AS cache_hits,
      (SELECT COUNT(*) FROM analysis_cache_lookups WHERE NOT hit AND created_at >= ${from} AND created_at < ${now})::int AS cache_misses,
      (SELECT COUNT(*) FROM operational_alerts WHERE acknowledged_at IS NULL)::int AS unacknowledged_alerts
  `);
  const sourceResult = await db.execute<Record<string, unknown>>(sql`
    SELECT
      CASE
        WHEN extraction_metadata->>'sourceType' IN ('html', 'plain_text', 'markdown', 'pdf', 'image', 'audio', 'video', 'structured_data', 'feed_or_xml', 'hn_text_post')
          THEN extraction_metadata->>'sourceType'
        ELSE 'unknown'
      END AS source_type,
      CASE
        WHEN extraction_metadata->>'contentType' IN ('text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'text/x-markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'audio/mpeg', 'video/mp4', 'application/json', 'application/xml', 'text/xml')
          THEN extraction_metadata->>'contentType'
        ELSE 'unknown_or_other'
      END AS content_type,
      CASE
        WHEN status = 'access_restricted' THEN 'access_restriction'
        WHEN status = 'unsupported' THEN 'unsupported_content_type'
        WHEN status = 'failed' THEN 'fetch_failure'
        WHEN status = 'low_confidence' AND extraction_metadata->'extraction'->>'status' = 'empty' THEN 'extraction_failure'
        WHEN status = 'low_confidence' THEN 'low_confidence'
        ELSE 'extracted'
      END AS outcome,
      COUNT(*)::int AS count
    FROM documents
    WHERE updated_at >= ${from} AND updated_at < ${now} AND status <> 'pending'
    GROUP BY source_type, content_type, outcome
    ORDER BY count DESC, source_type, content_type, outcome
  `);
  const row = result.rows[0] ?? {};
  const hits = number(row.cache_hits);
  const misses = number(row.cache_misses);
  return {
    generatedAt: now,
    runs: {
      completed: number(row.runs_completed),
      failed: number(row.runs_failed),
      averageDurationMs: number(row.average_run_ms),
      latestScheduledFailureAt: date(row.latest_scheduled_failure_at),
    },
    fetches: {
      failed: number(row.fetches_failed),
      extracted: number(row.fetches_extracted),
    },
    sourceAcquisition: sourceResult.rows.map((metric) => ({
      sourceType: String(metric.source_type),
      contentType: String(metric.content_type),
      outcome: sourceOutcome(metric.outcome),
      count: number(metric.count),
    })),
    queue: {
      queued: number(row.jobs_queued),
      running: number(row.jobs_running),
    },
    llm: {
      failedJobs: number(row.llm_failed_jobs),
      inputTokens: number(row.input_tokens),
      outputTokens: number(row.output_tokens),
      actualCostUsd: number(row.actual_cost_usd),
    },
    cache: {
      hits,
      misses,
      hitRate: hits + misses === 0 ? null : hits / (hits + misses),
    },
    unacknowledgedAlerts: number(row.unacknowledged_alerts),
  };
}

function sourceOutcome(value: unknown): SourceAcquisitionMetric["outcome"] {
  const outcome = String(value);
  if (
    outcome === "access_restriction" ||
    outcome === "unsupported_content_type" ||
    outcome === "fetch_failure" ||
    outcome === "extraction_failure" ||
    outcome === "low_confidence" ||
    outcome === "extracted"
  )
    return outcome;
  return "fetch_failure";
}

export async function refreshOperationalAlerts(
  db: Database,
  limits: SpendLimits,
  now = new Date(),
): Promise<void> {
  const { dayStart, monthStart } = utcPeriodStarts(now);
  const budget = await authorizeLlmSubmission(db, 0, limits, now);
  const alerts = [
    budget.dailySoftLimitReached
      ? {
          kind: "daily_spend_soft_limit",
          key: `daily-spend:${dayStart.toISOString().slice(0, 10)}`,
          message: "Daily LLM spend has reached its configured soft limit.",
          spend: budget.dailySpendUsd,
          limit: limits.dailySoftLimitUsd,
        }
      : null,
    budget.monthlySoftLimitReached
      ? {
          kind: "monthly_spend_soft_limit",
          key: `monthly-spend:${monthStart.toISOString().slice(0, 7)}`,
          message: "Monthly LLM spend has reached its configured soft limit.",
          spend: budget.monthlySpendUsd,
          limit: limits.monthlySoftLimitUsd,
        }
      : null,
  ].filter((alert) => alert !== null);
  for (const alert of alerts) {
    await db.execute(sql`
      INSERT INTO operational_alerts (kind, deduplication_key, message, metadata)
      VALUES (${alert.kind}::operational_alert_kind, ${alert.key}, ${alert.message}, ${JSON.stringify({ spendUsd: alert.spend, limitUsd: alert.limit })}::jsonb)
      ON CONFLICT (deduplication_key) DO NOTHING
    `);
  }
  await db.execute(sql`
    INSERT INTO operational_alerts (kind, deduplication_key, message, metadata)
    SELECT 'scheduled_run_failed', 'scheduled-run-failed:' || id::text,
      'A scheduled digest run failed.', jsonb_build_object('digestRunId', id, 'errorCode', error_code)
    FROM digest_runs
    WHERE trigger = 'scheduled' AND status = 'failed'
    ON CONFLICT (deduplication_key) DO NOTHING
  `);
}

export function utcPeriodStarts(now: Date): {
  readonly dayStart: Date;
  readonly monthStart: Date;
} {
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be valid");
  return {
    dayStart: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ),
    monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function validateLimits(limits: SpendLimits): void {
  for (const [name, value] of Object.entries(limits))
    validateMoney(value, name, false);
  if (limits.dailySoftLimitUsd > limits.dailyHardLimitUsd)
    throw new RangeError("daily soft limit must not exceed daily hard limit");
  if (limits.monthlySoftLimitUsd > limits.monthlyHardLimitUsd)
    throw new RangeError(
      "monthly soft limit must not exceed monthly hard limit",
    );
}

function validateMoney(value: number, name: string, allowZero: boolean): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
    throw new RangeError(
      `${name} must be ${allowZero ? "nonnegative" : "positive"}`,
    );
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}
