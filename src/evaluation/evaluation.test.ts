import { describe, expect, it } from "vitest";

import {
  compareEvaluations,
  EVALUATION_RUBRIC_VERSION,
  EVALUATION_SET_VERSION,
  evaluationCases,
  evaluationRubric,
  RUBRIC_DIMENSIONS,
  summarizeEvaluation,
} from "./evaluation";

function result(candidate: string, score: number) {
  return {
    evaluationSetVersion: EVALUATION_SET_VERSION,
    rubricVersion: EVALUATION_RUBRIC_VERSION,
    candidate,
    cases: evaluationCases.map(({ id }) => ({
      caseId: id,
      scores: Object.fromEntries(
        RUBRIC_DIMENSIONS.map((dimension) => [dimension, score]),
      ),
      notes: "Reviewed against the fixture expectations.",
    })),
  };
}

describe("HD-070 evaluation set", () => {
  it("contains 30 fixed synthetic cases across every required category", () => {
    expect(evaluationCases).toHaveLength(30);
    expect(new Set(evaluationCases.map(({ id }) => id))).toHaveLength(30);
    expect(new Set(evaluationCases.map(({ category }) => category))).toEqual(
      new Set([
        "technical",
        "opinion",
        "text-post",
        "inaccessible",
        "long-discussion",
        "weak-discussion",
        "controversial",
      ]),
    );
    expect(
      evaluationCases.every(
        ({ provenance }) =>
          provenance.kind === "synthetic" && provenance.license === "CC0-1.0",
      ),
    ).toBe(true);
  });

  it("defines a normalized, weighted six-dimension rubric", () => {
    const weight = RUBRIC_DIMENSIONS.reduce(
      (sum, dimension) => sum + evaluationRubric[dimension].weight,
      0,
    );
    expect(weight).toBeCloseTo(1);
    expect(RUBRIC_DIMENSIONS).toEqual([
      "faithfulness",
      "coverage",
      "discussionSynthesis",
      "citationQuality",
      "concision",
      "usefulness",
    ]);
  });

  it("summarizes and compares candidates deterministically", () => {
    const baseline = summarizeEvaluation(result("prompt-v1", 3));
    const candidate = summarizeEvaluation(result("prompt-v2", 4));

    expect(baseline).toMatchObject({ caseCount: 30, score: 3 });
    expect(compareEvaluations(baseline, candidate)).toEqual({
      scoreDelta: 1,
      dimensionDeltas: Object.fromEntries(
        RUBRIC_DIMENSIONS.map((dimension) => [dimension, 1]),
      ),
    });
  });

  it("rejects unknown and duplicate scored cases", () => {
    const unknown = result("unknown", 3);
    unknown.cases[0].caseId = "eval-99";
    expect(() => summarizeEvaluation(unknown)).toThrow(
      "Unknown evaluation case ID: eval-99",
    );

    const duplicate = result("duplicate", 3);
    duplicate.cases[1].caseId = duplicate.cases[0].caseId;
    expect(() => summarizeEvaluation(duplicate)).toThrow(
      "Duplicate scored case ID",
    );
  });

  it("only compares summaries produced from the same cases", () => {
    const baseline = summarizeEvaluation(result("baseline", 3));
    const candidate = summarizeEvaluation({
      ...result("candidate", 4),
      cases: result("candidate", 4).cases.slice(1),
    });

    expect(() => compareEvaluations(baseline, candidate)).toThrow(
      "Evaluation comparisons require the same case IDs",
    );
  });
});
