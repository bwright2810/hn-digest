CREATE TYPE "public"."newsletter_provider_event_type" AS ENUM('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed', 'email.bounced', 'email.complained', 'email.suppressed', 'email.unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."newsletter_provider_status" AS ENUM('sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed', 'unsubscribed');--> statement-breakpoint
ALTER TYPE "public"."operational_alert_kind" ADD VALUE 'newsletter_sustained_send_failures';--> statement-breakpoint
ALTER TYPE "public"."operational_alert_kind" ADD VALUE 'newsletter_provider_rejection';--> statement-breakpoint
CREATE TABLE "newsletter_provider_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "newsletter_provider_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_event_id" varchar(160) NOT NULL,
	"delivery_id" uuid NOT NULL,
	"type" "newsletter_provider_event_type" NOT NULL,
	"provider_occurred_at" timestamp with time zone NOT NULL,
	"detail_code" varchar(100),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD COLUMN "provider_status" "newsletter_provider_status";--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD COLUMN "provider_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "newsletter_provider_events" ADD CONSTRAINT "newsletter_provider_events_delivery_id_newsletter_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."newsletter_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_provider_events_provider_id_unique" ON "newsletter_provider_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "newsletter_provider_events_delivery_time_idx" ON "newsletter_provider_events" USING btree ("delivery_id","provider_occurred_at");--> statement-breakpoint
CREATE INDEX "newsletter_provider_events_type_time_idx" ON "newsletter_provider_events" USING btree ("type","provider_occurred_at");--> statement-breakpoint
CREATE INDEX "newsletter_deliveries_provider_message_idx" ON "newsletter_deliveries" USING btree ("provider_message_id");