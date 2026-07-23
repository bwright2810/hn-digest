import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "./server";

const requiredSecrets = {
  DATABASE_URL: "postgresql://digest:database-secret@localhost:5432/hn_digest",
  OPENAI_API_KEY: "openai-secret-value",
  SUBSCRIBER_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
  SUBSCRIBER_LOOKUP_HMAC_KEY: Buffer.alloc(32, 23).toString("base64"),
};

describe("loadConfig", () => {
  it("applies safe defaults to non-secret development settings", () => {
    const config = loadConfig({ NODE_ENV: "development", ...requiredSecrets });

    expect(config.application.url.href).toBe("http://localhost:3000/");
    expect(config.schedule).toEqual({
      timeZone: "America/New_York",
      morningTime: "07:00",
      eveningTime: "19:00",
      missedRunGraceMs: 21_600_000,
    });
    expect(config.stories).toEqual({
      perRun: 5,
      minimumCommentCount: 10,
    });
    expect(config.articleFetch).toEqual({
      timeoutMs: 10_000,
      maximumBytes: 2_097_152,
      maximumRedirects: 5,
    });
    expect(config.openai).toEqual({
      apiKey: requiredSecrets.OPENAI_API_KEY,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      timeoutMs: 60_000,
      maximumRetries: 2,
      prices: {
        inputUsdPerMillionTokens: 1,
        cachedReadUsdPerMillionTokens: 0.1,
        cacheWriteUsdPerMillionTokens: 1.25,
        outputUsdPerMillionTokens: 6,
      },
    });
    expect(config.tokens).toEqual({
      instructions: 2_000,
      article: 12_000,
      comments: 8_000,
      output: 4_000,
    });
    expect(config.analysis).toEqual({
      maximumRequestCostUsd: 0.1,
      maximumSelectedComments: 30,
    });
    expect(config.worker).toEqual({
      fetchConcurrencyPerHost: 2,
      llmConcurrency: 1,
      leaseMs: 300_000,
      pollIntervalMs: 5_000,
    });
    expect(config.runtime).toEqual({
      schedulerPollIntervalMs: 30_000,
      shutdownGraceMs: 30_000,
    });
    expect(config.spend).toEqual({
      dailySoftLimitUsd: 2,
      dailyHardLimitUsd: 3,
      monthlySoftLimitUsd: 30,
      monthlyHardLimitUsd: 40,
    });
    expect(config.subscribers).toEqual({
      emailEncryptionKey: Buffer.alloc(32, 11),
      lookupHmacKey: Buffer.alloc(32, 23),
      keyVersion: 1,
    });
    expect(config.newsletter).toEqual({
      publicSignupEnabled: false,
      consentPolicyVersion: "newsletter-v1",
      signupRateLimit: 3,
      signupRateWindowMs: 900_000,
      resendApiKey: null,
      resendWebhookSecret: null,
      fromEmail: null,
      deliveryEnabled: false,
      deliveryBatchSize: 25,
      deliveryConcurrency: 2,
      deliveryMaximumAttempts: 3,
      deliveryPollIntervalMs: 5_000,
      postalAddress: "Not configured — delivery disabled",
    });
    expect(config.publicApi).toEqual({
      maximumAgeDays: 30,
      rateLimit: 10,
      rateWindowMs: 60_000,
      trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
    });
  });

  it("requires secrets in every environment", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).toThrowError(
      /DATABASE_URL.*OPENAI_API_KEY.*SUBSCRIBER_EMAIL_ENCRYPTION_KEY.*SUBSCRIBER_LOOKUP_HMAC_KEY/s,
    );
  });

  it("requires explicit operational values in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", ...requiredSecrets }),
    ).toThrowError(
      /ADMIN_PASSWORD.*OPENAI_MODEL.*OPENAI_REASONING_EFFORT.*OPENAI_REQUEST_TIMEOUT_MS.*OPENAI_MAX_RETRIES.*OPENAI_INPUT_USD_PER_MILLION_TOKENS.*OPENAI_OUTPUT_USD_PER_MILLION_TOKENS.*APP_URL.*DIGEST_TIME_ZONE.*DIGEST_STORY_COUNT.*DIGEST_MINIMUM_COMMENT_COUNT.*DIGEST_MISSED_RUN_GRACE_MS.*ARTICLE_FETCH_TIMEOUT_MS.*LLM_OUTPUT_TOKEN_LIMIT.*LLM_MAX_REQUEST_COST_USD.*COMMENT_SELECTION_MAXIMUM.*WORKER_FETCH_CONCURRENCY_PER_HOST.*WORKER_LLM_CONCURRENCY.*WORKER_LEASE_MS.*SCHEDULER_POLL_INTERVAL_MS.*WORKER_POLL_INTERVAL_MS.*RUNTIME_SHUTDOWN_GRACE_MS.*SUBSCRIBER_KEY_VERSION.*NEWSLETTER_PUBLIC_SIGNUP_ENABLED.*NEWSLETTER_CONSENT_POLICY_VERSION.*NEWSLETTER_SIGNUP_RATE_LIMIT.*NEWSLETTER_SIGNUP_RATE_WINDOW_MS/s,
    );
  });

  it("never includes supplied secret values in validation errors", () => {
    const databaseSecret = "do-not-log-this-database-secret";
    const openaiSecret = "do-not-log-this-openai-secret";
    const encryptionSecret = "do-not-log-this-encryption-secret";
    const lookupSecret = "do-not-log-this-lookup-secret";

    let error: unknown;
    try {
      loadConfig({
        NODE_ENV: "development",
        DATABASE_URL: databaseSecret,
        OPENAI_API_KEY: openaiSecret,
        SUBSCRIBER_EMAIL_ENCRYPTION_KEY: encryptionSecret,
        SUBSCRIBER_LOOKUP_HMAC_KEY: lookupSecret,
        DIGEST_STORY_COUNT: "not-a-number",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).not.toContain(databaseSecret);
    expect(String(error)).not.toContain(openaiSecret);
    expect(String(error)).not.toContain(encryptionSecret);
    expect(String(error)).not.toContain(lookupSecret);
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
        OPENAI_REQUEST_TIMEOUT_MS: "0",
        OPENAI_MAX_RETRIES: "-1",
        LLM_DAILY_SOFT_LIMIT_USD: "0",
      }),
    ).toThrowError(
      /OPENAI_REQUEST_TIMEOUT_MS.*OPENAI_MAX_RETRIES.*DIGEST_TIME_ZONE.*DIGEST_MORNING_TIME.*ARTICLE_FETCH_MAX_BYTES.*ARTICLE_FETCH_MAX_REDIRECTS.*LLM_ARTICLE_TOKEN_LIMIT.*LLM_DAILY_SOFT_LIMIT_USD/s,
    );
  });

  it("requires spend soft limits not to exceed hard limits", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ...requiredSecrets,
        LLM_DAILY_SOFT_LIMIT_USD: "4",
        LLM_DAILY_HARD_LIMIT_USD: "3",
      }),
    ).toThrowError(/LLM_DAILY_SOFT_LIMIT_USD.*LLM_DAILY_HARD_LIMIT_USD/s);
  });

  it("requires provider settings only when public newsletter signup is enabled", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ...requiredSecrets,
        NEWSLETTER_PUBLIC_SIGNUP_ENABLED: "true",
      }),
    ).toThrowError(/RESEND_API_KEY.*NEWSLETTER_FROM_EMAIL/s);

    const config = loadConfig({
      NODE_ENV: "development",
      ...requiredSecrets,
      NEWSLETTER_PUBLIC_SIGNUP_ENABLED: "true",
      RESEND_API_KEY: "resend-test-value",
      NEWSLETTER_FROM_EMAIL: "digest@example.com",
    });
    expect(config.newsletter.publicSignupEnabled).toBe(true);
    expect(config.newsletter.fromEmail).toBe("digest@example.com");
  });

  it("requires an independent webhook secret when delivery is enabled", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ...requiredSecrets,
        NEWSLETTER_DELIVERY_ENABLED: "true",
        RESEND_API_KEY: "resend-test-value",
        NEWSLETTER_FROM_EMAIL: "digest@example.com",
      }),
    ).toThrowError(/RESEND_WEBHOOK_SECRET/s);

    const config = loadConfig({
      NODE_ENV: "development",
      ...requiredSecrets,
      NEWSLETTER_DELIVERY_ENABLED: "true",
      RESEND_API_KEY: "resend-test-value",
      RESEND_WEBHOOK_SECRET: "webhook-secret-value",
      NEWSLETTER_FROM_EMAIL: "digest@example.com",
    });
    expect(config.newsletter.deliveryEnabled).toBe(true);
    expect(config.newsletter.resendWebhookSecret).toBe("webhook-secret-value");
  });

  it("validates public API limits and trusted proxy ranges", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ...requiredSecrets,
        PUBLIC_API_MAX_AGE_DAYS: "0",
        PUBLIC_API_TRUSTED_PROXY_CIDRS: "not-a-network",
      }),
    ).toThrowError(/PUBLIC_API_MAX_AGE_DAYS.*PUBLIC_API_TRUSTED_PROXY_CIDRS/s);
  });
});
