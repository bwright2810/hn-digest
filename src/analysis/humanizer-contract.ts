import { z } from "zod";

import { clampEditorialProse, normalizeTakeawayParagraphs } from "./contract";

export const HUMANIZER_PROMPT_VERSION = "humanizer-prompt-v1";
export const HUMANIZER_SCHEMA_VERSION = "humanizer-schema-v1";
export const HUMANIZER_OUTPUT_NAME = "hn_digest_humanized_prose";

const humanizerItemSchema = z
  .object({
    storyId: z.string().min(1).max(64),
    article: z.string().max(600).nullable(),
    discussion: z.string().max(600).nullable(),
    takeaway: z.string().max(900),
  })
  .strict();

export interface HumanizerItem {
  readonly storyId: string;
  readonly article: string | null;
  readonly discussion: string | null;
  readonly takeaway: string;
}

export const humanizerOutputSchema = z
  .object({
    promptVersion: z.literal(HUMANIZER_PROMPT_VERSION),
    schemaVersion: z.literal(HUMANIZER_SCHEMA_VERSION),
    stories: z.array(humanizerItemSchema).min(1).max(20),
  })
  .strict();

export interface HumanizerOutput {
  readonly promptVersion: typeof HUMANIZER_PROMPT_VERSION;
  readonly schemaVersion: typeof HUMANIZER_SCHEMA_VERSION;
  readonly stories: readonly HumanizerItem[];
}

const generatedJsonSchema = Object.fromEntries(
  Object.entries(
    z.toJSONSchema(humanizerOutputSchema, { target: "draft-7" }) as Record<
      string,
      unknown
    >,
  ).filter(([key]) => key !== "$schema"),
);

export const humanizerOutputJsonSchema: Readonly<Record<string, unknown>> =
  Object.freeze(generatedJsonSchema);

export const HUMANIZER_PROMPT = `Rewrite the phrasing of the supplied digest prose. Every sentence below has already been fact-checked, sourced, and cited elsewhere; you are given only the plain text, with no citations attached. Your only job is sentence-level style, not content.

Grounding rules:
- Never add, remove, or alter a fact, name, number, date, claim, quotation, or comparison. If you cannot rewrite a sentence without changing what it asserts, leave it as close to the original as possible rather than guessing.
- Do not invent color, biography, opinions, or examples that were not already present.
- Return exactly one output item per input item, in the same order, with the same storyId. If an input field is null, its output must also be null. Never add or drop a story.
- Keep each rewritten article or discussion field under 600 characters and each takeaway under 900 characters (aim for 500–800 characters so the final sentence is always complete).
- Format every rewritten takeaway as three short paragraphs of complete sentences separated by blank lines (\n\n): paragraph 1 on the article/post substance, paragraph 2 on the main thread debate, and paragraph 3 on a concrete detail or notable commenter observation. Never merge paragraphs into a single block or turn the third paragraph into a wrap-up synthesis, summary conclusion, or meta-caveat about what the evidence leaves open.

Style rewrite rules:
- Vary sentence length and structure across the whole batch; do not force every takeaway into the same shape.
- Cut negative-parallelism constructions such as "X is not A; it is B" or "not X, but Y" — state the point directly instead. Example: rewrite "The test is not minimalism; it is whether the investment changes what gets built." as "The real test is whether the investment changes what gets built, not how minimal the setup looks."
- Remove stacked hedges, performative balance, repetitive tricolons, and stock AI vocabulary such as "delve", "tapestry", "testament", "pivotal", "paramount", "realm", "landscape", "seamless", and filler uses of "robust", "nuanced", or "comprehensive".
- Use no more than two em dashes in any single field, and prefer none.
- Keep technical terms, numbers, and named entities exactly as written.

Return only the required structured output. Set promptVersion to "${HUMANIZER_PROMPT_VERSION}" and schemaVersion to "${HUMANIZER_SCHEMA_VERSION}".`;

export function parseHumanizerOutput(value: unknown): HumanizerOutput {
  return humanizerOutputSchema.parse(normalizeHumanizerOutputCandidate(value));
}

function normalizeHumanizerOutputCandidate(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const root: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  if (Array.isArray(root.stories)) {
    root.stories = root.stories.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return item;
      }
      const record = item as Record<string, unknown>;
      return {
        ...record,
        ...(typeof record.article === "string"
          ? { article: clampEditorialProse(record.article, 600) }
          : {}),
        ...(typeof record.discussion === "string"
          ? { discussion: clampEditorialProse(record.discussion, 600) }
          : {}),
        ...(typeof record.takeaway === "string"
          ? {
              takeaway: normalizeTakeawayParagraphs(
                clampEditorialProse(record.takeaway, 900),
                900,
              ),
            }
          : {}),
      };
    });
  }
  return root;
}
