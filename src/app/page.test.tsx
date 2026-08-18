import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
} from "../analysis/contract";
import type { DigestRunView } from "../digests/reader";
import { DigestPage } from "./page";
import { takeawayParagraphs } from "./page";

const run: DigestRunView = {
  id: "run-1",
  status: "partial",
  collectedAt: new Date("2026-07-22T11:00:00Z"),
  createdAt: new Date("2026-07-22T10:59:00Z"),
  requestedStoryCount: 2,
  stories: [
    {
      id: "story-1",
      rank: 1,
      title: "A careful technical article",
      articleUrl: "https://example.com/article",
      source: {
        url: "https://example.com/article",
        mediaType: "site",
        availability: "available",
      },
      hnUrl: "https://news.ycombinator.com/item?id=44000001",
      score: 312,
      commentCount: 84,
      author: "reader",
      status: "complete",
      failureCode: null,
      analysis: {
        promptVersion: ANALYSIS_PROMPT_VERSION,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        article: {
          thesis: {
            claim: "The article makes a source-grounded argument.",
            citations: [
              {
                locator: "Introduction",
                sourceUrl: "https://example.com/article",
              },
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
              claim: "Commenters broadly agree with one narrow point.",
              supportingCommentIds: [44000123],
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
            "The evidence is useful, but the discussion adds an important caveat.",
          tensions: [],
          confidence: "high",
        },
      },
    },
    {
      id: "story-2",
      rank: 2,
      title: "An unavailable story",
      articleUrl: null,
      source: {
        url: null,
        mediaType: null,
        availability: "discussion_only",
      },
      hnUrl: "https://news.ycombinator.com/item?id=44000002",
      score: 94,
      commentCount: 20,
      author: null,
      status: "failed",
      failureCode: "ANALYSIS_TERMINAL",
      analysis: null,
    },
  ],
};

describe("DigestPage", () => {
  it("puts an inviting email signup before the latest digest", () => {
    const html = renderToStaticMarkup(<DigestPage run={run} />);

    expect(html).toContain(
      "Get the gist of what Hacker News is talking about.",
    );
    expect(html).toContain('action="/api/newsletter/signup"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="morning" value="1"');
    expect(html).toContain('name="evening" value="1"');
    expect(html.indexOf("homepage-newsletter")).toBeLessThan(
      html.indexOf("digest-heading"),
    );
  });

  it("uses Latest Edition as the single primary page heading", () => {
    const html = renderToStaticMarkup(<DigestPage run={run} />);

    expect(html).toContain('<h1 id="page-title">Latest Edition</h1>');
    expect((html.match(/<h1\b/gu) ?? []).length).toBe(1);
    expect(html).not.toContain("What Hacker News is talking about.</h2>");
  });

  it("hides homepage signup while public signup is disabled", () => {
    const html = renderToStaticMarkup(
      <DigestPage run={run} newsletterEnabled={false} />,
    );

    expect(html).not.toContain("homepage-newsletter");
  });

  it("splits a long takeaway into readable paragraphs", () => {
    const summary = [
      "The article establishes a useful premise with several concrete examples.",
      "The discussion supports that premise while questioning the operational cost.",
      "Those objections matter because the evidence only covers a narrow deployment.",
      "The most defensible conclusion is therefore conditional rather than universal.",
    ].join(" ");

    expect(takeawayParagraphs(summary)).toHaveLength(2);
  });

  it("renders a concise summary, takeaway, and discussion evidence link", () => {
    const html = renderToStaticMarkup(<DigestPage run={run} />);

    expect(html).toContain("A careful technical article");
    expect(html).toContain("Summary");
    expect(html).toContain("The takeaway");
    expect(html).toContain("Discussion evidence");
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain("Site");
    expect(html).toContain("https://example.com/article");
    expect(html).toContain(
      'href="https://news.ycombinator.com/item?id=44000001#44000123"',
    );
    expect(html).toContain("The evidence is useful");
    expect(html).not.toContain(">Article</p>");
    expect(html).not.toContain(">Discussion</p>");
  });

  it("keeps failed stories readable and linked to their HN source", () => {
    const html = renderToStaticMarkup(<DigestPage run={run} />);

    expect(html).toContain("We couldn&#x27;t finish this analysis");
    expect(html).toContain("ANALYSIS_TERMINAL");
    expect(html).toContain("Discussion-only source");
    expect(html).toContain(
      'href="https://news.ycombinator.com/item?id=44000002"',
    );
  });
});
