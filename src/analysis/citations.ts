import type { AnalysisOutput } from "./contract";

export const MAX_CITATION_ATTEMPTS = 2;

export class InvalidCommentCitationError extends Error {
  constructor() {
    super("Analysis cited an unselected comment");
    this.name = "InvalidCommentCitationError";
  }
}

export function degradeInvalidCommentCitations(
  output: AnalysisOutput,
  allowed: ReadonlySet<number>,
): { readonly output: AnalysisOutput; readonly invalidCommentIds: number[] } {
  const invalidCommentIds = citedCommentIds(output).filter(
    (id) => !allowed.has(id),
  );
  if (invalidCommentIds.length === 0) return { output, invalidCommentIds: [] };

  const groundedClaims = (claims: AnalysisOutput["discussion"]["consensus"]) =>
    claims
      .map((claim) => ({
        ...claim,
        supportingCommentIds: claim.supportingCommentIds.filter((id) =>
          allowed.has(id),
        ),
      }))
      .filter((claim) => claim.supportingCommentIds.length > 0);
  const limitation =
    "Some discussion material was omitted because the model returned comment IDs outside the selected evidence.";
  const notes = [...output.discussion.sourceQualityNotes, limitation].slice(-4);
  const articleSummary = output.article.thesis?.claim;

  return {
    invalidCommentIds: [...new Set(invalidCommentIds)].sort((a, b) => a - b),
    output: {
      ...output,
      discussion: {
        ...output.discussion,
        consensus: groundedClaims(output.discussion.consensus),
        competingViewpoints: groundedClaims(
          output.discussion.competingViewpoints,
        ),
        unresolvedQuestions: groundedClaims(
          output.discussion.unresolvedQuestions,
        ),
        insightfulComments: output.discussion.insightfulComments.filter(
          ({ commentId }) => allowed.has(commentId),
        ),
        confidence: "low",
        sourceQualityNotes: notes,
      },
      combinedTakeaway: {
        summary: articleSummary
          ? `${articleSummary} Discussion synthesis is limited because invalid comment citations were omitted.`.slice(
              0,
              900,
            )
          : "Discussion synthesis is limited because invalid comment citations were omitted.",
        tensions: [],
        confidence: "low",
      },
    },
  };
}

function citedCommentIds(output: AnalysisOutput): number[] {
  return [
    ...output.discussion.consensus.flatMap(
      ({ supportingCommentIds }) => supportingCommentIds,
    ),
    ...output.discussion.competingViewpoints.flatMap(
      ({ supportingCommentIds }) => supportingCommentIds,
    ),
    ...output.discussion.unresolvedQuestions.flatMap(
      ({ supportingCommentIds }) => supportingCommentIds,
    ),
    ...output.discussion.insightfulComments.map(({ commentId }) => commentId),
  ];
}

export function instructionsForCitationAttempt(
  instructions: string,
  attempt: number,
): string {
  if (attempt <= 1) return instructions;
  return `${instructions}

CORRECTION ATTEMPT: The previous response was rejected because it cited a Hacker News comment ID outside the supplied comment context. Return a fresh complete response. Every supportingCommentIds entry and insightfulComments commentId must exactly match an HN comment ID present in the supplied input. Do not invent, infer, or transform comment IDs.`;
}
