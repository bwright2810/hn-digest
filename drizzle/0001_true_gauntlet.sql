ALTER TABLE "stories" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "story_snapshots" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "story_snapshots" ADD COLUMN "text_hash" varchar(64);