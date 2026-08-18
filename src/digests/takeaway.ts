export function takeawayParagraphs(summary: string): readonly string[] {
  const explicitParagraphs = summary
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (explicitParagraphs.length > 1) {
    return ensureThreeParagraphs(explicitParagraphs);
  }

  const sentences = summary.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  if (sentences.length < 3 || summary.length < 280) {
    return splitIntoThreeParagraphs(summary.trim());
  }

  const targetLength = Math.ceil(
    summary.length / Math.min(3, sentences.length),
  );
  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (current && current.length >= targetLength) {
      paragraphs.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current) paragraphs.push(current);
  return ensureThreeParagraphs(paragraphs);
}

function ensureThreeParagraphs(
  paragraphs: readonly string[],
): readonly string[] {
  if (paragraphs.length >= 3) return paragraphs;
  return splitIntoThreeParagraphs(paragraphs.join(" "));
}

function splitIntoThreeParagraphs(summary: string): readonly string[] {
  if (!summary) return ["", "", ""];
  const words = summary.split(/\s+/u);
  const paragraphs: string[] = [];
  let offset = 0;
  for (let index = 0; index < 3; index += 1) {
    const remaining = words.length - offset;
    const parts = 3 - index;
    const length = Math.max(1, Math.ceil(remaining / parts));
    paragraphs.push(words.slice(offset, offset + length).join(" "));
    offset += length;
  }
  return paragraphs;
}
