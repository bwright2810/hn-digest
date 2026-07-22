export interface RankableComment {
  readonly hnItemId: number;
  readonly parentHnItemId: number;
  readonly author: string | null;
  readonly text: string | null;
  readonly isDeleted: boolean;
  readonly isDead: boolean;
}

export interface CommentScoreSignals {
  readonly depth: number;
  readonly directReplyCount: number;
  readonly descendantCount: number;
  readonly branchCommentCount: number;
  readonly characterCount: number;
  readonly quotedCharacterRatio: number;
  readonly duplicateCount: number;
  readonly positionScore: number;
  readonly replyScore: number;
  readonly lengthScore: number;
  readonly branchScore: number;
  readonly quotationPenalty: number;
  readonly duplicatePenalty: number;
}

export interface RankedComment extends RankableComment {
  readonly text: string;
  readonly rootHnItemId: number;
  readonly score: number;
  readonly signals: CommentScoreSignals;
}

export interface CommentSelection {
  readonly selected: readonly RankedComment[];
  readonly ranked: readonly RankedComment[];
  readonly candidateCount: number;
  readonly representedBranchIds: readonly number[];
}

export interface CommentSelectionOptions {
  readonly maximumComments: number;
  readonly substantialBranchMinimumCharacters?: number;
  readonly substantialBranchMinimumComments?: number;
}

interface Candidate extends RankableComment {
  readonly text: string;
}

interface TreeFacts {
  readonly depth: number;
  readonly directReplyCount: number;
  readonly descendantCount: number;
  readonly rootHnItemId: number;
}

export function selectComments(
  comments: readonly RankableComment[],
  options: CommentSelectionOptions,
): CommentSelection {
  requirePositiveInteger(options.maximumComments, "maximumComments");
  const minimumCharacters = requireNonnegativeInteger(
    options.substantialBranchMinimumCharacters ?? 160,
    "substantialBranchMinimumCharacters",
  );
  const minimumComments = requirePositiveInteger(
    options.substantialBranchMinimumComments ?? 2,
    "substantialBranchMinimumComments",
  );
  const candidates = comments
    .filter(isCandidate)
    .map((comment) => ({ ...comment, text: comment.text.trim() }))
    .sort((left, right) => left.hnItemId - right.hnItemId);
  const ranked = rankCandidates(candidates);
  const branches = groupBy(ranked, ({ rootHnItemId }) => rootHnItemId);
  const substantialBranches = [...branches.entries()]
    .filter(([, branch]) => {
      const characters = branch.reduce(
        (total, comment) =>
          total +
          Math.round(
            comment.signals.characterCount *
              (1 - comment.signals.quotedCharacterRatio),
          ),
        0,
      );
      return (
        branch.length >= minimumComments || characters >= minimumCharacters
      );
    })
    .map(([rootHnItemId, branch]) => ({ rootHnItemId, best: branch[0]! }))
    .sort(
      (left, right) =>
        compareRanked(left.best, right.best) ||
        left.rootHnItemId - right.rootHnItemId,
    );

  const selected: RankedComment[] = [];
  const selectedIds = new Set<number>();
  for (const branch of substantialBranches) {
    if (selected.length >= options.maximumComments) break;
    selected.push(branch.best);
    selectedIds.add(branch.best.hnItemId);
  }
  for (const comment of ranked) {
    if (selected.length >= options.maximumComments) break;
    if (!selectedIds.has(comment.hnItemId)) {
      selected.push(comment);
      selectedIds.add(comment.hnItemId);
    }
  }

  selected.sort(compareRanked);
  return {
    selected,
    ranked,
    candidateCount: candidates.length,
    representedBranchIds: [
      ...new Set(selected.map(({ rootHnItemId }) => rootHnItemId)),
    ],
  };
}

export function rankComments(
  comments: readonly RankableComment[],
): readonly RankedComment[] {
  const candidates = comments
    .filter(isCandidate)
    .map((comment) => ({ ...comment, text: comment.text.trim() }))
    .sort((left, right) => left.hnItemId - right.hnItemId);
  return rankCandidates(candidates);
}

