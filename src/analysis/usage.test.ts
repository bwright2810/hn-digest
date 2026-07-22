import { describe, expect, it } from "vitest";

import { calculateActualCostUsd } from "./usage";

const prices = {
  version: "2026-07-22-example",
  currency: "USD" as const,
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 8,
  cachedReadUsdPerMillionTokens: 0.5,
  cacheWriteUsdPerMillionTokens: 2.5,
};

describe("calculateActualCostUsd", () => {
  it("prices uncached input, cached reads, cache writes, and output separately", () => {
    expect(
      calculateActualCostUsd(
        {
          inputTokens: 1_000,
          outputTokens: 500,
          cachedReadTokens: 400,
          cacheWriteTokens: 100,
          reasoningTokens: 200,
        },
        prices,
      ),
    ).toBe(0.00545);
  });

  it("rejects invalid usage and price assumptions", () => {
    expect(() =>
      calculateActualCostUsd(
        {
          inputTokens: 10,
          outputTokens: 0,
          cachedReadTokens: 11,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        prices,
      ),
    ).toThrow("cachedReadTokens plus cacheWriteTokens");
    expect(() =>
      calculateActualCostUsd(
        {
          inputTokens: 10,
          outputTokens: 0,
          cachedReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        { ...prices, outputUsdPerMillionTokens: -1 },
      ),
    ).toThrow("prices.outputUsdPerMillionTokens");
  });
});
