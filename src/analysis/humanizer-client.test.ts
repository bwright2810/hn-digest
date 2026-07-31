import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import {
  HUMANIZER_PROMPT_VERSION,
  HUMANIZER_SCHEMA_VERSION,
  type HumanizerOutput,
} from "./humanizer-contract";
import { HumanizerClient } from "./humanizer-client";
import { OpenAIAnalysisError, classifyOpenAIError } from "./openai-client";
import type { AssembledHumanizerRequest } from "./humanizer-request";

const secretKey = "secret-api-key-that-must-not-be-logged";
const trustedProse = "digest prose that must not be logged";

function output(): HumanizerOutput {
  return {
    promptVersion: HUMANIZER_PROMPT_VERSION,
    schemaVersion: HUMANIZER_SCHEMA_VERSION,
    stories: [
      {
        storyId: "story-1",
        article: "Rewritten article claim.",
        discussion: "Rewritten discussion claim.",
        takeaway: "Rewritten takeaway.",
      },
    ],
  };
}

function assembledRequest(): AssembledHumanizerRequest {
  return {
    formatVersion: "humanizer-request-v1",
    instructions: "trusted humanizer instructions",
    inputData: JSON.stringify({ stories: [{ takeaway: trustedProse }] }),
    outputSchema: {},
    storyIds: ["story-1"],
    tokens: {
      instructions: 10,
      input: 20,
      totalInput: 30,
      maximumOutput: 400,
    },
    cost: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 4,
      estimatedInputCostUsd: 0.00003,
      maximumOutputCostUsd: 0.0016,
      maximumRequestCostUsd: 0.00163,
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
      input_tokens: 60,
      output_tokens: 30,
      total_tokens: 90,
      input_tokens_details: {
        cached_tokens: 10,
        cache_write_tokens: 0,
      },
      output_tokens_details: { reasoning_tokens: 5 },
    },
    ...overrides,
  } as Response;
}

function client(
  createResponse: (
    request: ResponseCreateParamsNonStreaming,
  ) => Promise<Response>,
  overrides: Partial<ConstructorParameters<typeof HumanizerClient>[0]> = {},
): HumanizerClient {
  return new HumanizerClient({
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

describe("HumanizerClient", () => {
  it("sends a bounded Responses API request with strict Structured Outputs", async () => {
    const createResponse = vi.fn(
      async (request: ResponseCreateParamsNonStreaming) => {
        void request;
        return response();
      },
    );
    const outcome = await client(createResponse).humanize(assembledRequest());

    expect(createResponse).toHaveBeenCalledOnce();
    expect(createResponse.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      instructions: "trusted humanizer instructions",
      max_output_tokens: 400,
      store: false,
      truncation: "disabled",
      text: {
        format: {
          type: "json_schema",
          name: "hn_digest_humanized_prose",
          strict: true,
        },
      },
    });
    expect(createResponse.mock.calls[0]?.[0].input).toContain(trustedProse);
    expect(outcome).toMatchObject({
      kind: "completed",
      responseId: "resp_123",
      output: output(),
      usage: {
        inputTokens: 60,
        outputTokens: 30,
        cachedReadTokens: 10,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
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
      client(createResponse, { sleep }).humanize(assembledRequest()),
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
      client(createResponse).humanize(assembledRequest()),
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
          content: [{ type: "refusal", refusal: "Unable to rewrite." }],
        },
      ],
    });

    await expect(
      client(async () => refusalResponse).humanize(assembledRequest()),
    ).resolves.toMatchObject({
      kind: "refusal",
      refusal: "Unable to rewrite.",
    });
  });

  it("returns incomplete and failed responses as explicit outcomes", async () => {
    const incomplete = response({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "",
    });
    await expect(
      client(async () => incomplete).humanize(assembledRequest()),
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
      client(async () => failed).humanize(assembledRequest()),
    ).resolves.toMatchObject({ kind: "failed", code: "server_error" });
  });

  it("rejects invalid structured output as a terminal classified error", async () => {
    await expect(
      client(async () => response({ output_text: "not JSON" })).humanize(
        assembledRequest(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_structured_output",
      retryable: false,
    });
  });

  it("rejects output whose storyId set doesn't validate against the schema shape", async () => {
    const malformed = response({
      output_text: JSON.stringify({
        promptVersion: HUMANIZER_PROMPT_VERSION,
        schemaVersion: HUMANIZER_SCHEMA_VERSION,
        stories: [{ storyId: "story-1" }],
      }),
    });
    await expect(
      client(async () => malformed).humanize(assembledRequest()),
    ).rejects.toMatchObject({ code: "invalid_structured_output" });
  });

  it("logs only classified metadata, never credentials or source prose", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = {
      info: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
      warn: (entry: Readonly<Record<string, unknown>>) =>
        entries.push({ ...entry }),
    };

    await client(async () => response(), { logger }).humanize(
      assembledRequest(),
    );

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain(trustedProse);
    expect(serialized).not.toContain("trusted humanizer instructions");
  });

  it("rejects unbounded retry configuration", () => {
    expect(() => client(async () => response(), { maximumRetries: 6 })).toThrow(
      "maximumRetries must not exceed 5",
    );
  });
});

describe("classifyOpenAIError re-export", () => {
  it("is the same classifier the analysis client uses", () => {
    const error = new OpenAIAnalysisError("known", false, null, null);
    expect(classifyOpenAIError(error)).toBe(error);
  });
});
