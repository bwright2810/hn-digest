import OpenAI from "openai";
import type { APIError } from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";

import {
  ANALYSIS_OUTPUT_NAME,
  analysisOutputJsonSchema,
  parseAnalysisOutput,
  type AnalysisOutput,
} from "./contract";
import type { AssembledAnalysisRequest } from "./request";

type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAIAnalysisClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly timeoutMs: number;
  readonly maximumRetries: number;
  readonly logger?: AnalysisClientLogger;
  readonly createResponse?: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>;
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

export class OpenAIAnalysisError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
    readonly requestId: string | null,
    options?: ErrorOptions,
  ) {
    super(`OpenAI analysis request failed (${code})`, options);
    this.name = "OpenAIAnalysisError";
  }
}

export class OpenAIAnalysisClient {
  private readonly createResponse: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: AnalysisClientLogger;

  constructor(private readonly options: OpenAIAnalysisClientOptions) {
    requirePositiveInteger(options.timeoutMs, "timeoutMs");
    requireNonnegativeInteger(options.maximumRetries, "maximumRetries");
    if (options.maximumRetries > 5) {
      throw new RangeError("maximumRetries must not exceed 5");
    }
    if (!options.model.trim()) throw new RangeError("model must not be empty");
    if (!options.apiKey) throw new RangeError("apiKey must not be empty");

    if (options.createResponse) {
      this.createResponse = options.createResponse;
    } else {
      const openai = new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs,
        maxRetries: 0,
      });
      this.createResponse = (request) => openai.responses.create(request);
    }
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? { info: () => {}, warn: () => {} };
  }

  async analyze(
    request: AssembledAnalysisRequest,
  ): Promise<AnalysisResponseOutcome> {
    const parameters = this.parameters(request);
    const maximumAttempts = this.options.maximumRetries + 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.logger.info({
        event: "openai_analysis_attempt",
        attempt,
        maximumAttempts,
        model: this.options.model,
        estimatedInputTokens: request.tokens.totalInput,
        maximumOutputTokens: request.tokens.maximumOutput,
      });
      try {
        const response = await this.createResponse(parameters);
        const outcome = classifyResponse(response);
        this.logger.info({
          event: "openai_analysis_outcome",
          attempt,
          kind: outcome.kind,
          responseId: outcome.responseId,
          model: outcome.model,
        });
        return outcome;
      } catch (error) {
        const classified = classifyOpenAIError(error);
        const willRetry = classified.retryable && attempt < maximumAttempts;
        this.logger.warn({
          event: "openai_analysis_error",
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

    throw new Error("OpenAI retry loop ended unexpectedly");
  }

  private parameters(
    request: AssembledAnalysisRequest,
  ): ResponseCreateParamsNonStreaming {
    return {
      model: this.options.model,
      reasoning: { effort: this.options.reasoningEffort },
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

export function classifyOpenAIError(error: unknown): OpenAIAnalysisError {
  if (error instanceof OpenAIAnalysisError) return error;
  if (error instanceof OpenAI.APIConnectionError) {
    const code =
      error instanceof OpenAI.APIConnectionTimeoutError
        ? "request_timeout"
        : "connection_error";
    return new OpenAIAnalysisError(code, true, null, null, { cause: error });
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? null;
    const retryable =
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (status !== null && status >= 500);
    return new OpenAIAnalysisError(
      safeErrorCode(error),
      retryable,
      status,
      error.requestID ?? null,
      { cause: error },
    );
  }
  return new OpenAIAnalysisError("unexpected_error", false, null, null, {
    cause: error,
  });
}

function classifyResponse(response: Response): AnalysisResponseOutcome {
  const base: OutcomeBase = {
    responseId: response.id,
    model: response.model,
    usage: mapUsage(response.usage),
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
    throw new OpenAIAnalysisError(
      "invalid_structured_output",
      false,
      null,
      null,
      { cause: error },
    );
  }
}

function mapUsage(usage: ResponseUsage | undefined): AnalysisUsage | null {
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
