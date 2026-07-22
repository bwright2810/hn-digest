import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisOutput,
} from "./contract";
import {
  OpenAIAnalysisClient,
  OpenAIAnalysisError,
  classifyOpenAIError,
} from "./openai-client";
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

function client(
  createResponse: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>,
  overrides: Partial<
    ConstructorParameters<typeof OpenAIAnalysisClient>[0]
  > = {},
): OpenAIAnalysisClient {
  return new OpenAIAnalysisClient({
    apiKey: secretKey,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    timeoutMs: 30_000,
    maximumRetries: 2,
    createResponse,
    sleep: async () => {},
    ...overrides,
  });
}

describe("OpenAIAnalysisClient", () => {
  it("sends a bounded Responses API request with strict Structured Outputs", async () => {
    const createResponse = vi.fn(
      async (request: ResponseCreateParamsNonStreaming) => {
        void request;
        return response();
      },
    );
    const outcome = await client(createResponse).analyze(assembledRequest());

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
      client(createResponse, { sleep }).analyze(assembledRequest()),
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
      client(createResponse).analyze(assembledRequest()),
    ).rejects.toMatchObject({
      name: "OpenAIAnalysisError",
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
      client(async () => refusalResponse).analyze(assembledRequest()),
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
      client(async () => incomplete).analyze(assembledRequest()),
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
      client(async () => failed).analyze(assembledRequest()),
    ).resolves.toMatchObject({ kind: "failed", code: "server_error" });
  });

  it("rejects invalid structured output as a terminal classified error", async () => {
    await expect(
      client(async () => response({ output_text: "not JSON" })).analyze(
        assembledRequest(),
      ),
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

    await client(async () => response(), { logger }).analyze(
      assembledRequest(),
    );

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain(copyrightedSource);
    expect(serialized).not.toContain("trusted analysis instructions");
  });

  it("rejects unbounded retry configuration", () => {
    expect(() => client(async () => response(), { maximumRetries: 6 })).toThrow(
      "maximumRetries must not exceed 5",
    );
  });
});

describe("classifyOpenAIError", () => {
  it("classifies connection failures as retryable and unknown errors as terminal", () => {
    expect(
      classifyOpenAIError(
        new OpenAI.APIConnectionTimeoutError({ message: "timed out" }),
      ),
    ).toMatchObject({ code: "request_timeout", retryable: true });
    expect(classifyOpenAIError(new Error("unknown"))).toMatchObject({
      code: "unexpected_error",
      retryable: false,
    });
  });

  it("preserves an existing classified error", () => {
    const error = new OpenAIAnalysisError("known", false, null, null);
    expect(classifyOpenAIError(error)).toBe(error);
  });
});
