import { describe, expect, it } from "vitest";

import {
  ARTICLE_SELECTION_STRATEGY_VERSION,
  selectArticleContext,
} from "./selection";

const countWords = (text: string) => text.match(/\S+/gu)?.length ?? 0;

describe("selectArticleContext", () => {
  it("passes a short article through without transforming it", () => {
    const article = "An opening sentence.\n\nA concise conclusion.";
    const selection = selectArticleContext(article, {
      maximumTokens: 20,
      countTokens: countWords,
    });

    expect(selection.text).toBe(article);
    expect(selection.metadata).toEqual({
      strategyVersion: ARTICLE_SELECTION_STRATEGY_VERSION,
      truncated: false,
      tokenLimit: 20,
      originalEstimatedTokens: 6,
      selectedEstimatedTokens: 6,
      originalBlockCount: 2,
      selectedBlockIndexes: [0, 1],
      partialBlockIndex: null,
      omittedBlockCount: 0,
    });
  });

  it("favors the introduction, conclusion, headings, and spread-out body sections", () => {
    const blocks = [
      "Introduction establishes the central thesis clearly.",
      "Early evidence gives historical context for readers.",
      "## First finding",
      "First detailed result includes measurements and caveats.",
      "Middle evidence considers an alternative interpretation.",
      "## Second finding",
      "Later evidence describes operational consequences in practice.",
      "Conclusion restates the result and its limitations.",
    ];
    const selection = selectArticleContext(blocks.join("\n\n"), {
      maximumTokens: 25,
      countTokens: countWords,
    });

    expect(selection.metadata.selectedBlockIndexes).toEqual([0, 2, 4, 5, 7]);
    expect(selection.text).toContain(blocks[0]);
    expect(selection.text).toContain(blocks[2]);
    expect(selection.text).toContain(blocks[4]);
    expect(selection.text).toContain(blocks[5]);
    expect(selection.text).toContain(blocks[7]);
    expect(selection.metadata).toMatchObject({
      truncated: true,
      tokenLimit: 25,
      originalBlockCount: 8,
      omittedBlockCount: 3,
    });
    expect(countWords(selection.text)).toBeLessThanOrEqual(25);
  });

  it("never exceeds the allowance when no complete block fits", () => {
    const selection = selectArticleContext(
      "one two three four five six seven eight",
      { maximumTokens: 3, countTokens: countWords },
    );

    expect(selection.text).toBe("one two three");
    expect(selection.metadata).toMatchObject({
      truncated: true,
      selectedEstimatedTokens: 3,
      selectedBlockIndexes: [],
      partialBlockIndex: 0,
      omittedBlockCount: 1,
    });
  });

  it("handles missing article content explicitly", () => {
    expect(
      selectArticleContext(null, {
        maximumTokens: 10,
        countTokens: countWords,
      }),
    ).toEqual({
      text: "",
      metadata: {
        strategyVersion: ARTICLE_SELECTION_STRATEGY_VERSION,
        truncated: false,
        tokenLimit: 10,
        originalEstimatedTokens: 0,
        selectedEstimatedTokens: 0,
        originalBlockCount: 0,
        selectedBlockIndexes: [],
        partialBlockIndex: null,
        omittedBlockCount: 0,
      },
    });
  });

  it("rejects invalid limits and token estimates", () => {
    expect(() =>
      selectArticleContext("text", {
        maximumTokens: 0,
        countTokens: countWords,
      }),
    ).toThrow("maximumTokens must be a positive integer");
    expect(() =>
      selectArticleContext("text", {
        maximumTokens: 10,
        countTokens: () => 0.5,
      }),
    ).toThrow("countTokens must return a nonnegative integer");
  });
});
