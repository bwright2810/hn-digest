ALTER TABLE "digest_runs" ADD COLUMN "excluded_story_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD COLUMN "excluded_hn_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_excluded_story_count_nonnegative" CHECK ("digest_runs"."excluded_story_count" >= 0);