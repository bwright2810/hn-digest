import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const digestRunStatus = pgEnum("digest_run_status", [
  "pending",
  "collecting",
  "analyzing",
  "complete",
  "partial",
  "failed",
]);

export const digestRunTrigger = pgEnum("digest_run_trigger", [
  "scheduled",
  "on_demand",
]);

export const documentStatus = pgEnum("document_status", [
  "pending",
  "extracted",
  "low_confidence",
  "failed",
  "unsupported",
  "access_restricted",
]);

export const digestStoryStatus = pgEnum("digest_story_status", [
  "pending",
  "collecting",
  "analyzing",
  "complete",
  "discussion_only",
  "failed",
]);

export const analysisJobStatus = pgEnum("analysis_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped_budget",
  "refused",
  "incomplete",
]);

export const analysisJobAttemptStatus = pgEnum("analysis_job_attempt_status", [
  "running",
  "succeeded",
  "failed",
  "abandoned",
]);

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trigger: digestRunTrigger("trigger").notNull(),
    scheduleKey: varchar("schedule_key", { length: 160 }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    requestedStoryCount: integer("requested_story_count").notNull(),
    status: digestRunStatus("status").default("pending").notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("digest_runs_schedule_key_unique")
      .on(table.scheduleKey)
      .where(sql`${table.scheduleKey} is not null`),
    index("digest_runs_scheduled_for_idx").on(table.scheduledFor),
    index("digest_runs_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "digest_runs_requested_story_count_positive",
      sql`${table.requestedStoryCount} > 0`,
    ),
  ],
);

export const stories = pgTable(
  "stories",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    hnItemId: bigint("hn_item_id", { mode: "number" }).notNull(),
    type: varchar("type", { length: 32 }).default("story").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    text: text("text"),
    textHash: varchar("text_hash", { length: 64 }),
    author: text("author"),
    hnCreatedAt: timestamp("hn_created_at", { withTimezone: true }).notNull(),
    latestScore: integer("latest_score"),
    latestCommentCount: integer("latest_comment_count"),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("stories_hn_item_id_unique").on(table.hnItemId),
    index("stories_url_idx").on(table.url),
    index("stories_hn_created_at_idx").on(table.hnCreatedAt),
    check("stories_hn_item_id_positive", sql`${table.hnItemId} > 0`),
  ],
);

