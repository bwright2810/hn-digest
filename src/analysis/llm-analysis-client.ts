import OpenAI from "openai";
import type { APIError } from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

import {
  ANALYSIS_OUTPUT_NAME,
  analysisOutputJsonSchema,
  parseAnalysisOutput,
  type AnalysisOutput,
} from "./contract";
import type { AssembledAnalysisRequest } from "./request";
import {
  buildChatCompletionParams,
  classifyChatCompletionResponse,
  mapChatCompletionUsage,
} from "./chat-completion-provider";

const WATCHDOG_GRACE_MS = 5_000;

type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmProviderCredentials {
  readonly apiKey: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

export interface OpenRouterProviderCredentials extends LlmProviderCredentials {
  readonly baseUrl: string;
}

export interface LlmAnalysisClientOptions {
  readonly provider: "openai" | "openrouter";
  readonly openai: LlmProviderCredentials;
  readonly openrouter: OpenRouterProviderCredentials;
  readonly timeoutMs: number;
  readonly maximumRetries: number;
  readonly logger?: AnalysisClientLogger;
  readonly createResponse?: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>;
  readonly createCompletion?: (
    request: ChatCompletionCreateParamsNonStreaming,
  ) => Promise<ChatCompletion>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface AnalysisClientLogger {
  info(event: Readonly<Record<string, unknown>>): void;
  warn(event: Readonly<Record<string, unknown>>): void;
}

export interface AnalysisUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

interface OutcomeBase {
  readonly responseId: string;
  readonly model: string;
  readonly usage: AnalysisUsage | null;
}

export type AnalysisResponseOutcome =
  | (OutcomeBase & {
      readonly kind: "completed";
      readonly output: AnalysisOutput;
    })
  | (OutcomeBase & {
      readonly kind: "refusal";
      readonly refusal: string;
    })
  | (OutcomeBase & {
      readonly kind: "incomplete";
      readonly reason: string;
    })
  | (OutcomeBase & {
      readonly kind: "failed";
      readonly code: string;
    });

export class LlmAnalysisError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
    readonly requestId: string | null,
    options?: ErrorOptions,
  ) {
    super(`LLM analysis request failed (${code})`, options);
    this.name = "LlmAnalysisError";
  }
}

export class LlmAnalysisClient {
  private readonly invoke: (
    request: AssembledAnalysisRequest,
  ) => Promise<AnalysisResponseOutcome>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: AnalysisClientLogger;

  constructor(private readonly options: LlmAnalysisClientOptions) {
    requirePositiveInteger(options.timeoutMs, "timeoutMs");
    requireNonnegativeInteger(options.maximumRetries, "maximumRetries");
    if (options.maximumRetries > 5) {
      throw new RangeError("maximumRetries must not exceed 5");
    }
    const active =
      options.provider === "openrouter" ? options.openrouter : options.openai;
    if (!active.model.trim()) throw new RangeError("model must not be empty");
    if (!active.apiKey) throw new RangeError("apiKey must not be empty");

    if (options.provider === "openrouter") {
      const createCompletion =
        options.createCompletion ??
        ((request) =>
          new OpenAI({
            apiKey: options.openrouter.apiKey,
            baseURL: options.openrouter.baseUrl,
            timeout: options.timeoutMs,
            maxRetries: 0,
          }).chat.completions.create(request));
      this.invoke = (request) =>
        createCompletion(
          buildChatCompletionParams({
            model: options.openrouter.model,
            reasoningEffort: options.openrouter.reasoningEffort,
            instructions: request.instructions,
            content: `${request.articleData}\n\n${request.commentData}`,
            maximumOutputTokens: request.tokens.maximumOutput,
            outputName: ANALYSIS_OUTPUT_NAME,
            outputSchema: analysisOutputJsonSchema,
          }),
        ).then(classifyCompletionResponse);
    } else {
      const createResponse =
        options.createResponse ??
        ((request) =>
          new OpenAI({
            apiKey: options.openai.apiKey,
            timeout: options.timeoutMs,
            maxRetries: 0,
          }).responses.create(request));
      this.invoke = (request) =>
        createResponse(this.responsesParameters(request)).then(
          classifyResponsesResponse,
        );
    }
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? { info: () => {}, warn: () => {} };
  }

  async analyze(
    request: AssembledAnalysisRequest,
  ): Promise<AnalysisResponseOutcome> {
    const active =
      this.options.provider === "openrouter"
        ? this.options.openrouter
        : this.options.openai;
    const maximumAttempts = this.options.maximumRetries + 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.logger.info({
        event: "llm_analysis_attempt",
        attempt,
        maximumAttempts,
        provider: this.options.provider,
        model: active.model,
        estimatedInputTokens: request.tokens.totalInput,
        maximumOutputTokens: request.tokens.maximumOutput,
      });
      try {
        const outcome = await this.invokeWithWatchdog(request);
        this.logger.info({
          event: "llm_analysis_outcome",
          attempt,
          kind: outcome.kind,
          responseId: outcome.responseId,
          model: outcome.model,
        });
        return outcome;
      } catch (error) {
        const classified = classifyLlmError(error);
        const willRetry = classified.retryable && attempt < maximumAttempts;
        this.logger.warn({
          event: "llm_analysis_error",
          attempt,
          code: classified.code,
          status: classified.status,
          requestId: classified.requestId,
          retryable: classified.retryable,
          willRetry,
        });
        if (!willRetry) throw classified;
        await this.sleep(retryDelayMs(attempt));
      }
    }

