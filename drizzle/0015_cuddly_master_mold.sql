DROP INDEX "newsletter_deliveries_run_subscriber_unique";--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_deliveries_run_subscriber_sequence_unique" ON "newsletter_deliveries" USING btree ("digest_run_id","subscriber_id","sequence");--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_sequence_positive" CHECK ("newsletter_deliveries"."sequence" > 0);