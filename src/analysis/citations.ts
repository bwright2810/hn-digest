export const MAX_CITATION_ATTEMPTS = 2;

export class InvalidCommentCitationError extends Error {
  constructor() {
    super("Analysis cited an unselected comment");
    this.name = "InvalidCommentCitationError";
  }
}

export function instructionsForCitationAttempt(
  instructions: string,
  attempt: number,
): string {
  if (attempt <= 1) return instructions;
  return `${instructions}

CORRECTION ATTEMPT: The previous response was rejected because it cited a Hacker News comment ID outside the supplied comment context. Return a fresh complete response. Every supportingCommentIds entry and insightfulComments commentId must exactly match an HN comment ID present in the supplied input. Do not invent, infer, or transform comment IDs.`;
}
