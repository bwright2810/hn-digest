export const ARTICLE_SELECTION_STRATEGY_VERSION = "article-selection-v1";

export interface ArticleSelectionMetadata {
  readonly strategyVersion: typeof ARTICLE_SELECTION_STRATEGY_VERSION;
  readonly truncated: boolean;
  readonly tokenLimit: number;
  readonly originalEstimatedTokens: number;
  readonly selectedEstimatedTokens: number;
  readonly originalBlockCount: number;
  readonly selectedBlockIndexes: readonly number[];
  readonly partialBlockIndex: number | null;
  readonly omittedBlockCount: number;
}

export interface ArticleContextSelection {
  readonly text: string;
  readonly metadata: ArticleSelectionMetadata;
}

export interface ArticleSelectionOptions {
  readonly maximumTokens: number;
  readonly countTokens: (text: string) => number;
}

export function selectArticleContext(
  text: string | null,
  options: ArticleSelectionOptions,
): ArticleContextSelection {
  requirePositiveInteger(options.maximumTokens, "maximumTokens");
  const source = text ?? "";
  const originalEstimatedTokens = count(options.countTokens, source);
  const blocks = splitBlocks(source);

  if (originalEstimatedTokens <= options.maximumTokens) {
    return result(
      source,
      options.maximumTokens,
      originalEstimatedTokens,
      blocks,
      blocks.map((_, index) => index),
      options.countTokens,
    );
  }

  const selectedIndexes: number[] = [];
  for (const index of priorityOrder(blocks)) {
    const proposedIndexes = [...selectedIndexes, index].sort((a, b) => a - b);
    const proposed = joinBlocks(blocks, proposedIndexes);
    if (count(options.countTokens, proposed) <= options.maximumTokens) {
      selectedIndexes.push(index);
    }
  }

  selectedIndexes.sort((a, b) => a - b);
  let selectedText = joinBlocks(blocks, selectedIndexes);
  let partialBlockIndex: number | null = null;
  if (!selectedText && source) {
    selectedText = longestPrefixWithinBudget(
      source,
      options.maximumTokens,
      options.countTokens,
    );
    partialBlockIndex = 0;
  }

  const selectedEstimatedTokens = count(options.countTokens, selectedText);
  if (selectedEstimatedTokens > options.maximumTokens) {
    throw new Error("Article selection exceeded its token limit");
  }

  return {
    text: selectedText,
    metadata: {
      strategyVersion: ARTICLE_SELECTION_STRATEGY_VERSION,
      truncated: selectedText !== source,
      tokenLimit: options.maximumTokens,
      originalEstimatedTokens,
      selectedEstimatedTokens,
      originalBlockCount: blocks.length,
      selectedBlockIndexes: selectedIndexes,
      partialBlockIndex,
      omittedBlockCount: blocks.length - selectedIndexes.length,
    },
  };
}

function result(
  text: string,
  tokenLimit: number,
  originalEstimatedTokens: number,
  blocks: readonly string[],
  selectedBlockIndexes: readonly number[],
  countTokens: (text: string) => number,
): ArticleContextSelection {
  return {
    text,
    metadata: {
      strategyVersion: ARTICLE_SELECTION_STRATEGY_VERSION,
      truncated: false,
      tokenLimit,
      originalEstimatedTokens,
      selectedEstimatedTokens: count(countTokens, text),
      originalBlockCount: blocks.length,
      selectedBlockIndexes,
      partialBlockIndex: null,
      omittedBlockCount: 0,
    },
  };
}

function priorityOrder(blocks: readonly string[]): number[] {
  if (blocks.length === 0) return [];
  const priority: number[] = [0];
  if (blocks.length > 1) priority.push(blocks.length - 1);
  for (let index = 1; index < blocks.length - 1; index += 1) {
    if (isHeading(blocks[index]!)) priority.push(index);
  }

  const remaining = new Set(
    blocks
      .map((_, index) => index)
      .filter((index) => !priority.includes(index)),
  );
  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (const index of remaining) {
      const distance = Math.min(
        ...priority.map((selected) => Math.abs(index - selected)),
      );
      if (
        distance > bestDistance ||
        (distance === bestDistance && index < bestIndex)
      ) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    priority.push(bestIndex);
    remaining.delete(bestIndex);
  }
  return priority;
}

function splitBlocks(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter(Boolean);
}

function joinBlocks(
  blocks: readonly string[],
  indexes: readonly number[],
): string {
  return indexes.map((index) => blocks[index]!).join("\n\n");
}

function isHeading(block: string): boolean {
  return /^#{1,6}\s+\S/u.test(block);
}

function longestPrefixWithinBudget(
  text: string,
  maximumTokens: number,
  countTokens: (text: string) => number,
): string {
  const characters = [...text];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = characters.slice(0, middle).join("").trimEnd();
    if (count(countTokens, candidate) <= maximumTokens) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join("").trimEnd();
}

function count(countTokens: (text: string) => number, text: string): number {
  const tokenCount = countTokens(text);
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new RangeError("countTokens must return a nonnegative integer");
  }
  return tokenCount;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
