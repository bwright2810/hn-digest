WITH active_runs AS (
	SELECT "id", row_number() OVER (ORDER BY "created_at" DESC, "id" DESC) AS "position"
	FROM "digest_runs"
	WHERE "trigger" = 'on_demand' AND "status" IN ('pending', 'collecting', 'analyzing')
)
UPDATE "digest_runs"
SET "status" = 'failed', "error_code" = 'SUPERSEDED_ON_DEMAND_RUN', "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM active_runs WHERE "position" > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_active_on_demand_unique" ON "digest_runs" USING btree ("trigger") WHERE "digest_runs"."trigger" = 'on_demand' and "digest_runs"."status" in ('pending', 'collecting', 'analyzing');
