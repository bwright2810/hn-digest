import { describe, expect, it } from "vitest";

import { takeawayParagraphs } from "./takeaway";

describe("takeawayParagraphs", () => {
  it("keeps a short summary as one paragraph", () => {
    expect(takeawayParagraphs("A concise takeaway stays together.")).toEqual([
      "A concise takeaway stays together.",
    ]);
  });

  it("preserves explicit paragraph boundaries", () => {
    expect(
      takeawayParagraphs("The first point stands.\n\nThe caveat follows."),
    ).toEqual(["The first point stands.", "The caveat follows."]);
  });

  it("balances a long multi-sentence summary", () => {
    const summary = [
      "The article establishes a useful premise with several concrete examples and enough implementation detail to make the approach understandable.",
      "The discussion supports that premise while questioning the operational cost and whether the examples generalize to larger systems.",
      "Those objections matter because the evidence only covers a narrow deployment and leaves several important failure modes unexplored.",
      "The most defensible conclusion is therefore conditional rather than universal, with value depending heavily on the surrounding constraints.",
    ].join(" ");
    expect(takeawayParagraphs(summary)).toHaveLength(2);
  });
});
