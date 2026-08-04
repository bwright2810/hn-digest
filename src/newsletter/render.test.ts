import { describe, expect, it } from "vitest";

import type { DigestRunView } from "../digests/reader";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
} from "../analysis/contract";

import { renderNewsletter } from "./render";

const digest: DigestRunView = {
  id: "run-1",
  status: "complete",
  collectedAt: new Date("2026-07-23T11:00:00Z"),
  createdAt: new Date("2026-07-23T11:00:00Z"),
  requestedStoryCount: 1,
  stories: [
    {
      id: "story-1",
      rank: 1,
      title: "Typed <news>",
      articleUrl: "https://example.com/article?a=1&b=2",
      hnUrl: "https://news.ycombinator.com/item?id=42",
      score: 100,
      commentCount: 20,
      author: "tester",
      status: "complete",
      failureCode: null,
      analysis: {
        promptVersion: ANALYSIS_PROMPT_VERSION,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        article: {
          thesis: {
            claim: "The article explains typed <systems>.",
            citations: [
              { locator: "Introduction", sourceUrl: "https://example.com" },
            ],
          },
          keyPoints: [],
          evidence: [],
          limitations: [],
          confidence: "high",
          sourceQualityNotes: [],
        },
        discussion: {
          consensus: [
            {
              claim: "Commenters value the practical examples & caveats.",
              supportingCommentIds: [42001],
            },
          ],
          competingViewpoints: [],
          insightfulComments: [],
          unresolvedQuestions: [],
          confidence: "medium",
          sourceQualityNotes: [],
        },
        combinedTakeaway: {
          summary:
            "Useful guidance, provided its limits are understood.\n\nApply it with care on narrower screens.",
          tensions: [],
          confidence: "high",
        },
      },
    },
  ],
};

describe("renderNewsletter", () => {
  it("renders HTML and text from the same persisted digest with provenance", () => {
    const result = renderNewsletter(
      digest,
      "morning",
      {
        canonicalDigest: new URL("https://digest.example/"),
        preferences: new URL(
          "https://digest.example/newsletter/preferences?token=opaque",
        ),
        unsubscribe: new URL(
          "https://digest.example/newsletter/preferences?token=opaque&unsubscribe=1",
        ),
      },
      "123 Example Street",
    );

    expect(result.subject).toBe("Morning HN Digest");
    for (const value of [
      "Typed &lt;news&gt;",
      "The article explains typed &lt;systems&gt;.",
      "Commenters value the practical examples &amp; caveats.",
      "Useful guidance, provided its limits are understood.",
      "Apply it with care on narrower screens.",
      "Article",
      "Discussion",
      "The takeaway",
      "42001",
      "Read original",
      "HN discussion",
      "Manage preferences",
      "Unsubscribe",
      "123 Example Street",
    ])
      expect(result.html).toContain(value);
    for (const value of [
      "Typed <news>",
      "ARTICLE",
      "The article explains typed <systems>.",
      "DISCUSSION",
      "THE TAKEAWAY",
      "Useful guidance, provided its limits are understood.\n\nApply it with care on narrower screens.",
      "https://example.com/article?a=1&b=2",
      "https://news.ycombinator.com/item?id=42",
      "Manage preferences:",
      "Unsubscribe:",
      "123 Example Street",
    ])
      expect(result.text).toContain(value);
    expect(result.html).toContain("font-size:15px;line-height:1.55");
    expect(
      result.html.match(/font-size:15px;line-height:1\.55/gu),
    ).toHaveLength(2);
  });

  it("refuses a digest that has not reached a deliverable state", () => {
    expect(() =>
      renderNewsletter(
        { ...digest, status: "analyzing" },
        "evening",
        {
          canonicalDigest: new URL("https://digest.example/"),
          preferences: new URL("https://digest.example/preferences"),
          unsubscribe: new URL("https://digest.example/unsubscribe"),
        },
        "123 Example Street",
      ),
    ).toThrow(/not deliverable/);
  });
});
