CREATE TYPE "public"."analysis_job_attempt_status" AS ENUM('running', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TABLE "analysis_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"worker_id" varchar(160) NOT NULL,
	"status" "analysis_job_attempt_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" varchar(100),
	CONSTRAINT "analysis_job_attempts_attempt_positive" CHECK ("analysis_job_attempts"."attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "lease_owner" varchar(160);--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analysis_job_attempts" ADD CONSTRAINT "analysis_job_attempts_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_job_attempts_job_attempt_unique" ON "analysis_job_attempts" USING btree ("analysis_job_id","attempt");--> statement-breakpoint
CREATE INDEX "analysis_job_attempts_status_idx" ON "analysis_job_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "analysis_jobs_lease_idx" ON "analysis_jobs" USING btree ("status","leased_until");