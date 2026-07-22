CREATE TYPE "public"."operational_alert_kind" AS ENUM('daily_spend_soft_limit', 'monthly_spend_soft_limit', 'scheduled_run_failed');--> statement-breakpoint
CREATE TABLE "analysis_cache_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" bigint NOT NULL,
	"cache_key" varchar(64) NOT NULL,
	"hit" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "operational_alert_kind" NOT NULL,
	"deduplication_key" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_cache_lookups" ADD CONSTRAINT "analysis_cache_lookups_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_cache_lookups_created_at_idx" ON "analysis_cache_lookups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analysis_cache_lookups_hit_created_at_idx" ON "analysis_cache_lookups" USING btree ("hit","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_alerts_deduplication_key_unique" ON "operational_alerts" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "operational_alerts_unacknowledged_idx" ON "operational_alerts" USING btree ("created_at") WHERE "operational_alerts"."acknowledged_at" is null;