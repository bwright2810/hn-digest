CREATE TYPE "public"."analysis_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped_budget', 'refused', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."digest_run_status" AS ENUM('pending', 'collecting', 'analyzing', 'complete', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."digest_run_trigger" AS ENUM('scheduled', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."digest_story_status" AS ENUM('pending', 'collecting', 'analyzing', 'complete', 'discussion_only', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'extracted', 'low_confidence', 'failed', 'unsupported', 'access_restricted');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_run_story_id" uuid NOT NULL,
	"document_id" uuid,
	"cache_key" varchar(64) NOT NULL,
	"article_content_hash" varchar(64),
	"selected_comment_hash" varchar(64) NOT NULL,
	"prompt_version" varchar(80) NOT NULL,
	"schema_version" varchar(80) NOT NULL,
	"model" varchar(120) NOT NULL,
	"reasoning_config" jsonb NOT NULL,
	"status" "analysis_job_status" DEFAULT 'queued' NOT NULL,
	"estimated_input_tokens" integer NOT NULL,
	"maximum_output_tokens" integer NOT NULL,
	"estimated_cost_usd" numeric(14, 8) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_jobs_estimated_input_tokens_nonnegative" CHECK ("analysis_jobs"."estimated_input_tokens" >= 0),
	CONSTRAINT "analysis_jobs_maximum_output_tokens_positive" CHECK ("analysis_jobs"."maximum_output_tokens" > 0),
	CONSTRAINT "analysis_jobs_estimated_cost_nonnegative" CHECK ("analysis_jobs"."estimated_cost_usd" >= 0),
	CONSTRAINT "analysis_jobs_attempt_count_nonnegative" CHECK ("analysis_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "article_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_job_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"cache_key" varchar(64) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"prompt_version" varchar(80) NOT NULL,
	"schema_version" varchar(80) NOT NULL,
	"model" varchar(120) NOT NULL,
	"result" jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_analyses_confidence_range" CHECK ("article_analyses"."confidence" is null or ("article_analyses"."confidence" >= 0 and "article_analyses"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"hn_item_id" bigint NOT NULL,
	"story_id" bigint NOT NULL,
	"parent_hn_item_id" bigint,
	"parent_comment_id" bigint,
	"author" text,
	"text" text,
	"content_hash" varchar(64),
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_dead" boolean DEFAULT false NOT NULL,
	"hn_created_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_hn_item_id_positive" CHECK ("comments"."hn_item_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "digest_run_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_run_id" uuid NOT NULL,
	"story_id" bigint NOT NULL,
	"story_snapshot_id" bigint NOT NULL,
	"rank" integer NOT NULL,
	"status" "digest_story_status" DEFAULT 'pending' NOT NULL,
	"failure_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_run_stories_rank_positive" CHECK ("digest_run_stories"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "digest_run_trigger" NOT NULL,
	"schedule_key" varchar(160),
	"scheduled_for" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"requested_story_count" integer NOT NULL,
	"status" "digest_run_status" DEFAULT 'pending' NOT NULL,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_runs_requested_story_count_positive" CHECK ("digest_runs"."requested_story_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "discussion_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_job_id" uuid NOT NULL,
	"story_id" bigint NOT NULL,
	"cache_key" varchar(64) NOT NULL,
	"selected_comment_hash" varchar(64) NOT NULL,
	"prompt_version" varchar(80) NOT NULL,
	"schema_version" varchar(80) NOT NULL,
	"model" varchar(120) NOT NULL,
	"result" jsonb NOT NULL,
	"cited_comment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discussion_analyses_confidence_range" CHECK ("discussion_analyses"."confidence" is null or ("discussion_analyses"."confidence" >= 0 and "discussion_analyses"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" bigint NOT NULL,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"content_hash" varchar(64),
	"title" text,
	"byline" text,
	"published_at" timestamp with time zone,
	"extracted_text" text,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"provider_request_id" varchar(160),
	"model" varchar(120) NOT NULL,
	"prompt_version" varchar(80) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cached_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"price_assumptions" jsonb NOT NULL,
	"estimated_cost_usd" numeric(14, 8) NOT NULL,
	"actual_cost_usd" numeric(14, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_attempt_positive" CHECK ("llm_usage"."attempt" > 0),
	CONSTRAINT "llm_usage_token_counts_nonnegative" CHECK ("llm_usage"."input_tokens" >= 0 and "llm_usage"."output_tokens" >= 0 and "llm_usage"."cached_read_tokens" >= 0 and "llm_usage"."cache_write_tokens" >= 0),
	CONSTRAINT "llm_usage_estimated_cost_nonnegative" CHECK ("llm_usage"."estimated_cost_usd" >= 0),
	CONSTRAINT "llm_usage_actual_cost_nonnegative" CHECK ("llm_usage"."actual_cost_usd" is null or "llm_usage"."actual_cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"hn_item_id" bigint NOT NULL,
	"type" varchar(32) DEFAULT 'story' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"author" text,
	"hn_created_at" timestamp with time zone NOT NULL,
	"latest_score" integer,
	"latest_comment_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stories_hn_item_id_positive" CHECK ("stories"."hn_item_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "story_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "story_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"digest_run_id" uuid NOT NULL,
	"story_id" bigint NOT NULL,
	"rank" integer NOT NULL,
	"score" integer NOT NULL,
	"comment_count" integer NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"author" text,
	"hn_created_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata_hash" varchar(64) NOT NULL,
	CONSTRAINT "story_snapshots_rank_positive" CHECK ("story_snapshots"."rank" > 0),
	CONSTRAINT "story_snapshots_score_nonnegative" CHECK ("story_snapshots"."score" >= 0),
	CONSTRAINT "story_snapshots_comment_count_nonnegative" CHECK ("story_snapshots"."comment_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_digest_run_story_id_digest_run_stories_id_fk" FOREIGN KEY ("digest_run_story_id") REFERENCES "public"."digest_run_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_analyses" ADD CONSTRAINT "article_analyses_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_analyses" ADD CONSTRAINT "article_analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_run_stories" ADD CONSTRAINT "digest_run_stories_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_run_stories" ADD CONSTRAINT "digest_run_stories_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_run_stories" ADD CONSTRAINT "digest_run_stories_story_snapshot_id_story_snapshots_id_fk" FOREIGN KEY ("story_snapshot_id") REFERENCES "public"."story_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_analyses" ADD CONSTRAINT "discussion_analyses_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_analyses" ADD CONSTRAINT "discussion_analyses_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_snapshots" ADD CONSTRAINT "story_snapshots_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_snapshots" ADD CONSTRAINT "story_snapshots_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_cache_key_unique" ON "analysis_jobs" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "analysis_jobs_status_available_at_idx" ON "analysis_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "analysis_jobs_digest_run_story_idx" ON "analysis_jobs" USING btree ("digest_run_story_id");--> statement-breakpoint
CREATE INDEX "analysis_jobs_versions_model_idx" ON "analysis_jobs" USING btree ("prompt_version","schema_version","model");--> statement-breakpoint
CREATE UNIQUE INDEX "article_analyses_job_unique" ON "article_analyses" USING btree ("analysis_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_analyses_cache_key_unique" ON "article_analyses" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "article_analyses_content_hash_idx" ON "article_analyses" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "article_analyses_versions_model_idx" ON "article_analyses" USING btree ("prompt_version","schema_version","model");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_hn_item_id_unique" ON "comments" USING btree ("hn_item_id");--> statement-breakpoint
CREATE INDEX "comments_story_parent_idx" ON "comments" USING btree ("story_id","parent_hn_item_id");--> statement-breakpoint
CREATE INDEX "comments_parent_comment_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "comments_content_hash_idx" ON "comments" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_run_stories_run_story_unique" ON "digest_run_stories" USING btree ("digest_run_id","story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_run_stories_run_rank_unique" ON "digest_run_stories" USING btree ("digest_run_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_run_stories_snapshot_unique" ON "digest_run_stories" USING btree ("story_snapshot_id");--> statement-breakpoint
CREATE INDEX "digest_run_stories_status_idx" ON "digest_run_stories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_schedule_key_unique" ON "digest_runs" USING btree ("schedule_key") WHERE "digest_runs"."schedule_key" is not null;--> statement-breakpoint
CREATE INDEX "digest_runs_scheduled_for_idx" ON "digest_runs" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "digest_runs_status_created_at_idx" ON "digest_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_analyses_job_unique" ON "discussion_analyses" USING btree ("analysis_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_analyses_cache_key_unique" ON "discussion_analyses" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "discussion_analyses_comment_hash_idx" ON "discussion_analyses" USING btree ("selected_comment_hash");--> statement-breakpoint
CREATE INDEX "discussion_analyses_versions_model_idx" ON "discussion_analyses" USING btree ("prompt_version","schema_version","model");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_story_source_hash_unique" ON "documents" USING btree ("story_id","source_url","content_hash") WHERE "documents"."content_hash" is not null;--> statement-breakpoint
CREATE INDEX "documents_source_url_idx" ON "documents" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "documents_canonical_url_idx" ON "documents" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "documents_content_hash_idx" ON "documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "documents_story_status_idx" ON "documents" USING btree ("story_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_usage_job_attempt_unique" ON "llm_usage" USING btree ("analysis_job_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_usage_provider_request_unique" ON "llm_usage" USING btree ("provider_request_id") WHERE "llm_usage"."provider_request_id" is not null;--> statement-breakpoint
CREATE INDEX "llm_usage_model_prompt_created_idx" ON "llm_usage" USING btree ("model","prompt_version","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stories_hn_item_id_unique" ON "stories" USING btree ("hn_item_id");--> statement-breakpoint
CREATE INDEX "stories_url_idx" ON "stories" USING btree ("url");--> statement-breakpoint
CREATE INDEX "stories_hn_created_at_idx" ON "stories" USING btree ("hn_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "story_snapshots_run_story_unique" ON "story_snapshots" USING btree ("digest_run_id","story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_snapshots_run_rank_unique" ON "story_snapshots" USING btree ("digest_run_id","rank");--> statement-breakpoint
CREATE INDEX "story_snapshots_story_collected_at_idx" ON "story_snapshots" USING btree ("story_id","collected_at");--> statement-breakpoint
CREATE INDEX "story_snapshots_metadata_hash_idx" ON "story_snapshots" USING btree ("metadata_hash");