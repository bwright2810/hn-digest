import { z } from "zod";
import ipaddr from "ipaddr.js";

const DEVELOPMENT_DEFAULTS = {
  ADMIN_PASSWORD: "development-only-admin-password",
  APP_URL: "http://localhost:3000",
  DIGEST_TIME_ZONE: "America/New_York",
  DIGEST_MORNING_TIME: "07:00",
  DIGEST_EVENING_TIME: "19:00",
  DIGEST_STORY_COUNT: "5",
  DIGEST_MINIMUM_COMMENT_COUNT: "10",
  DIGEST_MISSED_RUN_GRACE_MS: "21600000",
  ARTICLE_FETCH_TIMEOUT_MS: "10000",
  ARTICLE_FETCH_MAX_BYTES: "2097152",
  ARTICLE_FETCH_MAX_REDIRECTS: "5",
  LLM_PROVIDER: "openrouter",
  LLM_OPENAI_MODEL: "gpt-5.6-luna",
  LLM_OPENAI_REASONING_EFFORT: "low",
  LLM_OPENROUTER_MODEL: "deepseek/deepseek-v4-flash",
  LLM_OPENROUTER_REASONING_EFFORT: "high",
  LLM_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  LLM_REQUEST_TIMEOUT_MS: "60000",
  LLM_MAX_RETRIES: "2",
  LLM_INPUT_USD_PER_MILLION_TOKENS: "0.1",
  LLM_CACHED_READ_USD_PER_MILLION_TOKENS: "0.002",
  LLM_CACHE_WRITE_USD_PER_MILLION_TOKENS: "0.1",
  LLM_OUTPUT_USD_PER_MILLION_TOKENS: "0.2",
  LLM_INSTRUCTION_TOKEN_LIMIT: "2000",
  LLM_ARTICLE_TOKEN_LIMIT: "12000",
  LLM_COMMENT_TOKEN_LIMIT: "8000",
  LLM_OUTPUT_TOKEN_LIMIT: "4000",
  LLM_MAX_REQUEST_COST_USD: "0.10",
  COMMENT_SELECTION_MAXIMUM: "30",
  LLM_DAILY_SOFT_LIMIT_USD: "2",
  LLM_DAILY_HARD_LIMIT_USD: "3",
  LLM_MONTHLY_SOFT_LIMIT_USD: "30",
  LLM_MONTHLY_HARD_LIMIT_USD: "40",
  HUMANIZER_ENABLED: "false",
  WORKER_FETCH_CONCURRENCY_PER_HOST: "2",
  WORKER_LLM_CONCURRENCY: "1",
  WORKER_LEASE_MS: "300000",
  SCHEDULER_POLL_INTERVAL_MS: "30000",
  WORKER_POLL_INTERVAL_MS: "5000",
  RUNTIME_SHUTDOWN_GRACE_MS: "30000",
  SUBSCRIBER_KEY_VERSION: "1",
  NEWSLETTER_PUBLIC_SIGNUP_ENABLED: "false",
  NEWSLETTER_CONSENT_POLICY_VERSION: "newsletter-v1",
  NEWSLETTER_SIGNUP_RATE_LIMIT: "3",
  NEWSLETTER_SIGNUP_RATE_WINDOW_MS: "900000",
  NEWSLETTER_DELIVERY_ENABLED: "false",
  NEWSLETTER_DELIVERY_BATCH_SIZE: "25",
  NEWSLETTER_DELIVERY_CONCURRENCY: "2",
  NEWSLETTER_DELIVERY_MAX_ATTEMPTS: "3",
  NEWSLETTER_DELIVERY_POLL_INTERVAL_MS: "5000",
  NEWSLETTER_RETENTION_POLL_INTERVAL_MS: "21600000",
  NEWSLETTER_POSTAL_ADDRESS: "Not configured — delivery disabled",
  NEWSLETTER_REPLY_TO_EMAIL: "privacy@example.com",
  PUBLIC_API_MAX_AGE_DAYS: "30",
  PUBLIC_API_RATE_LIMIT: "10",
  PUBLIC_API_RATE_WINDOW_MS: "60000",
  PUBLIC_API_TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
} as const;

const positiveInteger = z.coerce.number().int().positive();
const positiveMoney = z.coerce.number().positive().finite();
const environmentBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const base64Key = z.string().refine(
  (value) => {
    try {
      const decoded = Buffer.from(value, "base64");
      return (
        /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
        decoded.length === 32 &&
        decoded.toString("base64") === value
      );
    } catch {
      return false;
    }
  },
  { message: "must be a base64-encoded 32-byte key" },
);

