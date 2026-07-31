import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";

export interface ChatCompletionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

export type ChatCompletionOutcome<T> =
  | { readonly kind: "completed"; readonly output: T }
  | { readonly kind: "refusal"; readonly refusal: string }
  | { readonly kind: "incomplete"; readonly reason: string };

export interface BuildChatCompletionParamsOptions {
  readonly model: string;
  readonly reasoningEffort: string;
  readonly instructions: string;
  readonly content: string;
  readonly maximumOutputTokens: number;
  readonly outputName: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export function buildChatCompletionParams(
  options: BuildChatCompletionParamsOptions,
): ChatCompletionCreateParamsNonStreaming {
  return {
    model: options.model,
    // OpenRouter's own unified reasoning-effort control, documented separately
    // from OpenAI's `reasoning_effort` field; not part of the SDK's typed
    // chat-completions params, so this is intentionally widened below.
    reasoning: { effort: options.reasoningEffort },
    messages: [
      { role: "system", content: options.instructions },
      { role: "user", content: options.content },
    ],
    max_tokens: options.maximumOutputTokens,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: options.outputName,
        strict: true,
        schema: options.outputSchema,
      },
    },
  } as ChatCompletionCreateParamsNonStreaming & {
    reasoning: { effort: string };
  };
}

export function classifyChatCompletionResponse<T>(
  response: ChatCompletion,
  parseOutput: (value: unknown) => T,
): ChatCompletionOutcome<T> {
  const choice = response.choices[0];
  if (!choice) {
    return { kind: "incomplete", reason: "no_choices" };
  }

  if (choice.finish_reason === "content_filter") {
    return {
      kind: "refusal",
      refusal: choice.message.refusal ?? "content_filter",
    };
  }
  if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") {
    return { kind: "incomplete", reason: choice.finish_reason };
  }

  const content = choice.message.content;
  if (!content) {
    return { kind: "incomplete", reason: "empty_message" };
  }

  return { kind: "completed", output: parseOutput(JSON.parse(content)) };
}

export function mapChatCompletionUsage(
  usage: CompletionUsage | undefined,
): ChatCompletionUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}
