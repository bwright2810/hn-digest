import { describe, expect, it } from "vitest";

import { takeawayParagraphs } from "./takeaway";

describe("takeawayParagraphs", () => {
  it("keeps a single-sentence takeaway intact without splitting mid-sentence", () => {
    expect(takeawayParagraphs("A concise takeaway stays together.")).toEqual([
      "A concise takeaway stays together.",
    ]);
  });

  it("preserves explicit paragraph boundaries without chopping single sentences", () => {
    expect(
      takeawayParagraphs("The first point stands.\n\nThe caveat follows."),
    ).toEqual(["The first point stands.", "The caveat follows."]);
  });

  it("splits a two-paragraph multi-sentence takeaway at a sentence boundary rather than mid-sentence", () => {
    const summary =
      "The monthly hiring thread lays out practical expectations: name the employer, describe active roles, clarify location and work mode, and answer applicants. The listings cover many sectors and arrangements; several spell out requirements or process details. Those claims come from employers and have not been independently checked here.\n\nA follow-up raises an unresolved question about pay for a part-time listing. Otherwise, the sample contains little direct debate or evidence about applicant experience.";
    const paragraphs = takeawayParagraphs(summary);

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe(
      "The monthly hiring thread lays out practical expectations: name the employer, describe active roles, clarify location and work mode, and answer applicants.",
    );
    expect(paragraphs[1]).toBe(
      "The listings cover many sectors and arrangements; several spell out requirements or process details. Those claims come from employers and have not been independently checked here.",
    );
    expect(paragraphs[2]).toBe(
      "A follow-up raises an unresolved question about pay for a part-time listing. Otherwise, the sample contains little direct debate or evidence about applicant experience.",
    );
  });

  it("balances a long multi-sentence summary into three complete-sentence paragraphs", () => {
    const summary = [
      "The article establishes a useful premise with several concrete examples and enough implementation detail to make the approach understandable.",
      "The discussion supports that premise while questioning the operational cost and whether the examples generalize to larger systems.",
      "Those objections matter because the evidence only covers a narrow deployment and leaves several important failure modes unexplored.",
      "The most defensible conclusion is therefore conditional rather than universal, with value depending heavily on the surrounding constraints.",
    ].join(" ");
    const paragraphs = takeawayParagraphs(summary);

    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(paragraph).toMatch(/\.$/u);
    }
  });
});
