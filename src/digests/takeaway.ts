const sentenceSegmenter = new Intl.Segmenter("en", {
  granularity: "sentence",
});

export function takeawayParagraphs(summary: string): readonly string[] {
  const trimmed = summary.trim();
  if (!trimmed) return [""];

  const doubleNewlineParagraphs = trimmed
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const explicitParagraphs =
    doubleNewlineParagraphs.length > 1
      ? doubleNewlineParagraphs
      : trimmed
          .split(/\n+/gu)
          .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
          .filter(Boolean);

  if (explicitParagraphs.length >= 3) {
    return explicitParagraphs;
  }

  if (explicitParagraphs.length === 2) {
    const [first, second] = explicitParagraphs as [string, string];
    const firstSentences = segmentSentences(first);
    const secondSentences = segmentSentences(second);
    if (
      firstSentences.length >= 2 &&
      (secondSentences.length < 2 || first.length >= second.length)
    ) {
      const [partA, partB] = partitionSentences(firstSentences, 2);
      return [partA!, partB!, second];
    }
    if (secondSentences.length >= 2) {
      const [partA, partB] = partitionSentences(secondSentences, 2);
      return [first, partA!, partB!];
    }
    return [first, second];
  }

  const singleBlock = explicitParagraphs[0] ?? trimmed;
  const sentences = segmentSentences(singleBlock);
  if (sentences.length >= 3) {
    return partitionSentences(sentences, 3);
  }
  if (sentences.length === 2 && singleBlock.length >= 160) {
    return sentences;
  }
  return [singleBlock];
}

function segmentSentences(text: string): readonly string[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  return [...sentenceSegmenter.segment(normalized)]
    .map((entry) => entry.segment.trim())
    .filter(Boolean);
}

function partitionSentences(
  sentences: readonly string[],
  targetCount: 2 | 3,
): readonly string[] {
  if (targetCount === 2) {
    let best: readonly [string, string] = [
      sentences[0]!,
      sentences.slice(1).join(" "),
    ];
    let bestSpread = Math.abs(best[0].length - best[1].length);
    for (let index = 1; index < sentences.length; index += 1) {
      const first = sentences.slice(0, index).join(" ");
      const second = sentences.slice(index).join(" ");
      const spread = Math.abs(first.length - second.length);
      if (spread < bestSpread) {
        best = [first, second];
        bestSpread = spread;
      }
    }
    return best;
  }

  let best: readonly [string, string, string] = [
    sentences[0]!,
    sentences[1]!,
    sentences.slice(2).join(" "),
  ];
  let bestSpread =
    Math.max(best[0].length, best[1].length, best[2].length) -
    Math.min(best[0].length, best[1].length, best[2].length);

  for (let i = 1; i < sentences.length - 1; i += 1) {
    for (let j = i + 1; j < sentences.length; j += 1) {
      const first = sentences.slice(0, i).join(" ");
      const second = sentences.slice(i, j).join(" ");
      const third = sentences.slice(j).join(" ");
      const spread =
        Math.max(first.length, second.length, third.length) -
        Math.min(first.length, second.length, third.length);
      if (spread < bestSpread) {
        best = [first, second, third];
        bestSpread = spread;
      }
    }
  }
  return best;
}
