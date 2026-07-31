import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisOutput,
} from "./contract";
import {
  LlmAnalysisClient,
  LlmAnalysisError,
  classifyLlmError,
  type LlmAnalysisClientOptions,
} from "./llm-analysis-client";
import type { AssembledAnalysisRequest } from "./request";

const secretKey = "secret-api-key-that-must-not-be-logged";
const copyrightedSource = "full copyrighted source must not be logged";

function output(): AnalysisOutput {
  return {
    promptVersion: ANALYSIS_PROMPT_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    article: {
      thesis: null,
      keyPoints: [],
      evidence: [],
      limitations: [],
      confidence: "low",
      sourceQualityNotes: ["Article content was unavailable."],
    },
    discussion: {
      consensus: [],
      competingViewpoints: [],
      insightfulComments: [],
      unresolvedQuestions: [],
      confidence: "low",
      sourceQualityNotes: [],
    },
    combinedTakeaway: {
      summary: "The available evidence is too limited for a firm takeaway.",
      tensions: [],
      confidence: "low",
    },
  };
}

function assembledRequest(): AssembledAnalysisRequest {
  return {
    formatVersion: "analysis-request-v1",
    instructions: "trusted analysis instructions",
    articleData: JSON.stringify({ text: copyrightedSource }),
    commentData: JSON.stringify({ comments: [] }),
    outputSchema: {},
    selectedCommentIds: [],
    omittedCommentIds: [],
    tokens: {
      instructions: 10,
      article: 20,
      comments: 5,
      inputOverhead: 2,
      totalInput: 37,
      maximumOutput: 400,
    },
    cost: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 4,
      estimatedInputCostUsd: 0.000037,
      maximumOutputCostUsd: 0.0016,
      maximumRequestCostUsd: 0.001637,
      hardLimitUsd: 0.01,
    },
  };
}

function response(overrides: Partial<Response> = {}): Response {
  return {
    id: "resp_123",
    model: "gpt-5.6-luna",
    status: "completed",
    output_text: JSON.stringify(output()),
    output: [
      {
        id: "msg_123",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output()),
            annotations: [],
          },
        ],
      },
    ],
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      total_tokens: 200,
      input_tokens_details: {
        cached_tokens: 40,
        cache_write_tokens: 10,
      },
      output_tokens_details: { reasoning_tokens: 20 },
    },
    ...overrides,
  } as Response;
}

function chatCompletion(overrides: Partial<ChatCompletion> = {}): ChatCompletion {
  return {
    id: "chatcmpl_123",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "deepseek/deepseek-v4-flash",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: JSON.stringify(output()),
          refusal: null,
        },
      },
    ],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
      completion_tokens_details: { reasoning_tokens: 20 },
    },
    ...overrides,
  } as ChatCompletion;
}

function baseOptions(
  overrides: Partial<LlmAnalysisClientOptions> = {},
): LlmAnalysisClientOptions {
  return {
    provider: "openai",
    openai: {
      apiKey: secretKey,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    },
    openrouter: {
      apiKey: secretKey,
      model: "deepseek/deepseek-v4-flash",
      reasoningEffort: "high",
      baseUrl: "https://openrouter.ai/api/v1",
    },
    timeoutMs: 30_000,
    maximumRetries: 2,
    sleep: async () => {},
    ...overrides,
  };
}

function openaiClient(
  createResponse: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>,
  overrides: Partial<LlmAnalysisClientOptions> = {},
): LlmAnalysisClient {
  return new LlmAnalysisClient(
    baseOptions({ provider: "openai", createResponse, ...overrides }),
  );
}

function openRouterClient(
  createCompletion: (
    request: ChatCompletionCreateParamsNonStreaming,
  ) => Promise<ChatCompletion>,
  overrides: Partial<LlmAnalysisClientOptions> = {},
): LlmAnalysisClient {
  return new LlmAnalysisClient(
    baseOptions({ provider: "openrouter", createCompletion, ...overrides }),
  );
}

