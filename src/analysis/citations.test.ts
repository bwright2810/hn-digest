import { describe, expect, it } from "vitest";

import {
  degradeInvalidCommentCitations,
  instructionsForCitationAttempt,
} from "./citations";
import { ANALYSIS_PROMPT_VERSION, type AnalysisOutput } from "./contract";

describe("instructionsForCitationAttempt", () => {
  it("adds a correction only after the first citation attempt", () => {
    expect(instructionsForCitationAttempt("base", 1)).toBe("base");
    expect(instructionsForCitationAttempt("base", 2)).toContain(
      "CORRECTION ATTEMPT",
    );
    expect(instructionsForCitationAttempt("base", 2)).toContain(
      "must exactly match",
    );
  });
});

describe("degradeInvalidCommentCitations", () => {
  const output: AnalysisOutput = {
    promptVersion: ANALYSIS_PROMPT_VERSION,
    schemaVersion: "analysis-schema-v1",
    article: {
      thesis: {
        claim: "The article argues for bounded recovery.",
        citations: [{ locator: "Introduction", sourceUrl: null }],
      },
      keyPoints: [],
      evidence: [],
      limitations: [],
      confidence: "high",
      sourceQualityNotes: [],
    },
    discussion: {
      consensus: [
        { claim: "Partly grounded", supportingCommentIds: [101, 999] },
        { claim: "Ungrounded", supportingCommentIds: [998] },
      ],
      competingViewpoints: [],
      insightfulComments: [
        { commentId: 102, insight: "Valid", whyNotable: "Grounded" },
        { commentId: 997, insight: "Invalid", whyNotable: "Ungrounded" },
      ],
      unresolvedQuestions: [],
      confidence: "high",
      sourceQualityNotes: [],
    },
    combinedTakeaway: {
      summary: "Original synthesis",
      tensions: ["Original tension"],
      confidence: "high",
    },
  };

  it("removes ungrounded discussion evidence while preserving article analysis", () => {
    const degraded = degradeInvalidCommentCitations(
      output,
      new Set([101, 102]),
    );

    expect(degraded.invalidCommentIds).toEqual([997, 998, 999]);
    expect(degraded.output.article).toBe(output.article);
    expect(degraded.output.discussion.consensus).toEqual([
      { claim: "Partly grounded", supportingCommentIds: [101] },
    ]);
    expect(degraded.output.discussion.insightfulComments).toEqual([
      { commentId: 102, insight: "Valid", whyNotable: "Grounded" },
    ]);
    expect(degraded.output.discussion).toMatchObject({ confidence: "low" });
    expect(degraded.output.combinedTakeaway).toMatchObject({
      confidence: "low",
      tensions: [],
      summary: expect.stringContaining("Discussion synthesis is limited"),
    });
  });

  it("returns the original output when every citation is valid", () => {
    const valid = degradeInvalidCommentCitations(
      { ...output, discussion: { ...output.discussion, consensus: [] } },
      new Set([102, 997]),
    );
    expect(valid.invalidCommentIds).toEqual([]);
    expect(valid.output.discussion.insightfulComments).toHaveLength(2);
  });
});
