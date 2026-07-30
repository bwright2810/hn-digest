DROP INDEX "llm_usage_job_attempt_unique";--> statement-breakpoint
ALTER TABLE "llm_usage" ALTER COLUMN "analysis_job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD COLUMN "humanized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discussion_analyses" ADD COLUMN "humanized_result" jsonb;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "digest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_usage_run_attempt_unique" ON "llm_usage" USING btree ("digest_run_id","attempt") WHERE "llm_usage"."digest_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_usage_job_attempt_unique" ON "llm_usage" USING btree ("analysis_job_id","attempt") WHERE "llm_usage"."analysis_job_id" is not null;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_exactly_one_attribution" CHECK (("llm_usage"."analysis_job_id" is not null) <> ("llm_usage"."digest_run_id" is not null));