describe("LlmAnalysisClient (openai provider, Responses API)", () => {
  it("sends a bounded Responses API request with strict Structured Outputs", async () => {
    const createResponse = vi.fn(
      async (request: ResponseCreateParamsNonStreaming) => {
        void request;
        return response();
      },
    );
    const outcome = await openaiClient(createResponse).analyze(
      assembledRequest(),
    );

    expect(createResponse).toHaveBeenCalledOnce();
    expect(createResponse.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      instructions: "trusted analysis instructions",
      max_output_tokens: 400,
      store: false,
      truncation: "disabled",
      text: {
        format: {
          type: "json_schema",
          name: "hn_digest_analysis",
          strict: true,
        },
      },
    });
    expect(createResponse.mock.calls[0]?.[0].input).toContain(
      copyrightedSource,
    );
    expect(outcome).toMatchObject({
      kind: "completed",
      responseId: "resp_123",
      output: output(),
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        cachedReadTokens: 40,
        cacheWriteTokens: 10,
        reasoningTokens: 20,
      },
    });
  });

  it("retries transient errors with bounded exponential delays", async () => {
    const transient = OpenAI.APIError.generate(
      500,
      { error: { code: "server_error" } },
      "server failed",
      new Headers({ "x-request-id": "req_retry" }),
    );
    const createResponse = vi
      .fn<(request: ResponseCreateParamsNonStreaming) => Promise<Response>>()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(response());
    const sleep = vi.fn(async () => {});

    await expect(
      openaiClient(createResponse, { sleep }).analyze(assembledRequest()),
    ).resolves.toMatchObject({ kind: "completed" });
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not retry terminal API errors", async () => {
    const terminal = OpenAI.APIError.generate(
      400,
      { error: { code: "invalid_request_error" } },
      "bad request",
      new Headers({ "x-request-id": "req_terminal" }),
    );
    const createResponse = vi.fn(async () => Promise.reject(terminal));

    await expect(
      openaiClient(createResponse).analyze(assembledRequest()),
    ).rejects.toMatchObject({
      name: "LlmAnalysisError",
      retryable: false,
      status: 400,
    });
    expect(createResponse).toHaveBeenCalledOnce();
  });

  it("returns refusals as an explicit outcome", async () => {
    const refusalResponse = response({
      output_text: "",
      output: [
        {
          id: "msg_refusal",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "Unable to analyze." }],
        },
      ],
    });

    await expect(
      openaiClient(async () => refusalResponse).analyze(assembledRequest()),
    ).resolves.toMatchObject({
      kind: "refusal",
      refusal: "Unable to analyze.",
    });
  });

  it("returns incomplete and failed responses as explicit outcomes", async () => {
    const incomplete = response({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "",
    });
    await expect(
      openaiClient(async () => incomplete).analyze(assembledRequest()),
    ).resolves.toMatchObject({
      kind: "incomplete",
      reason: "max_output_tokens",
    });

    const failed = response({
      status: "failed",
      error: { code: "server_error", message: "generation failed" },
      output_text: "",
    });
    await expect(
      openaiClient(async () => failed).analyze(assembledRequest()),
    ).resolves.toMatchObject({ kind: "failed", code: "server_error" });
  });

  it("rejects invalid structured output as a terminal classified error", async () => {
    await expect(
      openaiClient(async () =>
        response({ output_text: "not JSON" }),
      ).analyze(assembledRequest()),
    ).rejects.toMatchObject({
      code: "invalid_structured_output",
      retryable: false,
    });
  });

  it("logs only classified metadata, never credentials or source bodies", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = {
      info: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
      warn: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
    };

    await openaiClient(async () => response(), { logger }).analyze(
      assembledRequest(),
    );

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain(copyrightedSource);
    expect(serialized).not.toContain("trusted analysis instructions");
  });

  it("rejects unbounded retry configuration", () => {
    expect(() =>
      openaiClient(async () => response(), { maximumRetries: 6 }),
    ).toThrow("maximumRetries must not exceed 5");
  });
});