const timeZone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA time zone" },
);

const postgresUrl = z.string().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      return false;
    }
  },
  { message: "must be a PostgreSQL URL" },
);

const applicationUrl = z.string().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an HTTP or HTTPS URL" },
);

const cidrList = z.string().refine(
  (value) => {
    try {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .every((entry) => Boolean(ipaddr.parseCIDR(entry)));
    } catch {
      return false;
    }
  },
  { message: "must be a comma-separated list of IP CIDR ranges" },
);

const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: postgresUrl,
    ADMIN_PASSWORD: z.string().min(16, "must contain at least 16 characters"),
    LLM_PROVIDER: z.enum(["openai", "openrouter"]),
    LLM_OPENAI_API_KEY: z.string().min(1).optional(),
    LLM_OPENAI_MODEL: z.string().min(1),
    LLM_OPENAI_REASONING_EFFORT: reasoningEffortSchema,
    LLM_OPENROUTER_API_KEY: z.string().min(1).optional(),
    LLM_OPENROUTER_MODEL: z.string().min(1),
    LLM_OPENROUTER_REASONING_EFFORT: reasoningEffortSchema,
    LLM_OPENROUTER_BASE_URL: applicationUrl,
    LLM_REQUEST_TIMEOUT_MS: positiveInteger,
    LLM_MAX_RETRIES: z.coerce.number().int().nonnegative().max(5),
    LLM_INPUT_USD_PER_MILLION_TOKENS: positiveMoney,
    LLM_CACHED_READ_USD_PER_MILLION_TOKENS: positiveMoney,
    LLM_CACHE_WRITE_USD_PER_MILLION_TOKENS: positiveMoney,
    LLM_OUTPUT_USD_PER_MILLION_TOKENS: positiveMoney,
    APP_URL: applicationUrl,
    DIGEST_TIME_ZONE: timeZone,
    DIGEST_MORNING_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
    DIGEST_EVENING_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
    DIGEST_STORY_COUNT: positiveInteger,
    DIGEST_MINIMUM_COMMENT_COUNT: z.coerce.number().int().nonnegative(),
    DIGEST_MISSED_RUN_GRACE_MS: positiveInteger,
    ARTICLE_FETCH_TIMEOUT_MS: positiveInteger,
    ARTICLE_FETCH_MAX_BYTES: positiveInteger,
    ARTICLE_FETCH_MAX_REDIRECTS: z.coerce.number().int().nonnegative(),
    LLM_INSTRUCTION_TOKEN_LIMIT: positiveInteger,
    LLM_ARTICLE_TOKEN_LIMIT: positiveInteger,
    LLM_COMMENT_TOKEN_LIMIT: positiveInteger,
    LLM_OUTPUT_TOKEN_LIMIT: positiveInteger,
    LLM_MAX_REQUEST_COST_USD: positiveMoney,
    COMMENT_SELECTION_MAXIMUM: positiveInteger,
    LLM_DAILY_SOFT_LIMIT_USD: positiveMoney,
    LLM_DAILY_HARD_LIMIT_USD: positiveMoney,
    LLM_MONTHLY_SOFT_LIMIT_USD: positiveMoney,
    LLM_MONTHLY_HARD_LIMIT_USD: positiveMoney,
    HUMANIZER_ENABLED: environmentBoolean,
    WORKER_FETCH_CONCURRENCY_PER_HOST: positiveInteger,
    WORKER_LLM_CONCURRENCY: positiveInteger,
    WORKER_LEASE_MS: positiveInteger,
    SCHEDULER_POLL_INTERVAL_MS: positiveInteger,
    WORKER_POLL_INTERVAL_MS: positiveInteger,
    RUNTIME_SHUTDOWN_GRACE_MS: positiveInteger,
    SUBSCRIBER_EMAIL_ENCRYPTION_KEY: base64Key,
    SUBSCRIBER_LOOKUP_HMAC_KEY: base64Key,
    SUBSCRIBER_KEY_VERSION: positiveInteger,
    NEWSLETTER_PUBLIC_SIGNUP_ENABLED: environmentBoolean,
    NEWSLETTER_CONSENT_POLICY_VERSION: z.string().min(1).max(80),
    NEWSLETTER_SIGNUP_RATE_LIMIT: positiveInteger,
    NEWSLETTER_SIGNUP_RATE_WINDOW_MS: positiveInteger,
    NEWSLETTER_DELIVERY_ENABLED: environmentBoolean,
    NEWSLETTER_DELIVERY_BATCH_SIZE: positiveInteger.max(100),
    NEWSLETTER_DELIVERY_CONCURRENCY: positiveInteger.max(5),
    NEWSLETTER_DELIVERY_MAX_ATTEMPTS: positiveInteger.max(5),
    NEWSLETTER_DELIVERY_POLL_INTERVAL_MS: positiveInteger,
    NEWSLETTER_RETENTION_POLL_INTERVAL_MS: positiveInteger,
    NEWSLETTER_POSTAL_ADDRESS: z.string().min(1).max(300),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_WEBHOOK_SECRET: z.string().min(16).optional(),
    NEWSLETTER_FROM_EMAIL: z.email().optional(),
    NEWSLETTER_REPLY_TO_EMAIL: z.email(),
    PUBLIC_API_MAX_AGE_DAYS: positiveInteger.max(365),
    PUBLIC_API_RATE_LIMIT: positiveInteger.max(1000),
    PUBLIC_API_RATE_WINDOW_MS: positiveInteger.max(3_600_000),
    PUBLIC_API_TRUSTED_PROXY_CIDRS: cidrList,
  })
  .superRefine((values, context) => {
    const activeProviderKey =
      values.LLM_PROVIDER === "openai"
        ? "LLM_OPENAI_API_KEY"
        : "LLM_OPENROUTER_API_KEY";
    if (!values[activeProviderKey]) {
      context.addIssue({
        code: "custom",
        path: [activeProviderKey],
        message: `is required when LLM_PROVIDER=${values.LLM_PROVIDER}`,
      });
    }
    for (const [softKey, hardKey] of [
      ["LLM_DAILY_SOFT_LIMIT_USD", "LLM_DAILY_HARD_LIMIT_USD"],
      ["LLM_MONTHLY_SOFT_LIMIT_USD", "LLM_MONTHLY_HARD_LIMIT_USD"],
    ] as const) {
      if (values[softKey] > values[hardKey]) {
        context.addIssue({
          code: "custom",
          path: [softKey],
          message: `must not exceed ${hardKey}`,
        });
      }
    }
    if (
      values.NEWSLETTER_PUBLIC_SIGNUP_ENABLED ||
      values.NEWSLETTER_DELIVERY_ENABLED
    ) {
      for (const key of ["RESEND_API_KEY", "NEWSLETTER_FROM_EMAIL"] as const) {
        if (!values[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "is required when NEWSLETTER_PUBLIC_SIGNUP_ENABLED=true",
          });
        }
      }
    }
    if (values.NEWSLETTER_DELIVERY_ENABLED && !values.RESEND_WEBHOOK_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["RESEND_WEBHOOK_SECRET"],
        message: "is required when NEWSLETTER_DELIVERY_ENABLED=true",
      });
    }
  });

