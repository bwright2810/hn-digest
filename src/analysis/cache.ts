import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import {
  analysisCacheLookups,
  analysisJobs,
  articleAnalyses,
  digestRunStories,
  discussionAnalyses,
} from "../db/schema";

export interface AnalysisCacheComponents {
  readonly articleContentHash: string | null;
  readonly selectedCommentHash: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly model: string;
  readonly reasoningConfig: Readonly<Record<string, unknown>>;
}

export type AnalysisCacheComponent = keyof AnalysisCacheComponents;

export interface AnalysisCacheKeys {
  readonly analysis: string;
  readonly article: string | null;
  readonly discussion: string;
}

export interface AnalysisCacheResolution {
  readonly keys: AnalysisCacheKeys;
  readonly analysisJobId: string | null;
  readonly articleAnalysisId: string | null;
  readonly discussionAnalysisId: string | null;
  readonly changedComponents: readonly AnalysisCacheComponent[];
  readonly shouldSubmitRequest: boolean;
}

type Database = NodePgDatabase<typeof schema>;

const COMPONENT_ORDER: readonly AnalysisCacheComponent[] = [
  "articleContentHash",
  "selectedCommentHash",
  "promptVersion",
  "schemaVersion",
  "model",
  "reasoningConfig",
];

export function createAnalysisCacheKeys(
  components: AnalysisCacheComponents,
): AnalysisCacheKeys {
  validateHash(components.articleContentHash, "articleContentHash", true);
  validateHash(components.selectedCommentHash, "selectedCommentHash", false);

  const shared = {
    promptVersion: components.promptVersion,
    schemaVersion: components.schemaVersion,
    model: components.model,
    reasoningConfig: components.reasoningConfig,
  };
  return {
    analysis: hash({ kind: "analysis", ...components }),
    article:
      components.articleContentHash === null
        ? null
        : hash({
            kind: "article",
            articleContentHash: components.articleContentHash,
            ...shared,
          }),
    discussion: hash({
      kind: "discussion",
      articleContentHash: components.articleContentHash,
      selectedCommentHash: components.selectedCommentHash,
      ...shared,
    }),
  };
}

export function explainAnalysisCacheMiss(
  current: AnalysisCacheComponents,
  previous: AnalysisCacheComponents | null,
): readonly AnalysisCacheComponent[] {
  if (previous === null) return COMPONENT_ORDER;
  return COMPONENT_ORDER.filter(
    (component) =>
      stableJson(current[component]) !== stableJson(previous[component]),
  );
}

export async function resolveAnalysisCache(
  db: Database,
  storyId: number,
  components: AnalysisCacheComponents,
): Promise<AnalysisCacheResolution> {
  const keys = createAnalysisCacheKeys(components);
  const [job, article, discussion, previous] = await Promise.all([
    db.query.analysisJobs.findFirst({
      columns: { id: true },
      where: and(
        eq(analysisJobs.cacheKey, keys.analysis),
        eq(analysisJobs.status, "succeeded"),
      ),
    }),
    keys.article === null
      ? Promise.resolve(undefined)
      : db.query.articleAnalyses.findFirst({
          columns: { id: true },
          where: eq(articleAnalyses.cacheKey, keys.article),
        }),
    db.query.discussionAnalyses.findFirst({
      columns: { id: true },
      where: eq(discussionAnalyses.cacheKey, keys.discussion),
    }),
    db
      .select({
        articleContentHash: analysisJobs.articleContentHash,
        selectedCommentHash: analysisJobs.selectedCommentHash,
        promptVersion: analysisJobs.promptVersion,
        schemaVersion: analysisJobs.schemaVersion,
        model: analysisJobs.model,
        reasoningConfig: analysisJobs.reasoningConfig,
      })
      .from(analysisJobs)
      .innerJoin(
        digestRunStories,
        eq(analysisJobs.digestRunStoryId, digestRunStories.id),
      )
      .where(
        and(
          eq(digestRunStories.storyId, storyId),
          eq(analysisJobs.status, "succeeded"),
        ),
      )
      .orderBy(desc(analysisJobs.finishedAt), desc(analysisJobs.createdAt))
      .limit(1),
  ]);

  const previousComponents = previous[0] ?? null;
  await db.insert(analysisCacheLookups).values({
    storyId,
    cacheKey: keys.analysis,
    hit: job !== undefined,
  });
  return {
    keys,
    analysisJobId: job?.id ?? null,
    articleAnalysisId: article?.id ?? null,
    discussionAnalysisId: discussion?.id ?? null,
    changedComponents: job
      ? []
      : explainAnalysisCacheMiss(components, previousComponents),
    shouldSubmitRequest: job === undefined,
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function validateHash(
  value: string | null,
  name: string,
  nullable: boolean,
): void {
  if (value === null && nullable) return;
  if (value === null || !/^[a-f\d]{64}$/u.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  }
}