describe("LlmAnalysisClient (openrouter provider, Chat Completions API)", () => {
  it("sends a bounded chat completion request with strict Structured Outputs", async () => {
    const createCompletion = vi.fn(
      async (request: ChatCompletionCreateParamsNonStreaming) => {
        void request;
        return chatCompletion();
      },
    );
    const outcome = await openRouterClient(createCompletion).analyze(
      assembledRequest(),
    );

    expect(createCompletion).toHaveBeenCalledOnce();
    const sentParams = createCompletion.mock.calls[0]?.[0];
    expect(sentParams).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      reasoning: { effort: "high" },
      max_tokens: 400,
      response_format: {
        type: "json_schema",
        json_schema: { name: "hn_digest_analysis", strict: true },
      },
    });
    expect(JSON.stringify(sentParams?.messages)).toContain(
      copyrightedSource,
    );
    expect(outcome).toMatchObject({
      kind: "completed",
      responseId: "chatcmpl_123",
      output: output(),
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        cachedReadTokens: 40,
        cacheWriteTokens: 10,
        reasoningTokens: 20,
      },
    });
  });

  it("retries transient errors with bounded exponential delays", async () => {
    const transient = OpenAI.APIError.generate(
      500,
      { error: { code: "server_error" } },
      "server failed",
      new Headers({ "x-request-id": "req_retry" }),
    );
    const createCompletion = vi
      .fn<
        (
          request: ChatCompletionCreateParamsNonStreaming,
        ) => Promise<ChatCompletion>
      >()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(chatCompletion());
    const sleep = vi.fn(async () => {});

    await expect(
      openRouterClient(createCompletion, { sleep }).analyze(
        assembledRequest(),
      ),
    ).resolves.toMatchObject({ kind: "completed" });
    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not retry terminal API errors", async () => {
    const terminal = OpenAI.APIError.generate(
      400,
      { error: { code: "invalid_request_error" } },
      "bad request",
      new Headers({ "x-request-id": "req_terminal" }),
    );
    const createCompletion = vi.fn(async () => Promise.reject(terminal));

    await expect(
      openRouterClient(createCompletion).analyze(assembledRequest()),
    ).rejects.toMatchObject({
      name: "LlmAnalysisError",
      retryable: false,
      status: 400,
    });
    expect(createCompletion).toHaveBeenCalledOnce();
  });

  it("returns refusals as an explicit outcome", async () => {
    const refusalResponse = chatCompletion({
      choices: [
        {
          index: 0,
          finish_reason: "content_filter",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: "Unable to analyze.",
          },
        },
      ],
    });

    await expect(
      openRouterClient(async () => refusalResponse).analyze(
        assembledRequest(),
      ),
    ).resolves.toMatchObject({
      kind: "refusal",
      refusal: "Unable to analyze.",
    });
  });

  it("returns a truncated completion as an incomplete outcome", async () => {
    const truncated = chatCompletion({
      choices: [
        {
          index: 0,
          finish_reason: "length",
          logprobs: null,
          message: { role: "assistant", content: null, refusal: null },
        },
      ],
    });

    await expect(
      openRouterClient(async () => truncated).analyze(assembledRequest()),
    ).resolves.toMatchObject({ kind: "incomplete", reason: "length" });
  });

  it("rejects invalid structured output as a terminal classified error", async () => {
    const malformed = chatCompletion({
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: { role: "assistant", content: "not JSON", refusal: null },
        },
      ],
    });

    await expect(
      openRouterClient(async () => malformed).analyze(assembledRequest()),
    ).rejects.toMatchObject({
      code: "invalid_structured_output",
      retryable: false,
    });
  });

  it("logs only classified metadata, never credentials or source bodies", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = {
      info: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
      warn: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
    };

    await openRouterClient(async () => chatCompletion(), { logger }).analyze(
      assembledRequest(),
    );

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain(copyrightedSource);
    expect(serialized).not.toContain("trusted analysis instructions");
  });
});

describe("classifyLlmError", () => {
  it("classifies connection failures as retryable and unknown errors as terminal", () => {
    expect(
      classifyLlmError(
        new OpenAI.APIConnectionTimeoutError({ message: "timed out" }),
      ),
    ).toMatchObject({ code: "request_timeout", retryable: true });
    expect(classifyLlmError(new Error("unknown"))).toMatchObject({
      code: "unexpected_error",
      retryable: false,
    });
  });

  it("preserves an existing classified error", () => {
    const error = new LlmAnalysisError("known", false, null, null);
    expect(classifyLlmError(error)).toBe(error);
  });
});
