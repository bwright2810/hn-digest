import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisOutput,
} from "../analysis/contract";
import { parseStoredAnalysis } from "./reader";

const output: AnalysisOutput = {
  promptVersion: ANALYSIS_PROMPT_VERSION,
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  article: {
    thesis: {
      claim: "A useful thesis",
      citations: [
        { locator: "Introduction", sourceUrl: "https://example.com" },
      ],
    },
    keyPoints: [],
    evidence: [],
    limitations: [],
    confidence: "high",
    sourceQualityNotes: [],
  },
  discussion: {
    consensus: [],
    competingViewpoints: [],
    insightfulComments: [],
    unresolvedQuestions: [],
    confidence: "medium",
    sourceQualityNotes: [],
  },
  combinedTakeaway: {
    summary: "The combined takeaway.",
    tensions: [],
    confidence: "high",
  },
};

describe("parseStoredAnalysis", () => {
  it("accepts a complete validated result from either stored section", () => {
    expect(parseStoredAnalysis(output, undefined)).toEqual(output);
  });

  it("combines independently stored article and discussion sections", () => {
    expect(
      parseStoredAnalysis(
        {
          promptVersion: output.promptVersion,
          schemaVersion: output.schemaVersion,
          article: output.article,
          combinedTakeaway: output.combinedTakeaway,
        },
        { discussion: output.discussion },
      ),
    ).toEqual(output);
  });

  it("rejects malformed stored analysis", () => {
    expect(
      parseStoredAnalysis({ article: { thesis: "invalid" } }, {}),
    ).toBeNull();
  });
});
