import { and, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { analysisJobs, digestRunStories, llmUsage } from "../db/schema";
import type { AnalysisUsage } from "./openai-client";

export const LLM_PRICE_ASSUMPTIONS_VERSION = "llm-prices-v1";

export interface LlmPriceAssumptions {
  readonly version: string;
  readonly currency: "USD";
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly cachedReadUsdPerMillionTokens: number;
  readonly cacheWriteUsdPerMillionTokens: number;
}

export interface RecordLlmUsageInput {
  readonly analysisJobId: string;
  readonly attempt: number;
  readonly providerRequestId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly usage: AnalysisUsage;
  readonly estimatedCostUsd: number;
  readonly prices: LlmPriceAssumptions;
}

export interface UsageReportFilter {
  readonly from?: Date;
  readonly to?: Date;
  readonly model?: string;
  readonly promptVersion?: string;
}

export interface UsageReportRow {
  readonly storyId: number;
  readonly digestRunId: string;
  readonly day: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly attempts: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number;
}

type Database = NodePgDatabase<typeof schema>;

export function calculateActualCostUsd(
  usage: AnalysisUsage,
  prices: LlmPriceAssumptions,
): number {
  validateUsage(usage);
  validatePrices(prices);

  // Cache categories are included in input_tokens, so subtract them before
  // applying the normal input rate and then price each category independently.
  const uncachedInputTokens =
    usage.inputTokens - usage.cachedReadTokens - usage.cacheWriteTokens;
  if (uncachedInputTokens < 0) {
    throw new RangeError(
      "cachedReadTokens plus cacheWriteTokens must not exceed inputTokens",
    );
  }

  return roundUsd(
    (uncachedInputTokens * prices.inputUsdPerMillionTokens +
      usage.cachedReadTokens * prices.cachedReadUsdPerMillionTokens +
      usage.cacheWriteTokens * prices.cacheWriteUsdPerMillionTokens +
      usage.outputTokens * prices.outputUsdPerMillionTokens) /
      1_000_000,
  );
}

export async function recordLlmUsage(
  db: Database,
  input: RecordLlmUsageInput,
): Promise<void> {
  if (!Number.isInteger(input.attempt) || input.attempt <= 0) {
    throw new RangeError("attempt must be a positive integer");
  }
  requireNonnegativeMoney(input.estimatedCostUsd, "estimatedCostUsd");
  const actualCostUsd = calculateActualCostUsd(input.usage, input.prices);

  await db.insert(llmUsage).values({
    analysisJobId: input.analysisJobId,
    attempt: input.attempt,
    providerRequestId: input.providerRequestId,
    model: input.model,
    promptVersion: input.promptVersion,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedReadTokens: input.usage.cachedReadTokens,
    cacheWriteTokens: input.usage.cacheWriteTokens,
    reasoningTokens: input.usage.reasoningTokens,
    priceAssumptions: { ...input.prices },
    estimatedCostUsd: input.estimatedCostUsd.toFixed(8),
    actualCostUsd: actualCostUsd.toFixed(8),
  });
}

export async function getUsageReport(
  db: Database,
  filter: UsageReportFilter = {},
): Promise<UsageReportRow[]> {
  const conditions = [
    filter.from ? gte(llmUsage.createdAt, filter.from) : undefined,
    filter.to ? lt(llmUsage.createdAt, filter.to) : undefined,
    filter.model ? eq(llmUsage.model, filter.model) : undefined,
    filter.promptVersion
      ? eq(llmUsage.promptVersion, filter.promptVersion)
      : undefined,
  ].filter((condition) => condition !== undefined);
  const rows = await db
    .select({
      storyId: digestRunStories.storyId,
      digestRunId: digestRunStories.digestRunId,
      createdAt: llmUsage.createdAt,
      model: llmUsage.model,
      promptVersion: llmUsage.promptVersion,
      inputTokens: llmUsage.inputTokens,
      outputTokens: llmUsage.outputTokens,
      cachedReadTokens: llmUsage.cachedReadTokens,
      cacheWriteTokens: llmUsage.cacheWriteTokens,
      reasoningTokens: llmUsage.reasoningTokens,
      estimatedCostUsd: llmUsage.estimatedCostUsd,
      actualCostUsd: llmUsage.actualCostUsd,
    })
    .from(llmUsage)
    .innerJoin(analysisJobs, eq(llmUsage.analysisJobId, analysisJobs.id))
    .innerJoin(
      digestRunStories,
      eq(analysisJobs.digestRunStoryId, digestRunStories.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(llmUsage.createdAt, llmUsage.id);

  const groups = new Map<string, UsageReportRow>();
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    const key = JSON.stringify([
      row.storyId,
      row.digestRunId,
      day,
      row.model,
      row.promptVersion,
    ]);
    const current = groups.get(key);
    groups.set(key, {
      storyId: row.storyId,
      digestRunId: row.digestRunId,
      day,
      model: row.model,
      promptVersion: row.promptVersion,
      attempts: (current?.attempts ?? 0) + 1,
      inputTokens: (current?.inputTokens ?? 0) + row.inputTokens,
      outputTokens: (current?.outputTokens ?? 0) + row.outputTokens,
      cachedReadTokens: (current?.cachedReadTokens ?? 0) + row.cachedReadTokens,
      cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + row.cacheWriteTokens,
      reasoningTokens: (current?.reasoningTokens ?? 0) + row.reasoningTokens,
      estimatedCostUsd: roundUsd(
        (current?.estimatedCostUsd ?? 0) + Number(row.estimatedCostUsd),
      ),
      actualCostUsd: roundUsd(
        (current?.actualCostUsd ?? 0) + Number(row.actualCostUsd ?? 0),
      ),
    });
  }
  return [...groups.values()];
}

function validateUsage(usage: AnalysisUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a nonnegative integer`);
    }
  }
}

function validatePrices(prices: LlmPriceAssumptions): void {
  if (!prices.version.trim())
    throw new RangeError("prices.version is required");
  if (prices.currency !== "USD")
    throw new RangeError("prices.currency must be USD");
  for (const [name, value] of Object.entries(prices)) {
    if (name.endsWith("UsdPerMillionTokens")) {
      requireNonnegativeMoney(value as number, `prices.${name}`);
    }
  }
}

function requireNonnegativeMoney(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative number`);
  }
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}
