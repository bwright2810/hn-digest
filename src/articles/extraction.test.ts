import { describe, expect, it, vi } from "vitest";

import type { ArticleFetchResult } from "./fetcher";
import type { ArticleExtraction } from "./extractor";
import { extractArticle, type ArticleExtractionStore } from "./extraction";

const fetched: ArticleFetchResult = {
  sourceUrl: "https://example.com/source",
  finalUrl: "https://www.example.com/article",
  contentType: "text/html",
  body: new TextEncoder().encode("<article>Fixture</article>"),
  byteLength: 26,
  redirectCount: 1,
  status: 200,
};
const extraction: ArticleExtraction = {
  status: "extracted",
  title: "Fixture article",
  byline: "Ada Example",
  publishedAt: new Date("2026-07-20T14:30:00Z"),
  headings: [{ level: 2, text: "Evidence" }],
  text: "Fixture text",
  contentHash: "a".repeat(64),
  wordCount: 2,
  characterCount: 12,
  confidenceReasons: [],
};

describe("extractArticle", () => {
  it("extracts the fetched body and persists its structured result", async () => {
    const extractedAt = new Date("2026-07-22T12:00:00Z");
    const extractor = { extract: vi.fn().mockReturnValue(extraction) };
    const store = {
      recordExtraction: vi
        .fn<ArticleExtractionStore["recordExtraction"]>()
        .mockResolvedValue(),
    };

    await expect(
      extractArticle({
        storyId: 42,
        fetched,
        extractor,
        store,
        now: () => extractedAt,
      }),
    ).resolves.toBe(extraction);
    expect(extractor.extract).toHaveBeenCalledWith(
      fetched.body,
      fetched.finalUrl,
      fetched.contentType,
    );
    expect(store.recordExtraction).toHaveBeenCalledWith({
      storyId: 42,
      sourceUrl: fetched.sourceUrl,
      canonicalUrl: fetched.finalUrl,
      extractedAt,
      extraction,
    });
  });
});
