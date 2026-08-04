import { describe, expect, it } from "vitest";

import {
  assembleHumanizerRequest,
  HUMANIZER_REQUEST_FORMAT_VERSION,
  HumanizerRequestBudgetError,
  type AssembleHumanizerRequestOptions,
} from "./humanizer-request";

const countCharacters = (text: string) => text.length;

function options(
  overrides: Partial<AssembleHumanizerRequestOptions> = {},
): AssembleHumanizerRequestOptions {
  return {
    items: [
      {
        storyId: "story-1",
        article: "The article makes a narrow claim.",
        discussion: "Commenters broadly agree with the claim.",
        takeaway: "The evidence supports a modest conclusion.",
      },
      {
        storyId: "story-2",
        article: null,
        discussion: null,
        takeaway: "The discussion alone supports a cautious takeaway.",
      },
    ],
    pricing: {
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 8,
      maximumRequestCostUsd: 1,
    },
    countTokens: countCharacters,
    maximumOutputTokens: 400,
    ...overrides,
  };
}

describe("assembleHumanizerRequest", () => {
  it("assembles a batched request preserving story order and null fields", () => {
    const request = assembleHumanizerRequest(options());

    expect(request.formatVersion).toBe(HUMANIZER_REQUEST_FORMAT_VERSION);
    expect(request.storyIds).toEqual(["story-1", "story-2"]);
    expect(JSON.parse(request.inputData)).toMatchObject({
      kind: "untrusted_digest_prose_for_style_rewrite",
      stories: [
        { storyId: "story-1", article: expect.any(String) },
        { storyId: "story-2", article: null, discussion: null },
      ],
    });
    expect(request.tokens).toEqual({
      instructions: request.instructions.length,
      input: request.inputData.length,
      totalInput: request.instructions.length + request.inputData.length,
      maximumOutput: 400,
    });
    expect(request.cost.maximumRequestCostUsd).toBe(
      (request.tokens.totalInput * 2 + 400 * 8) / 1_000_000,
    );
  });

  it("rejects an empty batch", () => {
    expect(() => assembleHumanizerRequest(options({ items: [] }))).toThrowError(
      HumanizerRequestBudgetError,
    );
    try {
      assembleHumanizerRequest(options({ items: [] }));
    } catch (error) {
      expect(error).toMatchObject({ category: "empty" });
    }
  });

  it("rejects a request above its hard cost ceiling before submission", () => {
    expect(() =>
      assembleHumanizerRequest(
        options({
          pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 8,
            maximumRequestCostUsd: 0.000001,
          },
        }),
      ),
    ).toThrowError(/Estimated worst-case request cost .* exceeds hard limit/);
  });

  it("validates output tokens, pricing, and token estimates", () => {
    expect(() =>
      assembleHumanizerRequest(options({ maximumOutputTokens: 0 })),
    ).toThrow("maximumOutputTokens must be a positive integer");
    expect(() =>
      assembleHumanizerRequest(
        options({
          pricing: { ...options().pricing, maximumRequestCostUsd: -1 },
        }),
      ),
    ).toThrow("pricing.maximumRequestCostUsd must be a nonnegative number");
    expect(() =>
      assembleHumanizerRequest(options({ countTokens: () => Number.NaN })),
    ).toThrow("countTokens must return a nonnegative integer");
  });
});
