import { z } from "zod";

const DEVELOPMENT_DEFAULTS = {
  APP_URL: "http://localhost:3000",
  DIGEST_TIME_ZONE: "America/New_York",
  DIGEST_MORNING_TIME: "07:00",
  DIGEST_EVENING_TIME: "19:00",
  DIGEST_STORY_COUNT: "5",
  LLM_INSTRUCTION_TOKEN_LIMIT: "2000",
  LLM_ARTICLE_TOKEN_LIMIT: "12000",
  LLM_COMMENT_TOKEN_LIMIT: "8000",
  LLM_OUTPUT_TOKEN_LIMIT: "4000",
} as const;

const positiveInteger = z.coerce.number().int().positive();

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

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: postgresUrl,
  OPENAI_API_KEY: z.string().min(1, "is required"),
  APP_URL: applicationUrl,
  DIGEST_TIME_ZONE: timeZone,
  DIGEST_MORNING_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
  DIGEST_EVENING_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must use HH:MM in 24-hour time"),
  DIGEST_STORY_COUNT: positiveInteger,
  LLM_INSTRUCTION_TOKEN_LIMIT: positiveInteger,
  LLM_ARTICLE_TOKEN_LIMIT: positiveInteger,
  LLM_COMMENT_TOKEN_LIMIT: positiveInteger,
  LLM_OUTPUT_TOKEN_LIMIT: positiveInteger,
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
  };
  readonly schedule: {
    readonly timeZone: string;
    readonly morningTime: string;
    readonly eveningTime: string;
  };
  readonly stories: {
    readonly perRun: number;
  };
  readonly tokens: {
    readonly instructions: number;
    readonly article: number;
    readonly comments: number;
    readonly output: number;
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
    openai: Object.freeze({ apiKey: values.OPENAI_API_KEY }),
    schedule: Object.freeze({
      timeZone: values.DIGEST_TIME_ZONE,
      morningTime: values.DIGEST_MORNING_TIME,
      eveningTime: values.DIGEST_EVENING_TIME,
    }),
    stories: Object.freeze({ perRun: values.DIGEST_STORY_COUNT }),
    tokens: Object.freeze({
      instructions: values.LLM_INSTRUCTION_TOKEN_LIMIT,
      article: values.LLM_ARTICLE_TOKEN_LIMIT,
      comments: values.LLM_COMMENT_TOKEN_LIMIT,
      output: values.LLM_OUTPUT_TOKEN_LIMIT,
    }),
  });
}

let config: AppConfig | undefined;

export function getConfig(): AppConfig {
  config ??= loadConfig(process.env);
  return config;
}
