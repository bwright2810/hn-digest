import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ArticleExtractor } from "./extractor";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
}

async function textFixture(name: string, extension: string): Promise<string> {
  return readFile(
    new URL(`fixtures/${name}.${extension}`, import.meta.url),
    "utf8",
  );
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
    expect(result).toMatchObject({
      adapterId: "html-v1",
      evidenceLocations: [
        { kind: "heading", heading: "Prefer deterministic stages", level: 2 },
        { kind: "heading", heading: "Keep evidence attached", level: 2 },
        { kind: "heading", heading: "Conclusion", level: 3 },
      ],
    });
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
      adapterId: "html-v1",
      evidenceLocations: [],
    });
  });

  it("extracts plain-text essays while preserving paragraph structure", async () => {
    const result = new ArticleExtractor().extract(
      await textFixture("plain-text-essay", "txt"),
      "https://example.com/essay.txt",
      "text/plain",
    );

    expect(result).toMatchObject({
      status: "extracted",
      title: null,
      headings: [],
      adapterId: "plain-text-v1",
      evidenceLocations: [
        { kind: "line_range", startLine: 1, endLine: expect.any(Number) },
      ],
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      confidenceReasons: [],
    });
    expect(result.text).toContain("\n\nDeterministic extraction");
  });

  it("extracts markdown documents and retains their heading hierarchy", async () => {
    const result = new ArticleExtractor().extract(
      await textFixture("markdown-article", "md"),
      "https://example.com/article.md",
      "text/markdown",
    );

    expect(result).toMatchObject({
      status: "extracted",
      title: "Designing Bounded Collectors",
      headings: [
        { level: 1, text: "Designing Bounded Collectors" },
        { level: 2, text: "Preserve evidence" },
        { level: 2, text: "Fail explicitly" },
      ],
      adapterId: "markdown-v1",
      evidenceLocations: [
        {
          kind: "heading",
          heading: "Designing Bounded Collectors",
          level: 1,
        },
        { kind: "heading", heading: "Preserve evidence", level: 2 },
        { kind: "heading", heading: "Fail explicitly", level: 2 },
      ],
    });
  });

  it("returns an explicit empty result for an unregistered content type", () => {
    expect(
      new ArticleExtractor().extract(
        "%PDF fixture",
        "https://example.com/document.pdf",
        "application/pdf",
      ),
    ).toMatchObject({
      status: "empty",
      adapterId: "unsupported",
      confidenceReasons: ["unsupported_source_adapter"],
      evidenceLocations: [],
    });
  });

  it("marks empty supported text explicitly instead of inventing content", () => {
    expect(
      new ArticleExtractor().extract(
        " \n \n",
        "https://example.com/empty.txt",
        "text/plain",
      ),
    ).toMatchObject({
      status: "empty",
      text: null,
      confidenceReasons: ["normalized_article_was_empty"],
    });
  });

  it("rejects binary or invalid UTF-8 bodies mislabeled as text", () => {
    const extractor = new ArticleExtractor();
    expect(
      extractor.extract(
        "text\0binary",
        "https://example.com/file",
        "text/plain",
      ),
    ).toMatchObject({
      status: "empty",
      confidenceReasons: ["binary_text_content"],
    });
    expect(
      extractor.extract(
        new Uint8Array([0xc3, 0x28]),
        "https://example.com/file",
        "text/plain",
      ),
    ).toMatchObject({
      status: "empty",
      confidenceReasons: ["invalid_utf8_text"],
    });
  });
});
