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

export const operationalAlertKind = pgEnum("operational_alert_kind", [
  "daily_spend_soft_limit",
  "monthly_spend_soft_limit",
  "scheduled_run_failed",
  "newsletter_sustained_send_failures",
  "newsletter_provider_rejection",
]);

export const subscriberStatus = pgEnum("subscriber_status", [
  "unconfirmed",
  "confirmed",
  "unsubscribed",
]);

export const subscriberSuppressionReason = pgEnum(
  "subscriber_suppression_reason",
  ["hard_bounce", "complaint", "provider_unsubscribe", "provider_suppressed"],
);

export const subscriberConsentEventKind = pgEnum(
  "subscriber_consent_event_kind",
  [
    "signup_requested",
    "subscription_confirmed",
    "preferences_changed",
    "unsubscribed",
    "resubscribe_requested",
    "suppressed",
    "suppression_cleared",
  ],
);

export const subscriberConsentSource = pgEnum("subscriber_consent_source", [
  "public_signup",
  "operator_review",
]);

export const subscriberActionTokenPurpose = pgEnum(
  "subscriber_action_token_purpose",
  ["confirmation", "preferences"],
);

export const newsletterEdition = pgEnum("newsletter_edition", [
  "morning",
  "evening",
]);

export const newsletterDeliveryStatus = pgEnum("newsletter_delivery_status", [
  "pending",
  "sending",
  "retry",
  "sent",
  "failed",
]);

export const newsletterProviderStatus = pgEnum("newsletter_provider_status", [
  "sent",
  "delivered",
  "delayed",
  "failed",
  "bounced",
  "complained",
  "suppressed",
  "unsubscribed",
]);

export const newsletterProviderEventType = pgEnum(
  "newsletter_provider_event_type",
  [
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.failed",
    "email.bounced",
    "email.complained",
    "email.suppressed",
    "email.unsubscribed",
  ],
);

export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailCiphertext: text("email_ciphertext"),
    emailEncryptionKeyVersion: integer("email_encryption_key_version"),
    emailLookupDigest: varchar("email_lookup_digest", { length: 64 }).notNull(),
    emailLookupKeyVersion: integer("email_lookup_key_version").notNull(),
    status: subscriberStatus("status").default("unconfirmed").notNull(),
    morningEnabled: boolean("morning_enabled").notNull(),
    eveningEnabled: boolean("evening_enabled").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    lastPreferenceChangedAt: timestamp("last_preference_changed_at", {
      withTimezone: true,
    }),
    suppressionReason: subscriberSuppressionReason("suppression_reason"),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("subscribers_email_lookup_digest_unique").on(
      table.emailLookupDigest,
    ),
    index("subscribers_delivery_eligibility_idx").on(
      table.status,
      table.suppressionReason,
      table.morningEnabled,
      table.eveningEnabled,
    ),
    check(
      "subscribers_email_key_versions_positive",
      sql`${table.emailLookupKeyVersion} > 0 and (${table.emailEncryptionKeyVersion} is null or ${table.emailEncryptionKeyVersion} > 0)`,
    ),
    check(
      "subscribers_email_ciphertext_pair",
      sql`(${table.emailCiphertext} is null) = (${table.emailEncryptionKeyVersion} is null)`,
    ),
    check(
      "subscribers_active_email_required",
      sql`${table.status} = 'unsubscribed' or ${table.emailCiphertext} is not null`,
    ),
    check(
      "subscribers_active_preferences_required",
      sql`${table.status} = 'unsubscribed' or ${table.morningEnabled} or ${table.eveningEnabled}`,
    ),
    check(
      "subscribers_unsubscribed_state",
      sql`${table.status} <> 'unsubscribed' or (not ${table.morningEnabled} and not ${table.eveningEnabled} and ${table.unsubscribedAt} is not null)`,
    ),
    check(
      "subscribers_confirmed_state",
      sql`${table.status} <> 'confirmed' or ${table.confirmedAt} is not null`,
    ),
    check(
      "subscribers_suppression_pair",
      sql`(${table.suppressionReason} is null) = (${table.suppressedAt} is null)`,
    ),
  ],
);

export const subscriberConsentEvents = pgTable(
  "subscriber_consent_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    kind: subscriberConsentEventKind("kind").notNull(),
    morningEnabled: boolean("morning_enabled").notNull(),
    eveningEnabled: boolean("evening_enabled").notNull(),
    consentPolicyVersion: varchar("consent_policy_version", {
      length: 80,
    }).notNull(),
    source: subscriberConsentSource("source").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("subscriber_consent_events_subscriber_created_idx").on(
      table.subscriberId,
      table.createdAt,
    ),
  ],
);

