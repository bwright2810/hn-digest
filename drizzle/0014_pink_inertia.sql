CREATE TABLE "public_api_rate_limits" (
	"key_digest" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_api_rate_limits_request_count_positive" CHECK ("public_api_rate_limits"."request_count" > 0),
	CONSTRAINT "public_api_rate_limits_expiry_after_window" CHECK ("public_api_rate_limits"."expires_at" > "public_api_rate_limits"."window_started_at")
);
--> statement-breakpoint
CREATE INDEX "public_api_rate_limits_expires_at_idx" ON "public_api_rate_limits" USING btree ("expires_at");