export const storySnapshots = pgTable(
  "story_snapshots",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    digestRunId: uuid("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    score: integer("score").notNull(),
    commentCount: integer("comment_count").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    text: text("text"),
    textHash: varchar("text_hash", { length: 64 }),
    author: text("author"),
    hnCreatedAt: timestamp("hn_created_at", { withTimezone: true }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadataHash: varchar("metadata_hash", { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex("story_snapshots_run_story_unique").on(
      table.digestRunId,
      table.storyId,
    ),
    uniqueIndex("story_snapshots_run_rank_unique").on(
      table.digestRunId,
      table.rank,
    ),
    index("story_snapshots_story_collected_at_idx").on(
      table.storyId,
      table.collectedAt,
    ),
    index("story_snapshots_metadata_hash_idx").on(table.metadataHash),
    check("story_snapshots_rank_positive", sql`${table.rank} > 0`),
    check("story_snapshots_score_nonnegative", sql`${table.score} >= 0`),
    check(
      "story_snapshots_comment_count_nonnegative",
      sql`${table.commentCount} >= 0`,
    ),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    hnItemId: bigint("hn_item_id", { mode: "number" }).notNull(),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    parentHnItemId: bigint("parent_hn_item_id", { mode: "number" }),
    parentCommentId: bigint("parent_comment_id", { mode: "number" }).references(
      (): AnyPgColumn => comments.id,
      { onDelete: "set null" },
    ),
    author: text("author"),
    text: text("text"),
    contentHash: varchar("content_hash", { length: 64 }),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    isDead: boolean("is_dead").default(false).notNull(),
    hnCreatedAt: timestamp("hn_created_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("comments_hn_item_id_unique").on(table.hnItemId),
    index("comments_story_parent_idx").on(table.storyId, table.parentHnItemId),
    index("comments_parent_comment_idx").on(table.parentCommentId),
    index("comments_content_hash_idx").on(table.contentHash),
    check("comments_hn_item_id_positive", sql`${table.hnItemId} > 0`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url"),
    status: documentStatus("status").default("pending").notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    title: text("title"),
    byline: text("byline"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    extractedText: text("extracted_text"),
    extractionMetadata: jsonb("extraction_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("documents_story_source_hash_unique")
      .on(table.storyId, table.sourceUrl, table.contentHash)
      .where(sql`${table.contentHash} is not null`),
    index("documents_source_url_idx").on(table.sourceUrl),
    index("documents_canonical_url_idx").on(table.canonicalUrl),
    index("documents_content_hash_idx").on(table.contentHash),
    index("documents_story_status_idx").on(table.storyId, table.status),
  ],
);

export const digestRunStories = pgTable(
  "digest_run_stories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    digestRunId: uuid("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    storySnapshotId: bigint("story_snapshot_id", { mode: "number" })
      .notNull()
      .references(() => storySnapshots.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    status: digestStoryStatus("status").default("pending").notNull(),
    failureCode: varchar("failure_code", { length: 100 }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("digest_run_stories_run_story_unique").on(
      table.digestRunId,
      table.storyId,
    ),
    uniqueIndex("digest_run_stories_run_rank_unique").on(
      table.digestRunId,
      table.rank,
    ),
    uniqueIndex("digest_run_stories_snapshot_unique").on(table.storySnapshotId),
    index("digest_run_stories_status_idx").on(table.status),
    check("digest_run_stories_rank_positive", sql`${table.rank} > 0`),
  ],
);

export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    digestRunStoryId: uuid("digest_run_story_id")
      .notNull()
      .references(() => digestRunStories.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    cacheKey: varchar("cache_key", { length: 64 }).notNull(),
    articleContentHash: varchar("article_content_hash", { length: 64 }),
    selectedCommentHash: varchar("selected_comment_hash", {
      length: 64,
    }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    reasoningConfig: jsonb("reasoning_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    contextMetadata: jsonb("context_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: analysisJobStatus("status").default("queued").notNull(),
    estimatedInputTokens: integer("estimated_input_tokens").notNull(),
    maximumOutputTokens: integer("maximum_output_tokens").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 14,
      scale: 8,
    }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 100 }),
    leaseOwner: varchar("lease_owner", { length: 160 }),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("analysis_jobs_cache_key_unique").on(table.cacheKey),
    index("analysis_jobs_status_available_at_idx").on(
      table.status,
      table.availableAt,
    ),
    index("analysis_jobs_digest_run_story_idx").on(table.digestRunStoryId),
    index("analysis_jobs_lease_idx").on(table.status, table.leasedUntil),
    index("analysis_jobs_versions_model_idx").on(
      table.promptVersion,
      table.schemaVersion,
      table.model,
    ),
    check(
      "analysis_jobs_estimated_input_tokens_nonnegative",
      sql`${table.estimatedInputTokens} >= 0`,
    ),
    check(
      "analysis_jobs_maximum_output_tokens_positive",
      sql`${table.maximumOutputTokens} > 0`,
    ),
    check(
      "analysis_jobs_estimated_cost_nonnegative",
      sql`${table.estimatedCostUsd} >= 0`,
    ),
    check(
      "analysis_jobs_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const analysisJobAttempts = pgTable(
  "analysis_job_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisJobId: uuid("analysis_job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    workerId: varchar("worker_id", { length: 160 }).notNull(),
    status: analysisJobAttemptStatus("status").default("running").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 100 }),
  },
  (table) => [
    uniqueIndex("analysis_job_attempts_job_attempt_unique").on(
      table.analysisJobId,
      table.attempt,
    ),
    index("analysis_job_attempts_status_idx").on(table.status, table.startedAt),
    check("analysis_job_attempts_attempt_positive", sql`${table.attempt} > 0`),
  ],
);

export const articleAnalyses = pgTable(
  "article_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisJobId: uuid("analysis_job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    cacheKey: varchar("cache_key", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("article_analyses_job_unique").on(table.analysisJobId),
    uniqueIndex("article_analyses_cache_key_unique").on(table.cacheKey),
    index("article_analyses_content_hash_idx").on(table.contentHash),
    index("article_analyses_versions_model_idx").on(
      table.promptVersion,
      table.schemaVersion,
      table.model,
    ),
    check(
      "article_analyses_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
  ],
);

export const discussionAnalyses = pgTable(
  "discussion_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisJobId: uuid("analysis_job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    cacheKey: varchar("cache_key", { length: 64 }).notNull(),
    selectedCommentHash: varchar("selected_comment_hash", {
      length: 64,
    }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    citedCommentIds: jsonb("cited_comment_ids")
      .$type<number[]>()
      .default([])
      .notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("discussion_analyses_job_unique").on(table.analysisJobId),
    uniqueIndex("discussion_analyses_cache_key_unique").on(table.cacheKey),
    index("discussion_analyses_comment_hash_idx").on(table.selectedCommentHash),
    index("discussion_analyses_versions_model_idx").on(
      table.promptVersion,
      table.schemaVersion,
      table.model,
    ),
    check(
      "discussion_analyses_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
  ],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisJobId: uuid("analysis_job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 160 }),
    model: varchar("model", { length: 120 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cachedReadTokens: integer("cached_read_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    reasoningTokens: integer("reasoning_tokens").default(0).notNull(),
    priceAssumptions: jsonb("price_assumptions")
      .$type<Record<string, unknown>>()
      .notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 14,
      scale: 8,
    }).notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 14, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("llm_usage_job_attempt_unique").on(
      table.analysisJobId,
      table.attempt,
    ),
    uniqueIndex("llm_usage_provider_request_unique")
      .on(table.providerRequestId)
      .where(sql`${table.providerRequestId} is not null`),
    index("llm_usage_model_prompt_created_idx").on(
      table.model,
      table.promptVersion,
      table.createdAt,
    ),
    check("llm_usage_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "llm_usage_token_counts_nonnegative",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.cachedReadTokens} >= 0 and ${table.cacheWriteTokens} >= 0 and ${table.reasoningTokens} >= 0`,
    ),
    check(
      "llm_usage_estimated_cost_nonnegative",
      sql`${table.estimatedCostUsd} >= 0`,
    ),
    check(
      "llm_usage_actual_cost_nonnegative",
      sql`${table.actualCostUsd} is null or ${table.actualCostUsd} >= 0`,
    ),
  ],
);
