import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  analysisOutputJsonSchema,
  type AnalysisOutput,
} from "../analysis/contract";
import { assembleAnalysisRequest } from "../analysis/request";
import {
  determineDigestRunStatus,
  estimateTokens,
  hasArticleContent,
  patchHumanizedAnalysis,
  selectArticleWithinEnvelopeBudget,
  selectDisplayedDiscussionClaim,
} from "./digest-pipeline";

describe("determineDigestRunStatus", () => {
  it("clears a stale story-item ingestion error after the requested stories are usable", () => {
    expect(
      determineDigestRunStatus({
        storyStatuses: ["complete", "discussion_only", "complete"],
        requestedStoryCount: 3,
        runErrorCode: "STORY_ITEM_FAILURES",
      }),
    ).toEqual({ status: "complete", errorCode: null });
  });

  it("keeps a genuine shortfall partial", () => {
    expect(
      determineDigestRunStatus({
        storyStatuses: ["complete"],
        requestedStoryCount: 2,
        runErrorCode: "TOP_STORIES_SHORTFALL",
      }),
    ).toEqual({ status: "partial", errorCode: "TOP_STORIES_SHORTFALL" });
  });
});

describe("article discussion-only fallback", () => {
  it("requires actual extracted text rather than only a document row", () => {
    expect(hasArticleContent({ text: "Source-grounded article text" })).toBe(
      true,
    );
    expect(hasArticleContent({ text: null })).toBe(false);
    expect(hasArticleContent(undefined)).toBe(false);
  });
});

function analysis(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    promptVersion: ANALYSIS_PROMPT_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    article: {
      thesis: {
        claim: "The original article claim.",
        citations: [{ locator: "Intro", sourceUrl: "https://example.com" }],
      },
      keyPoints: [],
      evidence: [],
      limitations: [],
      confidence: "high",
      sourceQualityNotes: [],
    },
    discussion: {
      consensus: [
        { claim: "The original consensus claim.", supportingCommentIds: [1] },
      ],
      competingViewpoints: [
        { claim: "A competing viewpoint.", supportingCommentIds: [2] },
      ],
      insightfulComments: [],
      unresolvedQuestions: [],
      confidence: "medium",
      sourceQualityNotes: [],
    },
    combinedTakeaway: {
      summary: "The original takeaway summary.",
      tensions: [],
      confidence: "high",
    },
    ...overrides,
  };
}

describe("selectDisplayedDiscussionClaim", () => {
  it("prefers the first consensus claim over competing viewpoints", () => {
    expect(selectDisplayedDiscussionClaim(analysis())).toMatchObject({
      claim: "The original consensus claim.",
    });
  });

  it("falls back to the first competing viewpoint when consensus is empty", () => {
    expect(
      selectDisplayedDiscussionClaim(
        analysis({
          discussion: { ...analysis().discussion, consensus: [] },
        }),
      ),
    ).toMatchObject({ claim: "A competing viewpoint." });
  });

  it("returns null when neither list has a claim", () => {
    expect(
      selectDisplayedDiscussionClaim(
        analysis({
          discussion: {
            ...analysis().discussion,
            consensus: [],
            competingViewpoints: [],
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("patchHumanizedAnalysis", () => {
  it("rewrites only the three displayed prose fields, leaving citations and IDs untouched", () => {
    const original = analysis();
    const patched = patchHumanizedAnalysis(original, {
      storyId: "story-1",
      article: "Rewritten article claim.",
      discussion: "Rewritten discussion claim.",
      takeaway: "Rewritten takeaway.",
    });

    expect(patched.article.thesis?.claim).toBe("Rewritten article claim.");
    expect(patched.discussion.consensus[0]?.claim).toBe(
      "Rewritten discussion claim.",
    );
    expect(patched.combinedTakeaway.summary).toBe("Rewritten takeaway.");

    // Everything else is byte-identical to the original, including
    // citations and comment IDs.
    expect(patched.article.thesis?.citations).toEqual(
      original.article.thesis?.citations,
    );
    expect(patched.discussion.consensus[0]?.supportingCommentIds).toEqual(
      original.discussion.consensus[0]?.supportingCommentIds,
    );
    expect(patched.discussion.competingViewpoints).toEqual(
      original.discussion.competingViewpoints,
    );
    expect(patched.article.confidence).toBe(original.article.confidence);

    // The original object is not mutated.
    expect(original.article.thesis?.claim).toBe("The original article claim.");
    expect(original.discussion.consensus[0]?.claim).toBe(
      "The original consensus claim.",
    );
    expect(original.combinedTakeaway.summary).toBe(
      "The original takeaway summary.",
    );
  });

  it("leaves a null article thesis null when the humanizer also returns null", () => {
    const original = analysis({
      article: { ...analysis().article, thesis: null },
    });
    const patched = patchHumanizedAnalysis(original, {
      storyId: "story-1",
      article: null,
      discussion: "Rewritten discussion claim.",
      takeaway: "Rewritten takeaway.",
    });

    expect(patched.article.thesis).toBeNull();
  });

  it("ignores a humanized discussion claim when there is nothing to patch", () => {
    const original = analysis({
      discussion: {
        ...analysis().discussion,
        consensus: [],
        competingViewpoints: [],
      },
    });
    const patched = patchHumanizedAnalysis(original, {
      storyId: "story-1",
      article: "Rewritten article claim.",
      discussion: "This has nowhere to go.",
      takeaway: "Rewritten takeaway.",
    });

    expect(patched.discussion.consensus).toEqual([]);
    expect(patched.discussion.competingViewpoints).toEqual([]);
  });
});

describe("selectArticleWithinEnvelopeBudget", () => {
  it("keeps code- and quote-heavy articles within the JSON-serialized article token limit", () => {
    const codeBlock =
      'const query = "SELECT * FROM \\"items\\" WHERE text LIKE \'%\\\\n%\'";\n'.repeat(
        40,
      );
    const EscapeHeavyArticle = Array.from(
      { length: 25 },
      (_, idx) => `## Section ${idx + 1}\n\n${codeBlock}`,
    ).join("\n\n");

    const selected = selectArticleWithinEnvelopeBudget({
      text: EscapeHeavyArticle,
      storyHnItemId: 42_000_001,
      title: "Escaping stress test with quotes and newlines",
      url: "https://example.com/escaping-stress-test",
      articleTokenLimit: 12_000,
    });

    const assembled = assembleAnalysisRequest({
      instructions: ANALYSIS_PROMPT,
      outputSchema: analysisOutputJsonSchema,
      source: {
        storyHnItemId: 42_000_001,
        title: "Escaping stress test with quotes and newlines",
        url: "https://example.com/escaping-stress-test",
        articleText: selected.text,
        articleTruncated: selected.metadata.truncated,
        comments: [],
      },
      tokenLimits: {
        instructions: 6_000,
        article: 12_000,
        comments: 14_000,
        output: 4_000,
      },
      pricing: {
        inputUsdPerMillionTokens: 0.14,
        outputUsdPerMillionTokens: 0.28,
        maximumRequestCostUsd: 0.1,
      },
      countTokens: estimateTokens,
    });

    expect(assembled.tokens.article).toBeLessThanOrEqual(12_000);
    expect(selected.metadata.truncated).toBe(true);
  });
});