function rankCandidates(candidates: readonly Candidate[]): RankedComment[] {
  const byId = new Map(
    candidates.map((comment) => [comment.hnItemId, comment]),
  );
  const children = groupBy(candidates, ({ parentHnItemId }) => parentHnItemId);
  const facts = new Map(
    candidates.map((comment) => [
      comment.hnItemId,
      treeFacts(comment, byId, children),
    ]),
  );
  const branchCounts = countBy(
    candidates,
    (comment) => facts.get(comment.hnItemId)!.rootHnItemId,
  );
  const duplicateCounts = countBy(candidates, (comment) =>
    duplicateFingerprint(comment.text),
  );

  return candidates
    .map((comment): RankedComment => {
      const tree = facts.get(comment.hnItemId)!;
      const characterCount = comment.text.length;
      const quotedCharacterRatio = quotationRatio(comment.text);
      const duplicateCount = duplicateCounts.get(
        duplicateFingerprint(comment.text),
      )!;
      const positionScore = Math.max(0, 30 - tree.depth * 6);
      const replyScore =
        Math.min(tree.directReplyCount, 5) * 3 +
        Math.min(tree.descendantCount, 10) * 4;
      const lengthScore = Math.min(30, Math.floor(characterCount / 40));
      const branchCommentCount = branchCounts.get(tree.rootHnItemId)!;
      const branchScore = Math.min(20, branchCommentCount * 2);
      const quotationPenalty = Math.round(quotedCharacterRatio * 30);
      const duplicatePenalty = duplicateCount > 1 ? 35 : 0;
      const score =
        positionScore +
        replyScore +
        lengthScore +
        branchScore -
        quotationPenalty -
        duplicatePenalty;

      return {
        ...comment,
        rootHnItemId: tree.rootHnItemId,
        score,
        signals: {
          ...tree,
          branchCommentCount,
          characterCount,
          quotedCharacterRatio,
          duplicateCount,
          positionScore,
          replyScore,
          lengthScore,
          branchScore,
          quotationPenalty,
          duplicatePenalty,
        },
      };
    })
    .sort(compareRanked);
}

function treeFacts(
  comment: Candidate,
  byId: ReadonlyMap<number, Candidate>,
  children: ReadonlyMap<number, readonly Candidate[]>,
): TreeFacts {
  let rootHnItemId = comment.hnItemId;
  let parentId = comment.parentHnItemId;
  let depth = 0;
  const ancestors = new Set([comment.hnItemId]);
  while (byId.has(parentId) && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    rootHnItemId = parentId;
    parentId = byId.get(parentId)!.parentHnItemId;
    depth += 1;
  }

  const descendants = new Set<number>();
  const pending = [...(children.get(comment.hnItemId) ?? [])];
  while (pending.length > 0) {
    const child = pending.pop()!;
    if (
      descendants.has(child.hnItemId) ||
      child.hnItemId === comment.hnItemId
    ) {
      continue;
    }
    descendants.add(child.hnItemId);
    pending.push(...(children.get(child.hnItemId) ?? []));
  }
  return {
    depth,
    directReplyCount: children.get(comment.hnItemId)?.length ?? 0,
    descendantCount: descendants.size,
    rootHnItemId,
  };
}

function quotationRatio(text: string): number {
  const lines = text.split("\n");
  const quotedCharacters = lines
    .filter((line) => /^\s*>/u.test(line))
    .reduce((total, line) => total + line.trim().length, 0);
  return text.length === 0 ? 0 : quotedCharacters / text.length;
}

function duplicateFingerprint(text: string): string {
  return text.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function isCandidate(comment: RankableComment): comment is Candidate {
  return !comment.isDeleted && !comment.isDead && Boolean(comment.text?.trim());
}

function compareRanked(left: RankedComment, right: RankedComment): number {
  return right.score - left.score || left.hnItemId - right.hnItemId;
}

function groupBy<T, K>(
  values: readonly T[],
  key: (value: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function countBy<T, K>(
  values: readonly T[],
  key: (value: T) => K,
): Map<K, number> {
  const counts = new Map<K, number>();
  for (const value of values) {
    const groupKey = key(value);
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
  }
  return counts;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireNonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
  return value;
}