export interface AppConfig {
  readonly environment: "development" | "test" | "production";
  readonly application: {
    readonly url: URL;
    readonly adminPassword: string;
  };
  readonly database: {
    readonly url: string;
  };
  readonly llm: {
    readonly provider: "openai" | "openrouter";
    readonly openai: {
      readonly apiKey: string;
      readonly model: string;
      readonly reasoningEffort: ReasoningEffort;
    };
    readonly openrouter: {
      readonly apiKey: string;
      readonly model: string;
      readonly reasoningEffort: ReasoningEffort;
      readonly baseUrl: string;
    };
    readonly timeoutMs: number;
    readonly maximumRetries: number;
    readonly prices: {
      readonly inputUsdPerMillionTokens: number;
      readonly cachedReadUsdPerMillionTokens: number;
      readonly cacheWriteUsdPerMillionTokens: number;
      readonly outputUsdPerMillionTokens: number;
    };
  };
  readonly schedule: {
    readonly timeZone: string;
    readonly morningTime: string;
    readonly eveningTime: string;
    readonly missedRunGraceMs: number;
  };
  readonly stories: {
    readonly perRun: number;
    readonly minimumCommentCount: number;
  };
  readonly articleFetch: {
    readonly timeoutMs: number;
    readonly maximumBytes: number;
    readonly maximumRedirects: number;
  };
  readonly tokens: {
    readonly instructions: number;
    readonly article: number;
    readonly comments: number;
    readonly output: number;
  };
  readonly analysis: {
    readonly maximumRequestCostUsd: number;
    readonly maximumSelectedComments: number;
  };
  readonly worker: {
    readonly fetchConcurrencyPerHost: number;
    readonly llmConcurrency: number;
    readonly leaseMs: number;
    readonly pollIntervalMs: number;
  };
  readonly runtime: {
    readonly schedulerPollIntervalMs: number;
    readonly shutdownGraceMs: number;
  };
  readonly spend: {
    readonly dailySoftLimitUsd: number;
    readonly dailyHardLimitUsd: number;
    readonly monthlySoftLimitUsd: number;
    readonly monthlyHardLimitUsd: number;
  };
  readonly humanizer: {
    readonly enabled: boolean;
  };
  readonly subscribers: {
    readonly emailEncryptionKey: Buffer;
    readonly lookupHmacKey: Buffer;
    readonly keyVersion: number;
  };
  readonly newsletter: {
    readonly publicSignupEnabled: boolean;
    readonly consentPolicyVersion: string;
    readonly signupRateLimit: number;
    readonly signupRateWindowMs: number;
    readonly resendApiKey: string | null;
    readonly resendWebhookSecret: string | null;
    readonly fromEmail: string | null;
    readonly replyToEmail: string;
    readonly deliveryEnabled: boolean;
    readonly deliveryBatchSize: number;
    readonly deliveryConcurrency: number;
    readonly deliveryMaximumAttempts: number;
    readonly deliveryPollIntervalMs: number;
    readonly retentionPollIntervalMs: number;
    readonly postalAddress: string;
  };
  readonly publicApi: {
    readonly maximumAgeDays: number;
    readonly rateLimit: number;
    readonly rateWindowMs: number;
    readonly trustedProxyCidrs: readonly string[];
  };
}

