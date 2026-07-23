CREATE TABLE "subscriber_signup_limits" (
	"key_digest" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_signup_limits_attempt_count_positive" CHECK ("subscriber_signup_limits"."attempt_count" > 0),
	CONSTRAINT "subscriber_signup_limits_expiry_after_window" CHECK ("subscriber_signup_limits"."expires_at" > "subscriber_signup_limits"."window_started_at")
);
--> statement-breakpoint
CREATE INDEX "subscriber_signup_limits_expires_at_idx" ON "subscriber_signup_limits" USING btree ("expires_at");