DROP TABLE IF EXISTS "llm_usage" CASCADE;
DROP TABLE IF EXISTS "operational_alerts" CASCADE;
DROP TABLE IF EXISTS "analysis_cache_lookups" CASCADE;
DROP TABLE IF EXISTS "analysis_job_attempts" CASCADE;
DROP TABLE IF EXISTS "discussion_analyses" CASCADE;
DROP TABLE IF EXISTS "article_analyses" CASCADE;
DROP TABLE IF EXISTS "analysis_jobs" CASCADE;
DROP TABLE IF EXISTS "digest_run_stories" CASCADE;
DROP TABLE IF EXISTS "documents" CASCADE;
DROP TABLE IF EXISTS "comments" CASCADE;
DROP TABLE IF EXISTS "story_snapshots" CASCADE;
DROP TABLE IF EXISTS "stories" CASCADE;
DROP TABLE IF EXISTS "digest_runs" CASCADE;

DROP TYPE IF EXISTS "analysis_job_status";
DROP TYPE IF EXISTS "analysis_job_attempt_status";
DROP TYPE IF EXISTS "operational_alert_kind";
DROP TYPE IF EXISTS "digest_story_status";
DROP TYPE IF EXISTS "document_status";
DROP TYPE IF EXISTS "digest_run_trigger";
DROP TYPE IF EXISTS "digest_run_status";

DROP SCHEMA IF EXISTS "drizzle" CASCADE;