    throw new Error("LLM analysis retry loop ended unexpectedly");
  }

  // Backstop for a provider request that never settles even though the
  // OpenAI SDK was given `timeout: options.timeoutMs` (observed in
  // production against OpenRouter/DeepSeek: a single request hung well past
  // its configured timeout, wedging the whole worker since
  // WORKER_LLM_CONCURRENCY processes one job at a time). This guarantees the
  // worker always moves on, independent of why the underlying request hung.
  private invokeWithWatchdog(
    request: AssembledAnalysisRequest,
  ): Promise<AnalysisResponseOutcome> {
    const invocation = this.invoke(request);
    // Prevent an unhandled rejection if the invocation loses the race and
    // later rejects on its own.
    invocation.catch(() => {});

    let watchdog: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        reject(
          new LlmAnalysisError("request_watchdog_timeout", true, null, null),
        );
      }, this.options.timeoutMs + WATCHDOG_GRACE_MS);
    });

    return Promise.race([invocation, timeout]).finally(() => {
      clearTimeout(watchdog);
    });
  }

  private responsesParameters(
    request: AssembledAnalysisRequest,
  ): ResponseCreateParamsNonStreaming {
    return {
      model: this.options.openai.model,
      reasoning: { effort: this.options.openai.reasoningEffort },
      instructions: request.instructions,
      input: `${request.articleData}\n\n${request.commentData}`,
      max_output_tokens: request.tokens.maximumOutput,
      store: false,
      truncation: "disabled",
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: ANALYSIS_OUTPUT_NAME,
          strict: true,
          schema: analysisOutputJsonSchema,
        },
      },
    };
  }
}

export function classifyLlmError(error: unknown): LlmAnalysisError {
  if (error instanceof LlmAnalysisError) return error;
  if (error instanceof OpenAI.APIConnectionError) {
    const code =
      error instanceof OpenAI.APIConnectionTimeoutError
        ? "request_timeout"
        : "connection_error";
    return new LlmAnalysisError(code, true, null, null, { cause: error });
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? null;
    const retryable =
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (status !== null && status >= 500);
    return new LlmAnalysisError(
      safeErrorCode(error),
      retryable,
      status,
      error.requestID ?? null,
      { cause: error },
    );
  }
  return new LlmAnalysisError("unexpected_error", false, null, null, {
    cause: error,
  });
}

function classifyCompletionResponse(
  response: ChatCompletion,
): AnalysisResponseOutcome {
  const base: OutcomeBase = {
    responseId: response.id,
    model: response.model,
    usage: mapChatCompletionUsage(response.usage),
  };
  try {
    const outcome = classifyChatCompletionResponse(
      response,
      parseAnalysisOutput,
    );
    return { ...base, ...outcome };
  } catch (error) {
    throw new LlmAnalysisError("invalid_structured_output", false, null, null, {
      cause: error,
    });
  }
}

function classifyResponsesResponse(
  response: Response,
): AnalysisResponseOutcome {
  const base: OutcomeBase = {
    responseId: response.id,
    model: response.model,
    usage: mapResponsesUsage(response.usage),
  };
  const refusal = response.output
    .filter((item) => item.type === "message")
    .flatMap((message) => message.content)
    .find((content) => content.type === "refusal");
  if (refusal) return { ...base, kind: "refusal", refusal: refusal.refusal };

  if (response.status === "failed") {
    return {
      ...base,
      kind: "failed",
      code: response.error?.code ?? "response_failed",
    };
  }
  const incompleteMessage = response.output.find(
    (item) => item.type === "message" && item.status === "incomplete",
  );
  if (response.status !== "completed" || incompleteMessage) {
    return {
      ...base,
      kind: "incomplete",
      reason:
        response.incomplete_details?.reason ??
        (incompleteMessage
          ? "message_incomplete"
          : (response.status ?? "unknown_status")),
    };
  }

  try {
    return {
      ...base,
      kind: "completed",
      output: parseAnalysisOutput(JSON.parse(response.output_text)),
    };
  } catch (error) {
    throw new LlmAnalysisError("invalid_structured_output", false, null, null, {
      cause: error,
    });
  }
}

function mapResponsesUsage(
  usage: ResponseUsage | undefined,
): AnalysisUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedReadTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
  };
}

function safeErrorCode(error: APIError): string {
  const code = error.code;
  if (code && /^[a-z0-9_.-]{1,100}$/iu.test(code)) return code;
  return error.status ? `http_${error.status}` : "api_error";
}

function retryDelayMs(failedAttempt: number): number {
  return Math.min(2_000, 250 * 2 ** (failedAttempt - 1));
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function requireNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
}
