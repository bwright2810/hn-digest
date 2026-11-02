import OpenAI from "openai";
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
  HUMANIZER_OUTPUT_NAME,
  parseHumanizerOutput,
  type HumanizerOutput,
} from "./humanizer-contract";
import {
  classifyLlmError,
  LlmAnalysisError,
  type CodexProviderCredentials,
  type LlmAnalysisClientOptions,
} from "./llm-analysis-client";
import type { AssembledHumanizerRequest } from "./humanizer-request";
import {
  buildChatCompletionParams,
  classifyChatCompletionResponse,
  mapChatCompletionUsage,
} from "./chat-completion-provider";
import {
  classifyCodexExecResult,
  runCodexExecProcess,
  type CodexExecRawResult,
  type CodexExecRequest,
} from "./codex-exec-provider";

const DEFAULT_CODEX_CREDENTIALS: CodexProviderCredentials = {
  model: "gpt-6-luna",
  reasoningEffort: "low",
  binaryPath: "codex",
  codexHome: null,
};

export type HumanizerClientOptions = Omit<
  LlmAnalysisClientOptions,
  "createResponse" | "createCompletion" | "runCodexExec"
> & {
  readonly createResponse?: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>;
  readonly createCompletion?: (
    request: ChatCompletionCreateParamsNonStreaming,
  ) => Promise<ChatCompletion>;
  readonly runCodexExec?: (
    request: CodexExecRequest,
  ) => Promise<CodexExecRawResult>;
};

export interface HumanizerClientLogger {
  info(event: Readonly<Record<string, unknown>>): void;
  warn(event: Readonly<Record<string, unknown>>): void;
}

export interface HumanizerUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

interface OutcomeBase {
  readonly responseId: string;
  readonly model: string;
  readonly usage: HumanizerUsage | null;
}

export type HumanizerResponseOutcome =
  | (OutcomeBase & {
      readonly kind: "completed";
      readonly output: HumanizerOutput;
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

export class HumanizerClient {
  private readonly invoke: (
    request: AssembledHumanizerRequest,
  ) => Promise<HumanizerResponseOutcome>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: HumanizerClientLogger;
  private readonly activeModel: string;

  constructor(private readonly options: HumanizerClientOptions) {
    requirePositiveInteger(options.timeoutMs, "timeoutMs");
    requireNonnegativeInteger(options.maximumRetries, "maximumRetries");
    if (options.maximumRetries > 5) {
      throw new RangeError("maximumRetries must not exceed 5");
    }

    if (options.provider === "codex") {
      const codex = options.codex ?? DEFAULT_CODEX_CREDENTIALS;
      if (!codex.model.trim()) throw new RangeError("model must not be empty");
      if (!codex.binaryPath.trim()) {
        throw new RangeError("binaryPath must not be empty");
      }
      this.activeModel = codex.model;
      const runCodex = options.runCodexExec ?? runCodexExecProcess;
      this.invoke = (request) =>
        runCodex({
          binaryPath: codex.binaryPath,
          codexHome: codex.codexHome,
          model: codex.model,
          reasoningEffort: codex.reasoningEffort,
          instructions: request.instructions,
          content: request.inputData,
          outputSchema: request.outputSchema,
          timeoutMs: options.timeoutMs,
        }).then((raw) =>
          classifyCodexExecResult(raw, codex.model, parseHumanizerOutput),
        );
    } else if (options.provider === "openrouter") {
      if (!options.openrouter.model.trim()) {
        throw new RangeError("model must not be empty");
      }
      if (!options.openrouter.apiKey) {
        throw new RangeError("apiKey must not be empty");
      }
      this.activeModel = options.openrouter.model;
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
            content: request.inputData,
            maximumOutputTokens: request.tokens.maximumOutput,
            outputName: HUMANIZER_OUTPUT_NAME,
            outputSchema: request.outputSchema,
          }),
        ).then(classifyCompletionResponse);
    } else {
      if (!options.openai.model.trim()) {
        throw new RangeError("model must not be empty");
      }
      if (!options.openai.apiKey) {
        throw new RangeError("apiKey must not be empty");
      }
      this.activeModel = options.openai.model;
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

  async humanize(
    request: AssembledHumanizerRequest,
  ): Promise<HumanizerResponseOutcome> {
    const maximumAttempts = this.options.maximumRetries + 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.logger.info({
        event: "humanizer_attempt",
        attempt,
        maximumAttempts,
        provider: this.options.provider,
        model: this.activeModel,
        estimatedInputTokens: request.tokens.totalInput,
        maximumOutputTokens: request.tokens.maximumOutput,
      });
      try {
        const outcome = await this.invoke(request);
        this.logger.info({
          event: "humanizer_outcome",
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
          event: "humanizer_error",
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

    throw new Error("Humanizer retry loop ended unexpectedly");
  }

  private responsesParameters(
    request: AssembledHumanizerRequest,
  ): ResponseCreateParamsNonStreaming {
    return {
      model: this.options.openai.model,
      reasoning: { effort: this.options.openai.reasoningEffort },
      instructions: request.instructions,
      input: request.inputData,
      max_output_tokens: request.tokens.maximumOutput,
      store: false,
      truncation: "disabled",
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: HUMANIZER_OUTPUT_NAME,
          strict: true,
          schema: request.outputSchema,
        },
      },
    };
  }
}

function classifyCompletionResponse(
  response: ChatCompletion,
): HumanizerResponseOutcome {
  const base: OutcomeBase = {
    responseId: response.id,
    model: response.model,
    usage: mapChatCompletionUsage(response.usage),
  };
  try {
    const outcome = classifyChatCompletionResponse(
      response,
      parseHumanizerOutput,
    );
    return { ...base, ...outcome };
  } catch (error) {
    throw new LlmAnalysisError("invalid_structured_output", true, null, null, {
      cause: error,
    });
  }
}

function classifyResponsesResponse(
  response: Response,
): HumanizerResponseOutcome {
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
      output: parseHumanizerOutput(JSON.parse(response.output_text)),
    };
  } catch (error) {
    throw new LlmAnalysisError("invalid_structured_output", true, null, null, {
      cause: error,
    });
  }
}

function mapResponsesUsage(
  usage: ResponseUsage | undefined,
): HumanizerUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedReadTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
  };
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
