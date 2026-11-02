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

export function prunePartialInvalidCitations(
  output: AnalysisOutput,
  allowed: ReadonlySet<number>,
): AnalysisOutput {
  const pruneClaims = (claims: AnalysisOutput["discussion"]["consensus"]) =>
    claims.map((claim) => {
      const validIds = claim.supportingCommentIds.filter((id) =>
        allowed.has(id),
      );
      if (
        validIds.length === 0 ||
        validIds.length === claim.supportingCommentIds.length
      ) {
        return claim;
      }
      return {
        ...claim,
        supportingCommentIds: validIds,
      };
    });

  return {
    ...output,
    discussion: {
      ...output.discussion,
      consensus: pruneClaims(output.discussion.consensus),
      competingViewpoints: pruneClaims(output.discussion.competingViewpoints),
      unresolvedQuestions: pruneClaims(output.discussion.unresolvedQuestions),
    },
  };
}

export function instructionsForCitationAttempt(
  instructions: string,
  attempt: number,
  allowedCommentIds?: readonly number[],
): string {
  if (attempt <= 1) return instructions;
  const allowedClause =
    allowedCommentIds === undefined
      ? ""
      : allowedCommentIds.length === 0
        ? " No comment IDs were selected; leave consensus, competingViewpoints, insightfulComments, and unresolvedQuestions empty."
        : ` Allowed comment IDs: [${allowedCommentIds.join(", ")}].`;
  return `${instructions}

CORRECTION ATTEMPT: The previous response was rejected because it cited a Hacker News comment ID outside the supplied comment context, ended a prose field at an incomplete punctuation boundary, or drifted out of English. Return a fresh complete response in English where every prose field ends with complete sentence punctuation (. ! or ?) and never a trailing comma, semicolon, or colon. Every supportingCommentIds entry and insightfulComments commentId must exactly match an HN comment ID present in the supplied input.${allowedClause} Do not invent, infer, or transform comment IDs, and never cite storyHnItemId or parentHnItemId unless it is in the allowed list.`;
}
