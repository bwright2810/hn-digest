import { z } from "zod";

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

export type HumanizerItem = z.infer<typeof humanizerItemSchema>;

export const humanizerOutputSchema = z
  .object({
    promptVersion: z.literal(HUMANIZER_PROMPT_VERSION),
    schemaVersion: z.literal(HUMANIZER_SCHEMA_VERSION),
    stories: z.array(humanizerItemSchema).min(1).max(20),
  })
  .strict();

export type HumanizerOutput = z.infer<typeof humanizerOutputSchema>;

const generatedJsonSchema = Object.fromEntries(
  Object.entries(
    z.toJSONSchema(humanizerOutputSchema, { target: "draft-7" }),
  ).filter(([key]) => key !== "$schema"),
);

export const humanizerOutputJsonSchema: Readonly<Record<string, unknown>> =
  Object.freeze(generatedJsonSchema);

export const HUMANIZER_PROMPT = `Rewrite the phrasing of the supplied digest prose. Every sentence below has already been fact-checked, sourced, and cited elsewhere; you are given only the plain text, with no citations attached. Your only job is sentence-level style, not content.

Grounding rules:
- Never add, remove, or alter a fact, name, number, date, claim, quotation, or comparison. If you cannot rewrite a sentence without changing what it asserts, leave it as close to the original as possible rather than guessing.
- Do not invent color, biography, opinions, or examples that were not already present.
- Return exactly one output item per input item, in the same order, with the same storyId. If an input field is null, its output must also be null. Never add or drop a story.
- Keep each rewritten article or discussion field under 600 characters and each takeaway under 900 characters.

Style rewrite rules:
- Vary sentence length and structure across the whole batch; do not force every takeaway into the same shape.
- Cut negative-parallelism constructions such as "X is not A; it is B" or "not X, but Y" — state the point directly instead. Example: rewrite "The test is not minimalism; it is whether the investment changes what gets built." as "The real test is whether the investment changes what gets built, not how minimal the setup looks."
- Remove stacked hedges, performative balance, repetitive tricolons, and stock AI vocabulary such as "delve", "tapestry", "testament", "pivotal", "paramount", "realm", "landscape", "seamless", and filler uses of "robust", "nuanced", or "comprehensive".
- Use no more than two em dashes in any single field, and prefer none.
- Keep technical terms, numbers, and named entities exactly as written.

Return only the required structured output. Set promptVersion to "${HUMANIZER_PROMPT_VERSION}" and schemaVersion to "${HUMANIZER_SCHEMA_VERSION}".`;

export function parseHumanizerOutput(value: unknown): HumanizerOutput {
  return humanizerOutputSchema.parse(value);
}
