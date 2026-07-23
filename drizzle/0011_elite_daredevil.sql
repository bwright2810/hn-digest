CREATE TYPE "public"."newsletter_delivery_status" AS ENUM('pending', 'sending', 'retry', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."newsletter_edition" AS ENUM('morning', 'evening');--> statement-breakpoint
CREATE TABLE "newsletter_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_run_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"edition" "newsletter_edition" NOT NULL,
	"status" "newsletter_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(160),
	"last_error_code" varchar(100),
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sending_started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_deliveries_attempt_count_nonnegative" CHECK ("newsletter_deliveries"."attempt_count" >= 0),
	CONSTRAINT "newsletter_deliveries_sent_state" CHECK ("newsletter_deliveries"."status" <> 'sent' or ("newsletter_deliveries"."sent_at" is not null and "newsletter_deliveries"."provider_message_id" is not null)),
	CONSTRAINT "newsletter_deliveries_failed_state" CHECK ("newsletter_deliveries"."status" <> 'failed' or "newsletter_deliveries"."failed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_deliveries_run_subscriber_unique" ON "newsletter_deliveries" USING btree ("digest_run_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "newsletter_deliveries_claim_idx" ON "newsletter_deliveries" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "newsletter_deliveries_digest_status_idx" ON "newsletter_deliveries" USING btree ("digest_run_id","status");