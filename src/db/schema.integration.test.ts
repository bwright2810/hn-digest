import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1" && databaseUrl;

describe.skipIf(!runDatabaseTests)("HD-010 PostgreSQL schema", () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates every initial application table", async () => {
    const result = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'stories', 'story_snapshots', 'comments', 'documents', 'digest_runs',
          'digest_run_stories', 'analysis_jobs', 'analysis_job_attempts', 'article_analyses',
          'discussion_analyses', 'llm_usage'
        )
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "analysis_job_attempts",
      "analysis_jobs",
      "article_analyses",
      "comments",
      "digest_run_stories",
      "digest_runs",
      "discussion_analyses",
      "documents",
      "llm_usage",
      "stories",
      "story_snapshots",
    ]);
  });

  it("has indexes for source identities, content hashes, and analysis versions", async () => {
    const expectedIndexes = [
      "analysis_jobs_cache_key_unique",
      "analysis_jobs_lease_idx",
      "analysis_job_attempts_job_attempt_unique",
      "analysis_jobs_versions_model_idx",
      "article_analyses_content_hash_idx",
      "comments_content_hash_idx",
      "comments_hn_item_id_unique",
      "discussion_analyses_comment_hash_idx",
      "documents_content_hash_idx",
      "documents_source_url_idx",
      "stories_hn_item_id_unique",
      "stories_url_idx",
    ];
    const result = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
      [expectedIndexes],
    );

    expect(result.rows.map((row) => row.indexname).sort()).toEqual(
      expectedIndexes.sort(),
    );
  });

  it("supports idempotent story, run, snapshot, and comment ingestion", async () => {
    const storyResult = await client.query<{ id: string }>(`
      INSERT INTO stories (hn_item_id, title, url, hn_created_at)
      VALUES (424242, 'Initial title', 'https://example.com/story', now())
      ON CONFLICT (hn_item_id) DO UPDATE SET
        title = EXCLUDED.title,
        updated_at = now()
      RETURNING id
    `);
    const storyId = storyResult.rows[0]?.id;
    expect(storyId).toBeDefined();

    await client.query(`
      INSERT INTO stories (hn_item_id, title, url, hn_created_at)
      VALUES (424242, 'Updated title', 'https://example.com/story', now())
      ON CONFLICT (hn_item_id) DO UPDATE SET
        title = EXCLUDED.title,
        updated_at = now()
    `);

    const runResult = await client.query<{ id: string }>(`
      INSERT INTO digest_runs (trigger, schedule_key, scheduled_for, requested_story_count)
      VALUES ('scheduled', '2026-07-22T07:00:00-America/New_York', now(), 5)
      ON CONFLICT (schedule_key) WHERE schedule_key IS NOT NULL DO UPDATE SET
        requested_story_count = EXCLUDED.requested_story_count
      RETURNING id
    `);
    const digestRunId = runResult.rows[0]?.id;
    expect(digestRunId).toBeDefined();

    for (const metadataHash of ["a".repeat(64), "b".repeat(64)]) {
      await client.query(
        `
          INSERT INTO story_snapshots (
            digest_run_id, story_id, rank, score, comment_count, title,
            url, hn_created_at, metadata_hash
          )
          VALUES ($1, $2, 1, 100, 25, 'Updated title',
            'https://example.com/story', now(), $3)
          ON CONFLICT (digest_run_id, story_id) DO UPDATE SET
            score = EXCLUDED.score,
            comment_count = EXCLUDED.comment_count,
            metadata_hash = EXCLUDED.metadata_hash
        `,
        [digestRunId, storyId, metadataHash],
      );
    }

    for (const contentHash of ["c".repeat(64), "d".repeat(64)]) {
      await client.query(
        `
          INSERT INTO comments (hn_item_id, story_id, text, content_hash)
          VALUES (434343, $1, 'A useful comment', $2)
          ON CONFLICT (hn_item_id) DO UPDATE SET
            text = EXCLUDED.text,
            content_hash = EXCLUDED.content_hash,
            updated_at = now()
        `,
        [storyId, contentHash],
      );
    }

    const counts = await client.query<{
      stories: string;
      snapshots: string;
      comments: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM stories WHERE hn_item_id = 424242) AS stories,
          (SELECT count(*) FROM story_snapshots WHERE digest_run_id = $1) AS snapshots,
          (SELECT count(*) FROM comments WHERE hn_item_id = 434343) AS comments
      `,
      [digestRunId],
    );

    expect(counts.rows[0]).toEqual({
      stories: "1",
      snapshots: "1",
      comments: "1",
    });
  });
});
