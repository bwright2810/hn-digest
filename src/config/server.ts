import { z } from "zod";

const DEVELOPMENT_DEFAULTS = {
  APP_URL: "http://localhost:3000",
  DIGEST_TIME_ZONE: "America/New_York",
  DIGEST_MORNING_TIME: "07:00",
  DIGEST_EVENING_TIME: "19:00",
  DIGEST_STORY_COUNT: "5",
  DIGEST_MISSED_RUN_GRACE_MS: "21600000",
  ARTICLE_FETCH_TIMEOUT_MS: "10000",
  ARTICLE_FETCH_MAX_BYTES: "2097152",
  ARTICLE_FETCH_MAX_REDIRECTS: "5",
  OPENAI_MODEL: "gpt-5.6-luna",
  OPENAI_REASONING_EFFORT: "low",
  OPENAI_REQUEST_TIMEOUT_MS: "60000",
  OPENAI_MAX_RETRIES: "2",
  LLM_INSTRUCTION_TOKEN_LIMIT: "2000",
  LLM_ARTICLE_TOKEN_LIMIT: "12000",
  LLM_COMMENT_TOKEN_LIMIT: "8000",
  LLM_OUTPUT_TOKEN_LIMIT: "4000",
  LLM_DAILY_SOFT_LIMIT_USD: "2",
  LLM_DAILY_HARD_LIMIT_USD: "3",
  LLM_MONTHLY_SOFT_LIMIT_USD: "30",
  LLM_MONTHLY_HARD_LIMIT_USD: "40",
  WORKER_FETCH_CONCURRENCY_PER_HOST: "2",
  WORKER_LLM_CONCURRENCY: "1",
  WORKER_LEASE_MS: "300000",
  SCHEDULER_POLL_INTERVAL_MS: "30000",
  WORKER_POLL_INTERVAL_MS: "5000",
  RUNTIME_SHUTDOWN_GRACE_MS: "30000",
} as const;

const positiveInteger = z.coerce.number().int().positive();
const positiveMoney = z.coerce.number().positive().finite();

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

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: postgresUrl,
    OPENAI_API_KEY: z.string().min(1, "is required"),
    OPENAI_MODEL: z.string().min(1),
    OPENAI_REASONING_EFFORT: z.enum([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
    OPENAI_REQUEST_TIMEOUT_MS: positiveInteger,
    OPENAI_MAX_RETRIES: z.coerce.number().int().nonnegative().max(5),
    APP_URL: applicationUrl,
    DIGEST_TIME_ZONE: timeZone,
    DIGEST_MORNING_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
    DIGEST_EVENING_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
    DIGEST_STORY_COUNT: positiveInteger,
    DIGEST_MISSED_RUN_GRACE_MS: positiveInteger,
    ARTICLE_FETCH_TIMEOUT_MS: positiveInteger,
    ARTICLE_FETCH_MAX_BYTES: positiveInteger,
    ARTICLE_FETCH_MAX_REDIRECTS: z.coerce.number().int().nonnegative(),
    LLM_INSTRUCTION_TOKEN_LIMIT: positiveInteger,
    LLM_ARTICLE_TOKEN_LIMIT: positiveInteger,
    LLM_COMMENT_TOKEN_LIMIT: positiveInteger,
    LLM_OUTPUT_TOKEN_LIMIT: positiveInteger,
    LLM_DAILY_SOFT_LIMIT_USD: positiveMoney,
    LLM_DAILY_HARD_LIMIT_USD: positiveMoney,
    LLM_MONTHLY_SOFT_LIMIT_USD: positiveMoney,
    LLM_MONTHLY_HARD_LIMIT_USD: positiveMoney,
    WORKER_FETCH_CONCURRENCY_PER_HOST: positiveInteger,
    WORKER_LLM_CONCURRENCY: positiveInteger,
    WORKER_LEASE_MS: positiveInteger,
    SCHEDULER_POLL_INTERVAL_MS: positiveInteger,
    WORKER_POLL_INTERVAL_MS: positiveInteger,
    RUNTIME_SHUTDOWN_GRACE_MS: positiveInteger,
  })
  .superRefine((values, context) => {
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
  });

export interface AppConfig {
  readonly environment: "development" | "test" | "production";
  readonly application: {
    readonly url: URL;
  };
  readonly database: {
    readonly url: string;
  };
  readonly openai: {
    readonly apiKey: string;
    readonly model: string;
    readonly reasoningEffort:
      "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    readonly timeoutMs: number;
    readonly maximumRetries: number;
  };
  readonly schedule: {
    readonly timeZone: string;
    readonly morningTime: string;
    readonly eveningTime: string;
    readonly missedRunGraceMs: number;
  };
  readonly stories: {
    readonly perRun: number;
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
    application: Object.freeze({ url: new URL(values.APP_URL) }),
    database: Object.freeze({ url: values.DATABASE_URL }),
    openai: Object.freeze({
      apiKey: values.OPENAI_API_KEY,
      model: values.OPENAI_MODEL,
      reasoningEffort: values.OPENAI_REASONING_EFFORT,
      timeoutMs: values.OPENAI_REQUEST_TIMEOUT_MS,
      maximumRetries: values.OPENAI_MAX_RETRIES,
    }),
    schedule: Object.freeze({
      timeZone: values.DIGEST_TIME_ZONE,
      morningTime: values.DIGEST_MORNING_TIME,
      eveningTime: values.DIGEST_EVENING_TIME,
      missedRunGraceMs: values.DIGEST_MISSED_RUN_GRACE_MS,
    }),
    stories: Object.freeze({ perRun: values.DIGEST_STORY_COUNT }),
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
  });
}

let config: AppConfig | undefined;

export function getConfig(): AppConfig {
  config ??= loadConfig(process.env);
  return config;
}
