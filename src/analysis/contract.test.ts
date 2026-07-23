import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  analysisOutputJsonSchema,
  analysisOutputSchema,
  parseAnalysisOutput,
  type AnalysisOutput,
} from "./contract";

function validOutput(): AnalysisOutput {
  return {
    promptVersion: ANALYSIS_PROMPT_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    article: {
      thesis: {
        claim: "The article argues for deterministic analysis pipelines.",
        citations: [
          {
            locator: "Introduction",
            sourceUrl: "https://example.com/article",
          },
        ],
      },
      keyPoints: [],
      evidence: [],
      limitations: [],
      confidence: "medium",
      sourceQualityNotes: [],
    },
    discussion: {
      consensus: [
        {
          claim: "Commenters broadly favor deterministic preprocessing.",
          supportingCommentIds: [101, 105],
        },
      ],
      competingViewpoints: [],
      insightfulComments: [
        {
          commentId: 105,
          insight: "Evaluation data should drive model routing.",
          whyNotable: "It identifies a measurable decision rule.",
        },
      ],
      unresolvedQuestions: [],
      confidence: "high",
      sourceQualityNotes: [],
    },
    combinedTakeaway: {
      summary:
        "The article and discussion support a bounded, measurable pipeline.",
      tensions: [],
      confidence: "medium",
    },
  };
}

describe("analysis output contract", () => {
  it("accepts a complete versioned analysis", () => {
    expect(parseAnalysisOutput(validOutput())).toEqual(validOutput());
  });

  it("keeps article and discussion evidence in separate structures", () => {
    const output = validOutput();

    expect(output.article.thesis?.citations[0]).toMatchObject({
      locator: "Introduction",
      sourceUrl: "https://example.com/article",
    });
    expect(output.discussion.consensus[0]?.supportingCommentIds).toEqual([
      101, 105,
    ]);
  });

  it("rejects discussion claims without supporting HN comment IDs", () => {
    const output = validOutput();
    output.discussion.consensus[0]!.supportingCommentIds = [];

    expect(analysisOutputSchema.safeParse(output).success).toBe(false);
  });

  it("rejects missing or incorrect result versions", () => {
    expect(
      analysisOutputSchema.safeParse({
        ...validOutput(),
        promptVersion: "analysis-prompt-old",
      }).success,
    ).toBe(false);
    const withoutSchemaVersion = { ...validOutput() } as Record<
      string,
      unknown
    >;
    delete withoutSchemaVersion.schemaVersion;
    expect(analysisOutputSchema.safeParse(withoutSchemaVersion).success).toBe(
      false,
    );
  });

  it("rejects unexpected fields and output over the explicit length limits", () => {
    expect(
      analysisOutputSchema.safeParse({ ...validOutput(), extra: true }).success,
    ).toBe(false);
    expect(
      analysisOutputSchema.safeParse({
        ...validOutput(),
        combinedTakeaway: {
          ...validOutput().combinedTakeaway,
          summary: "x".repeat(901),
        },
      }).success,
    ).toBe(false);
  });

  it("generates a strict Structured Outputs-compatible JSON Schema", () => {
    expect(analysisOutputJsonSchema).not.toHaveProperty("$schema");
    expectEveryObjectToBeStrictAndRequired(analysisOutputJsonSchema);
  });

  it("makes grounding and output expectations explicit in the prompt", () => {
    expect(ANALYSIS_PROMPT).toContain("untrusted evidence");
    expect(ANALYSIS_PROMPT).toContain(
      "Every discussion claim must list one or more supporting Hacker News comment IDs",
    );
    expect(ANALYSIS_PROMPT).toContain("at most 900 characters");
    expect(ANALYSIS_PROMPT).toContain("Full unslop editorial pass");
    expect(ANALYSIS_PROMPT).toContain(
      "Factual accuracy and source grounding override style",
    );
    expect(ANALYSIS_PROMPT).toContain(ANALYSIS_PROMPT_VERSION);
    expect(ANALYSIS_PROMPT).toContain(ANALYSIS_SCHEMA_VERSION);
  });
});

function expectEveryObjectToBeStrictAndRequired(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) expectEveryObjectToBeStrictAndRequired(child);
    return;
  }
  if (value === null || typeof value !== "object") return;

  const schema = value as Record<string, unknown>;
  if (schema.type === "object") {
    expect(schema.additionalProperties).toBe(false);
    const properties = schema.properties as Record<string, unknown>;
    expect(schema.required).toEqual(Object.keys(properties));
  }
  for (const child of Object.values(schema)) {
    expectEveryObjectToBeStrictAndRequired(child);
  }
}
