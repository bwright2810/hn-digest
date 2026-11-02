import { describe, expect, it } from "vitest";

const baseOutput = {
  promptVersion: "analysis-prompt-v2-unslop-full",
  schemaVersion: "analysis-schema-v1",
  article: {
    thesis: null,
    keyPoints: [],
    evidence: [],
    limitations: [],
    confidence: "low",
    sourceQualityNotes: [],
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
    summary: "A grounded takeaway.",
    tensions: [],
    confidence: "low",
  },
} as import("./contract").AnalysisOutput;

describe("analysis output language", () => {
  it("accepts English prose", () => {
    expect(analysisOutputHasAcceptableLanguage(baseOutput)).toBe(true);
  });

  it("rejects substantial accidental CJK prose", () => {
    expect(
      analysisOutputHasAcceptableLanguage({
        ...baseOutput,
        combinedTakeaway: {
          ...baseOutput.combinedTakeaway,
          summary: "这是一个中文摘要。".repeat(20),
        },
      }),
    ).toBe(false);
  });
});

import {
  ANALYSIS_PROMPT,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  analysisOutputHasCompleteProse,
  analysisOutputHasAcceptableLanguage,
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
    expect(ANALYSIS_PROMPT).toContain(
      "Third paragraph: a concrete detail, specific technical trade-off, or standout commenter observation",
    );
    expect(ANALYSIS_PROMPT).toContain(
      "Never make the third paragraph a wrap-up synthesis",
    );
    expect(ANALYSIS_PROMPT).toContain("Full unslop editorial pass");
    expect(ANALYSIS_PROMPT).toContain(
      "Factual accuracy and source grounding override style",
    );
    expect(ANALYSIS_PROMPT).toContain(ANALYSIS_PROMPT_VERSION);
    expect(ANALYSIS_PROMPT).toContain(ANALYSIS_SCHEMA_VERSION);
  });

  it("rejects prose that ends at a dangling punctuation boundary", () => {
    const output = validOutput();
    expect(analysisOutputHasCompleteProse(output)).toBe(true);
    expect(
      analysisOutputHasCompleteProse({
        ...output,
        combinedTakeaway: { ...output.combinedTakeaway, summary: "It ends," },
      }),
    ).toBe(false);
  });

  it("normalizes overlong prose, excess array items, empty citation claims, and trailing semicolons in parseAnalysisOutput", () => {
    const candidate = validOutput();
    candidate.article.thesis!.claim = "The article argues for determinism;";
    candidate.article.keyPoints = [
      {
        claim: `${"First sentence is complete. ".repeat(20)}Trailing sentence exceeds six hundred chars ${"word ".repeat(30)}`,
        citations: [
          { locator: "A".repeat(200), sourceUrl: "https://example.com" },
          { locator: "B", sourceUrl: null },
          { locator: "C", sourceUrl: null },
          { locator: "D", sourceUrl: null },
        ],
      },
      {
        claim: "Uncited point that should be filtered out.",
        citations: [],
      },
    ];
    candidate.discussion.consensus = [
      {
        claim: "Grounded consensus point;",
        supportingCommentIds: [101, 101, 102, 103, 104, 105, 106, 107],
      },
      {
        claim: "Ungrounded consensus point with empty array.",
        supportingCommentIds: [],
      },
    ];
    candidate.combinedTakeaway.summary = `${"A complete paragraph sentence. ".repeat(28)}Extra tail ${"word ".repeat(20)}`;
    candidate.combinedTakeaway.tensions = [
      "T1.",
      "T2.",
      "T3.",
      "T4.",
      "T5 overflow.",
    ];

    const parsed = parseAnalysisOutput(candidate);
    expect(parsed.article.thesis?.claim).toBe(
      "The article argues for determinism.",
    );
    expect(parsed.article.keyPoints).toHaveLength(1);
    expect(parsed.article.keyPoints[0]!.claim.length).toBeLessThanOrEqual(600);
    expect(parsed.article.keyPoints[0]!.citations).toHaveLength(3);
    expect(
      parsed.article.keyPoints[0]!.citations[0]!.locator.length,
    ).toBeLessThanOrEqual(160);
    expect(parsed.discussion.consensus).toHaveLength(1);
    expect(parsed.discussion.consensus[0]!.claim).toBe(
      "Grounded consensus point.",
    );
    expect(parsed.discussion.consensus[0]!.supportingCommentIds).toEqual([
      101, 102, 103, 104, 105, 106,
    ]);
    expect(parsed.combinedTakeaway.summary.length).toBeLessThanOrEqual(900);
    expect(parsed.combinedTakeaway.tensions).toHaveLength(4);
    expect(analysisOutputHasCompleteProse(parsed)).toBe(true);

    const nearLimitCutOff = validOutput();
    nearLimitCutOff.combinedTakeaway.summary = `${"A complete paragraph sentence. ".repeat(25)}The supplied evidence supports concern about recurring risk; it is`;
    const parsedNearLimit = parseAnalysisOutput(nearLimitCutOff);
    expect(parsedNearLimit.combinedTakeaway.summary).toMatch(/\.$/u);
    expect(parsedNearLimit.combinedTakeaway.summary).not.toContain("; it is");
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
