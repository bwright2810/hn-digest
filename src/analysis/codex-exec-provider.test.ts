import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  parseAnalysisOutput,
  type AnalysisOutput,
} from "./contract";
import {
  buildCodexExecArgs,
  buildCodexExecPrompt,
  classifyCodexExecResult,
  CodexExecProviderError,
  type CodexExecRequest,
} from "./codex-exec-provider";
import { LlmAnalysisClient } from "./llm-analysis-client";
import type { AssembledAnalysisRequest } from "./request";

function sampleOutput(): AnalysisOutput {
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

function sampleRequest(): AssembledAnalysisRequest {
  return {
    formatVersion: "analysis-request-v1",
    instructions: "trusted analysis instructions",
    articleData: JSON.stringify({ text: "article body" }),
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
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.2,
      estimatedInputCostUsd: 0.0000037,
      maximumOutputCostUsd: 0.00008,
      maximumRequestCostUsd: 0.0000837,
      hardLimitUsd: 0.1,
    },
  };
}

describe("codex-exec-provider", () => {
  it("builds bounded ephemeral read-only codex exec arguments", () => {
    expect(
      buildCodexExecArgs(
        { model: "gpt-6-luna", reasoningEffort: "low" },
        "/tmp/schema.json",
      ),
    ).toEqual([
      "exec",
      "-m",
      "gpt-6-luna",
      "-c",
      "model_reasoning_effort=low",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "--output-schema",
      "/tmp/schema.json",
      "--json",
      "-",
    ]);
  });

  it("prepends tool-suppression guardrails to the stdin prompt", () => {
    const prompt = buildCodexExecPrompt({
      instructions: "editorial rules",
      content: "article and comments",
    });
    expect(prompt).toContain("Do not run any shell commands");
    expect(prompt).toContain("editorial rules");
    expect(prompt).toContain("article and comments");
  });

  it("parses JSONL events, structured output, and token usage", () => {
    const jsonl = [
      JSON.stringify({
        type: "thread.started",
        thread_id: "thread_abc123",
      }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: JSON.stringify(sampleOutput()),
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 15000,
          cached_input_tokens: 12000,
          cache_write_input_tokens: 0,
          output_tokens: 250,
          reasoning_output_tokens: 40,
        },
      }),
    ].join("\n");

    const outcome = classifyCodexExecResult(
      { exitCode: 0, stdout: jsonl, stderr: "", timedOut: false },
      "gpt-6-luna",
      parseAnalysisOutput,
    );

    expect(outcome).toEqual({
      kind: "completed",
      responseId: "thread_abc123",
      model: "gpt-6-luna",
      output: sampleOutput(),
      usage: {
        inputTokens: 15000,
        outputTokens: 250,
        cachedReadTokens: 12000,
        cacheWriteTokens: 0,
        reasoningTokens: 40,
      },
    });
  });

  it("classifies 400 turn failures as non-retryable and 500/timeout as retryable", () => {
    const badRequestJsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_400" }),
      JSON.stringify({
        type: "turn.failed",
        error: {
          message: JSON.stringify({
            type: "error",
            error: {
              message: "Invalid payload",
              type: "invalid_request_error",
              code: null,
            },
            status: 400,
          }),
        },
      }),
    ].join("\n");

    expect(() =>
      classifyCodexExecResult(
        { exitCode: 1, stdout: badRequestJsonl, stderr: "", timedOut: false },
        "gpt-6-luna",
        parseAnalysisOutput,
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "CodexExecProviderError",
        code: "invalid_request_error",
        retryable: false,
        status: 400,
        requestId: "thread_400",
      }),
    );

    expect(() =>
      classifyCodexExecResult(
        { exitCode: null, stdout: "", stderr: "", timedOut: true },
        "gpt-6-luna",
        parseAnalysisOutput,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "request_timeout",
        retryable: true,
      } satisfies Partial<CodexExecProviderError>),
    );
  });

  it("integrates with LlmAnalysisClient when provider is codex", async () => {
    const runCodexExec = vi.fn(async (request: CodexExecRequest) => {
      void request;
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            type: "thread.started",
            thread_id: "thread_codex_1",
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_0",
              type: "agent_message",
              text: JSON.stringify(sampleOutput()),
            },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: {
              input_tokens: 14500,
              cached_input_tokens: 10000,
              cache_write_input_tokens: 0,
              output_tokens: 180,
              reasoning_output_tokens: 20,
            },
          }),
        ].join("\n"),
        stderr: "",
        timedOut: false,
      };
    });

    const client = new LlmAnalysisClient({
      provider: "codex",
      openai: { apiKey: "", model: "gpt-5.6-luna", reasoningEffort: "low" },
      openrouter: {
        apiKey: "",
        model: "deepseek/deepseek-v4-flash",
        reasoningEffort: "high",
        baseUrl: "https://openrouter.ai/api/v1",
      },
      codex: {
        model: "gpt-6-luna",
        reasoningEffort: "low",
        binaryPath: "/codex/bin/codex",
        codexHome: "/codex/home",
      },
      timeoutMs: 30_000,
      maximumRetries: 2,
      runCodexExec,
      sleep: async () => {},
    });

    const outcome = await client.analyze(sampleRequest());
    expect(runCodexExec).toHaveBeenCalledOnce();
    expect(runCodexExec.mock.calls[0]?.[0]).toMatchObject({
      binaryPath: "/codex/bin/codex",
      codexHome: "/codex/home",
      model: "gpt-6-luna",
      reasoningEffort: "low",
      timeoutMs: 30_000,
    });
    expect(outcome).toMatchObject({
      kind: "completed",
      responseId: "thread_codex_1",
      model: "gpt-6-luna",
    });
  });
});
