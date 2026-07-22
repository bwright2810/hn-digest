import { z } from "zod";

import evaluationCasesJson from "./fixtures/cases.json";

export const EVALUATION_SET_VERSION = "evaluation-set-v1";
export const EVALUATION_RUBRIC_VERSION = "evaluation-rubric-v1";

const commentSchema = z
  .object({
    hnItemId: z.number().int().positive(),
    parentHnItemId: z.number().int().positive(),
    text: z.string().min(1).max(1_200),
  })
  .strict();

const expectationSchema = z
  .object({
    mustCover: z.array(z.string().min(1).max(240)).min(1).max(6),
    mustQualify: z.array(z.string().min(1).max(240)).max(4),
    discussionEvidenceIds: z.array(z.number().int().positive()).max(8),
    mustNotClaim: z.array(z.string().min(1).max(240)).max(4),
  })
  .strict();

export const evaluationCaseSchema = z
  .object({
    id: z.string().regex(/^eval-\d{2}$/),
    category: z.enum([
      "technical",
      "opinion",
      "text-post",
      "inaccessible",
      "long-discussion",
      "weak-discussion",
      "controversial",
    ]),
    title: z.string().min(1).max(160),
    articleStatus: z.enum([
      "available",
      "truncated",
      "text-post",
      "inaccessible",
    ]),
    articleText: z.string().max(2_500),
    comments: z.array(commentSchema).max(12),
    expectations: expectationSchema,
    provenance: z
      .object({
        kind: z.literal("synthetic"),
        license: z.literal("CC0-1.0"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const commentIds = new Set(value.comments.map(({ hnItemId }) => hnItemId));
    for (const evidenceId of value.expectations.discussionEvidenceIds) {
      if (!commentIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message: `discussion evidence ID ${evidenceId} is not present in comments`,
          path: ["expectations", "discussionEvidenceIds"],
        });
      }
    }
    if (value.articleStatus === "inaccessible" && value.articleText !== "") {
      context.addIssue({
        code: "custom",
        message: "inaccessible cases must not contain article text",
        path: ["articleText"],
      });
    }
  });

const evaluationSetSchema = z
  .array(evaluationCaseSchema)
  .min(30)
  .max(50)
  .superRefine((cases, context) => {
    const ids = new Set<string>();
    for (const [index, evaluationCase] of cases.entries()) {
      if (ids.has(evaluationCase.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate evaluation case ID ${evaluationCase.id}`,
          path: [index, "id"],
        });
      }
      ids.add(evaluationCase.id);
    }
  });

export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const evaluationCases: readonly EvaluationCase[] = Object.freeze(
  evaluationSetSchema.parse(evaluationCasesJson),
);

export const RUBRIC_DIMENSIONS = [
  "faithfulness",
  "coverage",
  "discussionSynthesis",
  "citationQuality",
  "concision",
  "usefulness",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export interface RubricDefinition {
  readonly label: string;
  readonly weight: number;
  readonly scoreOne: string;
  readonly scoreThree: string;
  readonly scoreFive: string;
}

export const evaluationRubric: Readonly<
  Record<RubricDimension, RubricDefinition>
> = Object.freeze({
  faithfulness: {
    label: "Faithfulness",
    weight: 0.3,
    scoreOne:
      "Invents or materially distorts claims from the supplied sources.",
    scoreThree:
      "Mostly grounded, with minor unsupported implications or blurred attribution.",
    scoreFive:
      "Every material claim is supported and clearly attributed or qualified.",
  },
  coverage: {
    label: "Coverage",
    weight: 0.2,
    scoreOne: "Misses the central thesis or most case-specific expectations.",
    scoreThree:
      "Captures the thesis and several important points but omits a material facet.",
    scoreFive:
      "Covers the thesis, key evidence, limitations, and expected caveats proportionately.",
  },
  discussionSynthesis: {
    label: "Discussion synthesis",
    weight: 0.15,
    scoreOne:
      "Treats popularity as truth or collapses distinct viewpoints into one.",
    scoreThree:
      "Identifies major views but loses some branch diversity or uncertainty.",
    scoreFive:
      "Separates consensus, disagreement, evidence, and unresolved questions without overclaiming.",
  },
  citationQuality: {
    label: "Citation quality",
    weight: 0.15,
    scoreOne:
      "Citations are missing, invented, or do not support their claims.",
    scoreThree:
      "Most claims have relevant evidence, with a few weak or imprecise links.",
    scoreFive:
      "Article locators and HN IDs are precise, complete, and directly supportive.",
  },
  concision: {
    label: "Concision",
    weight: 0.1,
    scoreOne: "Verbose, repetitive, or dominated by low-value details.",
    scoreThree:
      "Readable but contains avoidable repetition or uneven emphasis.",
    scoreFive: "Compact, well prioritized, and free of material repetition.",
  },
  usefulness: {
    label: "Usefulness",
    weight: 0.1,
    scoreOne:
      "Leaves a reader with a misleading or unusably vague understanding.",
    scoreThree:
      "Provides a serviceable overview with limited decision or learning value.",
    scoreFive:
      "Gives a clear mental model of the source, debate, stakes, and uncertainty.",
  },
});

const dimensionScoresSchema = z.object(
  Object.fromEntries(
    RUBRIC_DIMENSIONS.map((dimension) => [
      dimension,
      z.number().int().min(1).max(5),
    ]),
  ) as Record<RubricDimension, z.ZodNumber>,
);

export const evaluationResultSchema = z
  .object({
    evaluationSetVersion: z.literal(EVALUATION_SET_VERSION),
    rubricVersion: z.literal(EVALUATION_RUBRIC_VERSION),
    candidate: z.string().min(1).max(200),
    cases: z
      .array(
        z
          .object({
            caseId: z.string().regex(/^eval-\d{2}$/),
            scores: dimensionScoresSchema,
            notes: z.string().max(1_000),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export interface EvaluationSummary {
  readonly candidate: string;
  readonly caseCount: number;
  readonly caseIds: readonly string[];
  readonly score: number;
  readonly dimensions: Readonly<Record<RubricDimension, number>>;
}

export function summarizeEvaluation(value: unknown): EvaluationSummary {
  const result = evaluationResultSchema.parse(value);
  const knownIds = new Set(evaluationCases.map(({ id }) => id));
  const seenIds = new Set<string>();
  const totals = Object.fromEntries(
    RUBRIC_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as Record<RubricDimension, number>;

  for (const scoredCase of result.cases) {
    if (!knownIds.has(scoredCase.caseId)) {
      throw new Error(`Unknown evaluation case ID: ${scoredCase.caseId}`);
    }
    if (seenIds.has(scoredCase.caseId)) {
      throw new Error(`Duplicate scored case ID: ${scoredCase.caseId}`);
    }
    seenIds.add(scoredCase.caseId);
    for (const dimension of RUBRIC_DIMENSIONS) {
      totals[dimension] += scoredCase.scores[dimension];
    }
  }

  const dimensions = Object.fromEntries(
    RUBRIC_DIMENSIONS.map((dimension) => [
      dimension,
      round(totals[dimension] / result.cases.length),
    ]),
  ) as Record<RubricDimension, number>;
  const score = RUBRIC_DIMENSIONS.reduce(
    (total, dimension) =>
      total + dimensions[dimension] * evaluationRubric[dimension].weight,
    0,
  );

  return {
    candidate: result.candidate,
    caseCount: result.cases.length,
    caseIds: [...seenIds].sort(),
    score: round(score),
    dimensions,
  };
}

export function compareEvaluations(
  baseline: EvaluationSummary,
  candidate: EvaluationSummary,
): {
  readonly scoreDelta: number;
  readonly dimensionDeltas: Readonly<Record<RubricDimension, number>>;
} {
  if (
    baseline.caseCount !== candidate.caseCount ||
    baseline.caseIds.join("\n") !== candidate.caseIds.join("\n")
  ) {
    throw new Error("Evaluation comparisons require the same case IDs");
  }
  return {
    scoreDelta: round(candidate.score - baseline.score),
    dimensionDeltas: Object.fromEntries(
      RUBRIC_DIMENSIONS.map((dimension) => [
        dimension,
        round(candidate.dimensions[dimension] - baseline.dimensions[dimension]),
      ]),
    ) as Record<RubricDimension, number>,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