export class ConfigurationError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const details = issues
      .map(
        (issue) =>
          `- ${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("\n");

    super(`Invalid environment configuration:\n${details}`);
    this.name = "ConfigurationError";
  }
}

function applyDevelopmentDefaults(
  environment: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const nodeEnvironment = environment.NODE_ENV ?? "development";

  return {
    ...environment,
    NODE_ENV: nodeEnvironment,
    ...(nodeEnvironment === "production"
      ? {}
      : Object.fromEntries(
          Object.entries(DEVELOPMENT_DEFAULTS).map(([key, value]) => [
            key,
            environment[key] || value,
          ]),
        )),
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(
    applyDevelopmentDefaults(environment),
  );

  if (!result.success) {
    throw new ConfigurationError(result.error.issues);
  }

  const values = result.data;

  return Object.freeze({
    environment: values.NODE_ENV,
    application: Object.freeze({
      url: new URL(values.APP_URL),
      adminPassword: values.ADMIN_PASSWORD,
    }),
    database: Object.freeze({ url: values.DATABASE_URL }),
    llm: Object.freeze({
      provider: values.LLM_PROVIDER,
      openai: Object.freeze({
        apiKey: values.LLM_OPENAI_API_KEY ?? "",
        model: values.LLM_OPENAI_MODEL,
        reasoningEffort: values.LLM_OPENAI_REASONING_EFFORT,
      }),
      openrouter: Object.freeze({
        apiKey: values.LLM_OPENROUTER_API_KEY ?? "",
        model: values.LLM_OPENROUTER_MODEL,
        reasoningEffort: values.LLM_OPENROUTER_REASONING_EFFORT,
        baseUrl: values.LLM_OPENROUTER_BASE_URL,
      }),
      timeoutMs: values.LLM_REQUEST_TIMEOUT_MS,
      maximumRetries: values.LLM_MAX_RETRIES,
      prices: Object.freeze({
        inputUsdPerMillionTokens: values.LLM_INPUT_USD_PER_MILLION_TOKENS,
        cachedReadUsdPerMillionTokens:
          values.LLM_CACHED_READ_USD_PER_MILLION_TOKENS,
        cacheWriteUsdPerMillionTokens:
          values.LLM_CACHE_WRITE_USD_PER_MILLION_TOKENS,
        outputUsdPerMillionTokens: values.LLM_OUTPUT_USD_PER_MILLION_TOKENS,
      }),
    }),
    schedule: Object.freeze({
      timeZone: values.DIGEST_TIME_ZONE,
      morningTime: values.DIGEST_MORNING_TIME,
      eveningTime: values.DIGEST_EVENING_TIME,
      missedRunGraceMs: values.DIGEST_MISSED_RUN_GRACE_MS,
    }),
    stories: Object.freeze({
      perRun: values.DIGEST_STORY_COUNT,
      minimumCommentCount: values.DIGEST_MINIMUM_COMMENT_COUNT,
    }),
    articleFetch: Object.freeze({
      timeoutMs: values.ARTICLE_FETCH_TIMEOUT_MS,
      maximumBytes: values.ARTICLE_FETCH_MAX_BYTES,
      maximumRedirects: values.ARTICLE_FETCH_MAX_REDIRECTS,
    }),
    tokens: Object.freeze({
      instructions: values.LLM_INSTRUCTION_TOKEN_LIMIT,
      article: values.LLM_ARTICLE_TOKEN_LIMIT,
      comments: values.LLM_COMMENT_TOKEN_LIMIT,
      output: values.LLM_OUTPUT_TOKEN_LIMIT,
    }),
    analysis: Object.freeze({
      maximumRequestCostUsd: values.LLM_MAX_REQUEST_COST_USD,
      maximumSelectedComments: values.COMMENT_SELECTION_MAXIMUM,
    }),
    worker: Object.freeze({
      fetchConcurrencyPerHost: values.WORKER_FETCH_CONCURRENCY_PER_HOST,
      llmConcurrency: values.WORKER_LLM_CONCURRENCY,
      leaseMs: values.WORKER_LEASE_MS,
      pollIntervalMs: values.WORKER_POLL_INTERVAL_MS,
    }),
    runtime: Object.freeze({
      schedulerPollIntervalMs: values.SCHEDULER_POLL_INTERVAL_MS,
      shutdownGraceMs: values.RUNTIME_SHUTDOWN_GRACE_MS,
    }),
    spend: Object.freeze({
      dailySoftLimitUsd: values.LLM_DAILY_SOFT_LIMIT_USD,
      dailyHardLimitUsd: values.LLM_DAILY_HARD_LIMIT_USD,
      monthlySoftLimitUsd: values.LLM_MONTHLY_SOFT_LIMIT_USD,
      monthlyHardLimitUsd: values.LLM_MONTHLY_HARD_LIMIT_USD,
    }),
    humanizer: Object.freeze({
      enabled: values.HUMANIZER_ENABLED,
    }),
    subscribers: Object.freeze({
      emailEncryptionKey: Buffer.from(
        values.SUBSCRIBER_EMAIL_ENCRYPTION_KEY,
        "base64",
      ),
      lookupHmacKey: Buffer.from(values.SUBSCRIBER_LOOKUP_HMAC_KEY, "base64"),
      keyVersion: values.SUBSCRIBER_KEY_VERSION,
    }),
    newsletter: Object.freeze({
      publicSignupEnabled: values.NEWSLETTER_PUBLIC_SIGNUP_ENABLED,
      consentPolicyVersion: values.NEWSLETTER_CONSENT_POLICY_VERSION,
      signupRateLimit: values.NEWSLETTER_SIGNUP_RATE_LIMIT,
      signupRateWindowMs: values.NEWSLETTER_SIGNUP_RATE_WINDOW_MS,
      resendApiKey: values.RESEND_API_KEY ?? null,
      resendWebhookSecret: values.RESEND_WEBHOOK_SECRET ?? null,
      fromEmail: values.NEWSLETTER_FROM_EMAIL ?? null,
      replyToEmail: values.NEWSLETTER_REPLY_TO_EMAIL,
      deliveryEnabled: values.NEWSLETTER_DELIVERY_ENABLED,
      deliveryBatchSize: values.NEWSLETTER_DELIVERY_BATCH_SIZE,
      deliveryConcurrency: values.NEWSLETTER_DELIVERY_CONCURRENCY,
      deliveryMaximumAttempts: values.NEWSLETTER_DELIVERY_MAX_ATTEMPTS,
      deliveryPollIntervalMs: values.NEWSLETTER_DELIVERY_POLL_INTERVAL_MS,
      retentionPollIntervalMs: values.NEWSLETTER_RETENTION_POLL_INTERVAL_MS,
      postalAddress: values.NEWSLETTER_POSTAL_ADDRESS,
    }),
    publicApi: Object.freeze({
      maximumAgeDays: values.PUBLIC_API_MAX_AGE_DAYS,
      rateLimit: values.PUBLIC_API_RATE_LIMIT,
      rateWindowMs: values.PUBLIC_API_RATE_WINDOW_MS,
      trustedProxyCidrs: Object.freeze(
        values.PUBLIC_API_TRUSTED_PROXY_CIDRS.split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    }),
  });
}

let config: AppConfig | undefined;

export function getConfig(): AppConfig {
  config ??= loadConfig(process.env);
  return config;
}
