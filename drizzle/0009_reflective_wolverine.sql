CREATE TYPE "public"."subscriber_action_token_purpose" AS ENUM('confirmation', 'preferences');--> statement-breakpoint
CREATE TYPE "public"."subscriber_consent_event_kind" AS ENUM('signup_requested', 'subscription_confirmed', 'preferences_changed', 'unsubscribed', 'resubscribe_requested', 'suppressed', 'suppression_cleared');--> statement-breakpoint
CREATE TYPE "public"."subscriber_consent_source" AS ENUM('public_signup', 'operator_review');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('unconfirmed', 'confirmed', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."subscriber_suppression_reason" AS ENUM('hard_bounce', 'complaint', 'provider_unsubscribe', 'provider_suppressed');--> statement-breakpoint
CREATE TABLE "subscriber_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"purpose" "subscriber_action_token_purpose" NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"token_key_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_action_tokens_key_version_positive" CHECK ("subscriber_action_tokens"."token_key_version" > 0),
	CONSTRAINT "subscriber_action_tokens_expiry_after_creation" CHECK ("subscriber_action_tokens"."expires_at" > "subscriber_action_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "subscriber_consent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriber_consent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscriber_id" uuid NOT NULL,
	"kind" "subscriber_consent_event_kind" NOT NULL,
	"morning_enabled" boolean NOT NULL,
	"evening_enabled" boolean NOT NULL,
	"consent_policy_version" varchar(80) NOT NULL,
	"source" "subscriber_consent_source" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_ciphertext" text,
	"email_encryption_key_version" integer,
	"email_lookup_digest" varchar(64) NOT NULL,
	"email_lookup_key_version" integer NOT NULL,
	"status" "subscriber_status" DEFAULT 'unconfirmed' NOT NULL,
	"morning_enabled" boolean NOT NULL,
	"evening_enabled" boolean NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"last_preference_changed_at" timestamp with time zone,
	"suppression_reason" "subscriber_suppression_reason",
	"suppressed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_email_key_versions_positive" CHECK ("subscribers"."email_lookup_key_version" > 0 and ("subscribers"."email_encryption_key_version" is null or "subscribers"."email_encryption_key_version" > 0)),
	CONSTRAINT "subscribers_email_ciphertext_pair" CHECK (("subscribers"."email_ciphertext" is null) = ("subscribers"."email_encryption_key_version" is null)),
	CONSTRAINT "subscribers_active_email_required" CHECK ("subscribers"."status" = 'unsubscribed' or "subscribers"."email_ciphertext" is not null),
	CONSTRAINT "subscribers_active_preferences_required" CHECK ("subscribers"."status" = 'unsubscribed' or "subscribers"."morning_enabled" or "subscribers"."evening_enabled"),
	CONSTRAINT "subscribers_unsubscribed_state" CHECK ("subscribers"."status" <> 'unsubscribed' or (not "subscribers"."morning_enabled" and not "subscribers"."evening_enabled" and "subscribers"."unsubscribed_at" is not null)),
	CONSTRAINT "subscribers_confirmed_state" CHECK ("subscribers"."status" <> 'confirmed' or "subscribers"."confirmed_at" is not null),
	CONSTRAINT "subscribers_suppression_pair" CHECK (("subscribers"."suppression_reason" is null) = ("subscribers"."suppressed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "subscriber_action_tokens" ADD CONSTRAINT "subscriber_action_tokens_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_consent_events" ADD CONSTRAINT "subscriber_consent_events_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_action_tokens_digest_unique" ON "subscriber_action_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "subscriber_action_tokens_subscriber_purpose_idx" ON "subscriber_action_tokens" USING btree ("subscriber_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "subscriber_consent_events_subscriber_created_idx" ON "subscriber_consent_events" USING btree ("subscriber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_email_lookup_digest_unique" ON "subscribers" USING btree ("email_lookup_digest");--> statement-breakpoint
CREATE INDEX "subscribers_delivery_eligibility_idx" ON "subscribers" USING btree ("status","suppression_reason","morning_enabled","evening_enabled");