import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ArticleExtractor } from "./extractor";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
}

describe("ArticleExtractor", () => {
  it("extracts primary text, headings, byline, and publication time", async () => {
    const extractor = new ArticleExtractor();
    const result = extractor.extract(
      await fixture("editorial-article"),
      "https://example.com/article",
    );

    expect(result).toMatchObject({
      status: "extracted",
      title: "Building Reliable Data Pipelines",
      byline: "Ada Example",
      publishedAt: new Date("2026-07-20T14:30:00Z"),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      confidenceReasons: [],
    });
    expect(result.headings).toEqual([
      { level: 2, text: "Prefer deterministic stages" },
      { level: 2, text: "Keep evidence attached" },
      { level: 3, text: "Conclusion" },
    ]);
    expect(result.text).toContain("## Prefer deterministic stages");
    expect(result.text).toContain("Reliability is the product");
    expect(result.text).not.toContain("Trending links");
    expect(result.text).not.toContain("fixture scripts");
  });

  it("produces the same hash for insignificant source whitespace changes", async () => {
    const extractor = new ArticleExtractor();
    const html = await fixture("editorial-article");
    const first = extractor.extract(html, "https://example.com/article");
    const second = extractor.extract(
      html.replaceAll("explicit boundaries", "explicit    boundaries"),
      "https://example.com/article",
    );

    expect(second.text).toBe(first.text);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("identifies sparse extraction as low confidence", async () => {
    const result = new ArticleExtractor().extract(
      await fixture("sparse-page"),
      "https://example.com/status",
    );

    expect(result).toMatchObject({
      status: "low_confidence",
      text: expect.stringContaining("A very short update."),
      confidenceReasons: expect.arrayContaining([
        "short_content",
        "few_paragraphs",
      ]),
    });
  });

  it("identifies pages without extractable content explicitly", async () => {
    const result = new ArticleExtractor().extract(
      await fixture("empty-page"),
      "https://example.com/navigation",
    );

    expect(result).toEqual({
      status: "empty",
      title: "Navigation only",
      byline: null,
      publishedAt: null,
      headings: [],
      text: null,
      contentHash: null,
      wordCount: 0,
      characterCount: 0,
      confidenceReasons: ["normalized_article_was_empty"],
    });
  });
});
