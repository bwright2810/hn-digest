export function takeawayParagraphs(summary: string): readonly string[] {
  const explicitParagraphs = summary
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (explicitParagraphs.length > 1) return explicitParagraphs;

  const sentences = summary.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  if (sentences.length < 3 || summary.length < 280) return [summary.trim()];

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
  return paragraphs;
}
