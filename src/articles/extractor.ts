import { createHash } from "node:crypto";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ArticleExtractionStatus = "extracted" | "low_confidence" | "empty";

export interface ArticleHeading {
  readonly level: number;
  readonly text: string;
}

export interface ArticleExtraction {
  readonly status: ArticleExtractionStatus;
  readonly title: string | null;
  readonly byline: string | null;
  readonly publishedAt: Date | null;
  readonly headings: readonly ArticleHeading[];
  readonly text: string | null;
  readonly contentHash: string | null;
  readonly wordCount: number;
  readonly characterCount: number;
  readonly confidenceReasons: readonly string[];
}

export interface ArticleExtractorOptions {
  readonly minimumCharacterCount?: number;
  readonly minimumParagraphCount?: number;
}

export class ArticleExtractor {
  private readonly minimumCharacterCount: number;
  private readonly minimumParagraphCount: number;

  constructor(options: ArticleExtractorOptions = {}) {
    this.minimumCharacterCount = requireNonnegativeInteger(
      options.minimumCharacterCount ?? 400,
      "minimumCharacterCount",
    );
    this.minimumParagraphCount = requireNonnegativeInteger(
      options.minimumParagraphCount ?? 2,
      "minimumParagraphCount",
    );
  }

  extract(
    html: string | Uint8Array,
    sourceUrl: string | URL,
  ): ArticleExtraction {
    const markup =
      typeof html === "string" ? html : new TextDecoder().decode(html);
    const url = new URL(sourceUrl);
    const document = new JSDOM(markup, { url: url.href }).window.document;
    const publishedAt = findPublicationTime(document);
    const parsed = new Readability(document).parse();

    if (!parsed?.content) {
      return emptyExtraction("readability_returned_no_article");
    }

    const contentDocument = new JSDOM(`<main>${parsed.content}</main>`, {
      url: url.href,
    }).window.document;
    const main = contentDocument.querySelector("main");
    if (!main) return emptyExtraction("readability_returned_no_article");

    const headings = [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: normalizeInlineText(heading.textContent ?? ""),
      }))
      .filter(({ text }) => text.length > 0);
    const blocks = [
      ...main.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote",
      ),
    ]
      .filter(
        (element) => !element.parentElement?.closest("li, pre, blockquote"),
      )
      .map((element) => formatBlock(element))
      .filter((text) => text.length > 0);
    const text = normalizeDocumentText(blocks.join("\n\n"));
    if (!text) {
      return {
        ...emptyExtraction("normalized_article_was_empty"),
        title: normalizeNullable(parsed.title),
        byline: normalizeNullable(parsed.byline),
        publishedAt,
        headings,
      };
    }

    const paragraphCount = main.querySelectorAll("p").length;
    const confidenceReasons: string[] = [];
    if (text.length < this.minimumCharacterCount) {
      confidenceReasons.push("short_content");
    }
    if (paragraphCount < this.minimumParagraphCount) {
      confidenceReasons.push("few_paragraphs");
    }

    return {
      status: confidenceReasons.length === 0 ? "extracted" : "low_confidence",
      title: normalizeNullable(parsed.title),
      byline: normalizeNullable(parsed.byline),
      publishedAt,
      headings,
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
      wordCount: text.split(/\s+/u).length,
      characterCount: text.length,
      confidenceReasons,
    };
  }
}

function formatBlock(element: Element): string {
  const text = normalizeInlineText(element.textContent ?? "");
  if (!text) return "";
  if (/^H[1-6]$/.test(element.tagName)) {
    const level = Number(element.tagName.slice(1));
    return `${"#".repeat(level)} ${text}`;
  }
  if (element.tagName === "LI") return `- ${text}`;
  if (element.tagName === "BLOCKQUOTE") return `> ${text}`;
  return text;
}

function normalizeInlineText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeDocumentText(value: string): string | null {
  const normalized = value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return normalized || null;
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  return normalizeInlineText(value) || null;
}

function findPublicationTime(document: Document): Date | null {
  const candidates = [
    document
      .querySelector('meta[property="article:published_time"]')
      ?.getAttribute("content"),
    document.querySelector('meta[name="date"]')?.getAttribute("content"),
    document.querySelector('meta[name="pubdate"]')?.getAttribute("content"),
    document.querySelector("time[datetime]")?.getAttribute("datetime"),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function emptyExtraction(reason: string): ArticleExtraction {
  return {
    status: "empty",
    title: null,
    byline: null,
    publishedAt: null,
    headings: [],
    text: null,
    contentHash: null,
    wordCount: 0,
    characterCount: 0,
    confidenceReasons: [reason],
  };
}

function requireNonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
  return value;
}
