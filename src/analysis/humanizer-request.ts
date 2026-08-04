import {
  HUMANIZER_PROMPT,
  humanizerOutputJsonSchema,
  type HumanizerItem,
} from "./humanizer-contract";

export const HUMANIZER_REQUEST_FORMAT_VERSION = "humanizer-request-v1";

export interface HumanizerPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly maximumRequestCostUsd: number;
}

export interface AssembleHumanizerRequestOptions {
  readonly items: readonly HumanizerItem[];
  readonly pricing: HumanizerPricing;
  readonly countTokens: (text: string) => number;
  readonly maximumOutputTokens: number;
}

export interface HumanizerTokenEstimate {
  readonly instructions: number;
  readonly input: number;
  readonly totalInput: number;
  readonly maximumOutput: number;
}

export interface HumanizerCostEstimate {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly estimatedInputCostUsd: number;
  readonly maximumOutputCostUsd: number;
  readonly maximumRequestCostUsd: number;
  readonly hardLimitUsd: number;
}

export interface AssembledHumanizerRequest {
  readonly formatVersion: typeof HUMANIZER_REQUEST_FORMAT_VERSION;
  readonly instructions: string;
  readonly inputData: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly storyIds: readonly string[];
  readonly tokens: HumanizerTokenEstimate;
  readonly cost: HumanizerCostEstimate;
}

export class HumanizerRequestBudgetError extends Error {
  constructor(
    readonly category: "empty" | "cost",
    message: string,
  ) {
    super(message);
    this.name = "HumanizerRequestBudgetError";
  }
}

export function assembleHumanizerRequest(
  options: AssembleHumanizerRequestOptions,
): AssembledHumanizerRequest {
  validateOptions(options);

  const instructions = HUMANIZER_PROMPT;
  const instructionTokens = count(options.countTokens, instructions);

  const inputData = stableJson({
    kind: "untrusted_digest_prose_for_style_rewrite",
    stories: options.items,
  });
  const inputTokens = count(options.countTokens, inputData);

  const totalInput = instructionTokens + inputTokens;
  const estimatedInputCostUsd =
    (totalInput * options.pricing.inputUsdPerMillionTokens) / 1_000_000;
  const maximumOutputCostUsd =
    (options.maximumOutputTokens * options.pricing.outputUsdPerMillionTokens) /
    1_000_000;
  const maximumRequestCostUsd = estimatedInputCostUsd + maximumOutputCostUsd;

  if (maximumRequestCostUsd > options.pricing.maximumRequestCostUsd) {
    throw new HumanizerRequestBudgetError(
      "cost",
      `Estimated worst-case request cost ${formatUsd(maximumRequestCostUsd)} exceeds hard limit ${formatUsd(options.pricing.maximumRequestCostUsd)}`,
    );
  }

  return {
    formatVersion: HUMANIZER_REQUEST_FORMAT_VERSION,
    instructions,
    inputData,
    outputSchema: humanizerOutputJsonSchema,
    storyIds: options.items.map((item) => item.storyId),
    tokens: {
      instructions: instructionTokens,
      input: inputTokens,
      totalInput,
      maximumOutput: options.maximumOutputTokens,
    },
    cost: {
      inputUsdPerMillionTokens: options.pricing.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: options.pricing.outputUsdPerMillionTokens,
      estimatedInputCostUsd,
      maximumOutputCostUsd,
      maximumRequestCostUsd,
      hardLimitUsd: options.pricing.maximumRequestCostUsd,
    },
  };
}

function validateOptions(options: AssembleHumanizerRequestOptions): void {
  if (options.items.length === 0) {
    throw new HumanizerRequestBudgetError("empty", "items must not be empty");
  }
  requirePositiveInteger(options.maximumOutputTokens, "maximumOutputTokens");
  for (const [name, value] of Object.entries(options.pricing)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`pricing.${name} must be a nonnegative number`);
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function count(countTokens: (text: string) => number, text: string): number {
  const tokenCount = countTokens(text);
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new RangeError("countTokens must return a nonnegative integer");
  }
  return tokenCount;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}
