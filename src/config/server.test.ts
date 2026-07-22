import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "./server";

const requiredSecrets = {
  DATABASE_URL: "postgresql://digest:database-secret@localhost:5432/hn_digest",
  OPENAI_API_KEY: "openai-secret-value",
};

describe("loadConfig", () => {
  it("applies safe defaults to non-secret development settings", () => {
    const config = loadConfig({ NODE_ENV: "development", ...requiredSecrets });

    expect(config.application.url.href).toBe("http://localhost:3000/");
    expect(config.schedule).toEqual({
      timeZone: "America/New_York",
      morningTime: "07:00",
      eveningTime: "19:00",
    });
    expect(config.stories.perRun).toBe(5);
    expect(config.articleFetch).toEqual({
      timeoutMs: 10_000,
      maximumBytes: 2_097_152,
      maximumRedirects: 5,
    });
    expect(config.tokens).toEqual({
      instructions: 2_000,
      article: 12_000,
      comments: 8_000,
      output: 4_000,
    });
  });

  it("requires secrets in every environment", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).toThrowError(
      /DATABASE_URL.*OPENAI_API_KEY/s,
    );
  });

  it("requires explicit operational values in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", ...requiredSecrets }),
    ).toThrowError(
      /APP_URL.*DIGEST_TIME_ZONE.*DIGEST_STORY_COUNT.*ARTICLE_FETCH_TIMEOUT_MS.*LLM_OUTPUT_TOKEN_LIMIT/s,
    );
  });

  it("never includes supplied secret values in validation errors", () => {
    const databaseSecret = "do-not-log-this-database-secret";
    const openaiSecret = "do-not-log-this-openai-secret";

    let error: unknown;
    try {
      loadConfig({
        NODE_ENV: "development",
        DATABASE_URL: databaseSecret,
        OPENAI_API_KEY: openaiSecret,
        DIGEST_STORY_COUNT: "not-a-number",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).not.toContain(databaseSecret);
    expect(String(error)).not.toContain(openaiSecret);
  });

  it("rejects invalid schedules and token limits", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ...requiredSecrets,
        DIGEST_TIME_ZONE: "Not/A_Real_Zone",
        DIGEST_MORNING_TIME: "25:00",
        ARTICLE_FETCH_MAX_BYTES: "0",
        ARTICLE_FETCH_MAX_REDIRECTS: "-1",
        LLM_ARTICLE_TOKEN_LIMIT: "0",
      }),
    ).toThrowError(
      /DIGEST_TIME_ZONE.*DIGEST_MORNING_TIME.*ARTICLE_FETCH_MAX_BYTES.*ARTICLE_FETCH_MAX_REDIRECTS.*LLM_ARTICLE_TOKEN_LIMIT/s,
    );
  });
});
