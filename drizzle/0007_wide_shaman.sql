DROP INDEX "analysis_jobs_cache_key_unique";--> statement-breakpoint
DROP INDEX "article_analyses_cache_key_unique";--> statement-breakpoint
DROP INDEX "discussion_analyses_cache_key_unique";--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "reused_from_analysis_job_id" uuid;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_reused_from_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("reused_from_analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_jobs_cache_key_idx" ON "analysis_jobs" USING btree ("cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_digest_run_story_unique" ON "analysis_jobs" USING btree ("digest_run_story_id");--> statement-breakpoint
CREATE INDEX "article_analyses_cache_key_idx" ON "article_analyses" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "discussion_analyses_cache_key_idx" ON "discussion_analyses" USING btree ("cache_key");