export const subscriberActionTokens = pgTable(
  "subscriber_action_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    purpose: subscriberActionTokenPurpose("purpose").notNull(),
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    tokenKeyVersion: integer("token_key_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("subscriber_action_tokens_digest_unique").on(table.tokenDigest),
    index("subscriber_action_tokens_subscriber_purpose_idx").on(
      table.subscriberId,
      table.purpose,
      table.createdAt,
    ),
    check(
      "subscriber_action_tokens_key_version_positive",
      sql`${table.tokenKeyVersion} > 0`,
    ),
    check(
      "subscriber_action_tokens_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const subscriberSignupLimits = pgTable(
  "subscriber_signup_limits",
  {
    keyDigest: varchar("key_digest", { length: 64 }).primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("subscriber_signup_limits_expires_at_idx").on(table.expiresAt),
    check(
      "subscriber_signup_limits_attempt_count_positive",
      sql`${table.attemptCount} > 0`,
    ),
    check(
      "subscriber_signup_limits_expiry_after_window",
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
  ],
);

export const publicApiRateLimits = pgTable(
  "public_api_rate_limits",
  {
    keyDigest: varchar("key_digest", { length: 64 }).primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("public_api_rate_limits_expires_at_idx").on(table.expiresAt),
    check(
      "public_api_rate_limits_request_count_positive",
      sql`${table.requestCount} > 0`,
    ),
    check(
      "public_api_rate_limits_expiry_after_window",
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
  ],
);

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trigger: digestRunTrigger("trigger").notNull(),
    scheduleKey: varchar("schedule_key", { length: 160 }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    requestedStoryCount: integer("requested_story_count").notNull(),
    excludedStoryCount: integer("excluded_story_count").default(0).notNull(),
    excludedHnItemIds: jsonb("excluded_hn_item_ids")
      .$type<number[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    status: digestRunStatus("status").default("pending").notNull(),
    newsletterReadyAt: timestamp("newsletter_ready_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 100 }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("digest_runs_schedule_key_unique")
      .on(table.scheduleKey)
      .where(sql`${table.scheduleKey} is not null`),
    uniqueIndex("digest_runs_active_on_demand_unique")
      .on(table.trigger)
      .where(
        sql`${table.trigger} = 'on_demand' and ${table.status} in ('pending', 'collecting', 'analyzing')`,
      ),
    index("digest_runs_scheduled_for_idx").on(table.scheduledFor),
    index("digest_runs_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "digest_runs_requested_story_count_positive",
      sql`${table.requestedStoryCount} > 0`,
    ),
    check(
      "digest_runs_excluded_story_count_nonnegative",
      sql`${table.excludedStoryCount} >= 0`,
    ),
  ],
);

export const newsletterDeliveries = pgTable(
  "newsletter_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    digestRunId: uuid("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    edition: newsletterEdition("edition").notNull(),
    status: newsletterDeliveryStatus("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 160 }),
    providerStatus: newsletterProviderStatus("provider_status"),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sendingStartedAt: timestamp("sending_started_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("newsletter_deliveries_run_subscriber_unique").on(
      table.digestRunId,
      table.subscriberId,
    ),
    index("newsletter_deliveries_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("newsletter_deliveries_digest_status_idx").on(
      table.digestRunId,
      table.status,
    ),
    index("newsletter_deliveries_provider_message_idx").on(
      table.providerMessageId,
    ),
    check(
      "newsletter_deliveries_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "newsletter_deliveries_sent_state",
      sql`${table.status} <> 'sent' or (${table.sentAt} is not null and ${table.providerMessageId} is not null)`,
    ),
    check(
      "newsletter_deliveries_failed_state",
      sql`${table.status} <> 'failed' or ${table.failedAt} is not null`,
    ),
  ],
);

export const newsletterProviderEvents = pgTable(
  "newsletter_provider_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    providerEventId: varchar("provider_event_id", { length: 160 }).notNull(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => newsletterDeliveries.id, { onDelete: "cascade" }),
    type: newsletterProviderEventType("type").notNull(),
    providerOccurredAt: timestamp("provider_occurred_at", {
      withTimezone: true,
    }).notNull(),
    detailCode: varchar("detail_code", { length: 100 }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("newsletter_provider_events_provider_id_unique").on(
      table.providerEventId,
    ),
    index("newsletter_provider_events_delivery_time_idx").on(
      table.deliveryId,
      table.providerOccurredAt,
    ),
    index("newsletter_provider_events_type_time_idx").on(
      table.type,
      table.providerOccurredAt,
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
    reusedFromAnalysisJobId: uuid("reused_from_analysis_job_id").references(
      (): AnyPgColumn => analysisJobs.id,
      { onDelete: "set null" },
    ),
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
    index("analysis_jobs_cache_key_idx").on(table.cacheKey),
    uniqueIndex("analysis_jobs_digest_run_story_unique").on(
      table.digestRunStoryId,
    ),
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
    index("article_analyses_cache_key_idx").on(table.cacheKey),
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
    index("discussion_analyses_cache_key_idx").on(table.cacheKey),
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

export const analysisCacheLookups = pgTable(
  "analysis_cache_lookups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: bigint("story_id", { mode: "number" })
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    cacheKey: varchar("cache_key", { length: 64 }).notNull(),
    hit: boolean("hit").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("analysis_cache_lookups_created_at_idx").on(table.createdAt),
    index("analysis_cache_lookups_hit_created_at_idx").on(
      table.hit,
      table.createdAt,
    ),
  ],
);

export const operationalAlerts = pgTable(
  "operational_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: operationalAlertKind("kind").notNull(),
    deduplicationKey: varchar("deduplication_key", { length: 200 }).notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operational_alerts_deduplication_key_unique").on(
      table.deduplicationKey,
    ),
    index("operational_alerts_unacknowledged_idx")
      .on(table.createdAt)
      .where(sql`${table.acknowledgedAt} is null`),
  ],
);
