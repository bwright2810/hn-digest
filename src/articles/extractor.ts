import { createHash } from "node:crypto";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import {
  SourceDocumentAdapterRegistry,
  type EvidenceLocation,
} from "./adapters";
import { parseFeedEntry } from "./feeds";

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
  readonly adapterId: string;
  readonly evidenceLocations: readonly EvidenceLocation[];
}

export interface ArticleExtractorOptions {
  readonly minimumCharacterCount?: number;
  readonly minimumParagraphCount?: number;
}

export class ArticleExtractor {
  private readonly minimumCharacterCount: number;
  private readonly minimumParagraphCount: number;
  private readonly registry: SourceDocumentAdapterRegistry;

  constructor(options: ArticleExtractorOptions = {}) {
    this.minimumCharacterCount = requireNonnegativeInteger(
      options.minimumCharacterCount ?? 400,
      "minimumCharacterCount",
    );
    this.minimumParagraphCount = requireNonnegativeInteger(
      options.minimumParagraphCount ?? 2,
      "minimumParagraphCount",
    );
    this.registry = new SourceDocumentAdapterRegistry([
      {
        id: "html-v1",
        contentTypes: new Set(["text/html", "application/xhtml+xml"]),
        matches: () => true,
        extract: ({ body, sourceUrl }) => this.extractHtml(body, sourceUrl),
      },
      {
        id: "github-markdown-v1",
        contentTypes: new Set(["text/markdown"]),
        matches: ({ sourceUrl }) => githubRepositoryPath(sourceUrl) !== null,
        extract: ({ body, sourceUrl }) =>
          this.extractText(
            body,
            true,
            "github-markdown-v1",
            githubRepositoryPath(sourceUrl) ?? undefined,
          ),
      },
      {
        id: "github-source-v1",
        contentTypes: new Set(["text/plain"]),
        matches: ({ sourceUrl }) => githubRepositoryPath(sourceUrl) !== null,
        extract: ({ body, sourceUrl }) =>
          this.extractText(
            body,
            false,
            "github-source-v1",
            githubRepositoryPath(sourceUrl) ?? undefined,
          ),
      },
      {
        id: "rss-atom-v1",
        contentTypes: new Set([
          "application/rss+xml",
          "application/atom+xml",
          "application/xml",
          "text/xml",
        ]),
        matches: () => true,
        extract: ({ body }) => this.extractFeed(body),
      },
      {
        id: "plain-text-v1",
        contentTypes: new Set(["text/plain"]),
        matches: () => true,
        extract: ({ body }) => this.extractText(body, false, "plain-text-v1"),
      },
      {
        id: "markdown-v1",
        contentTypes: new Set(["text/markdown", "text/x-markdown"]),
        matches: () => true,
        extract: ({ body }) => this.extractText(body, true, "markdown-v1"),
      },
    ]);
  }

  extract(
    content: string | Uint8Array,
    sourceUrl: string | URL,
    contentType = "text/html",
  ): ArticleExtraction {
    const result = this.registry.extract({
      body: content,
      sourceUrl: new URL(sourceUrl),
      contentType,
    });
    return result.status === "handled"
      ? result.extraction
      : emptyExtraction("unsupported_source_adapter", "unsupported");
  }

  private extractHtml(
    html: string | Uint8Array,
    sourceUrl: string | URL,
  ): ArticleExtraction {
    const markup =
      typeof html === "string" ? html : new TextDecoder().decode(html);
    const url = new URL(sourceUrl);
    const document = new JSDOM(markup, { url: url.href }).window.document;
    const publishedAt = findPublicationTime(document);
    const parsed = new Readability(
      document.cloneNode(true) as Document,
    ).parse();

    if (!parsed?.content) {
      return (
        this.extractHtmlFallback(document, markup, publishedAt, null) ??
        emptyExtraction("readability_returned_no_article")
      );
    }

    const contentDocument = new JSDOM(`<main>${parsed.content}</main>`, {
      url: url.href,
    }).window.document;
    const main = contentDocument.querySelector("main");
    if (!main) {
      return (
        this.extractHtmlFallback(document, markup, publishedAt, parsed.title) ??
        emptyExtraction("readability_returned_no_article")
      );
    }

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
      const fallback = this.extractHtmlFallback(
        document,
        markup,
        publishedAt,
        parsed.title,
      );
      if (fallback) return fallback;
      return {
        ...emptyExtraction("normalized_article_was_empty"),
        title: normalizeNullable(parsed.title),
        byline: normalizeNullable(parsed.byline),
        publishedAt,
        headings,
        adapterId: "html-v1",
        evidenceLocations: headingEvidence(headings),
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
      adapterId: "html-v1",
      evidenceLocations: headingEvidence(headings),
    };
  }

  private extractHtmlFallback(
    document: Document,
    rawMarkup: string,
    publishedAt: Date | null,
    parsedTitle: string | null | undefined,
  ): ArticleExtraction | null {
    const metaTitle =
      normalizeNullable(parsedTitle) ??
      findMetaContent(document, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[name="title"]',
      ]) ??
      normalizeNullable(document.querySelector("h1")?.textContent) ??
      normalizeNullable(document.title);
    const metaByline = findMetaContent(document, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="twitter:creator"]',
    ]);

    // 1. Semantic container fallback (<article>, <main>, [role="main"])
    const semanticRoot = document.querySelector(
      'article, main, [role="main"], .post-content, .article-content, .entry-content, .markdown-body',
    );
    if (semanticRoot) {
      const clone = semanticRoot.cloneNode(true) as Element;
      for (const noise of clone.querySelectorAll(
        "nav, header, footer, aside, script, style, noscript, svg, form, button",
      )) {
        noise.remove();
      }
      const headings = [...clone.querySelectorAll("h1, h2, h3, h4, h5, h6")]
        .map((heading) => ({
          level: Number(heading.tagName.slice(1)),
          text: normalizeInlineText(heading.textContent ?? ""),
        }))
        .filter(({ text }) => text.length > 0);
      const blocks = [
        ...clone.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote",
        ),
      ]
        .filter(
          (element) => !element.parentElement?.closest("li, pre, blockquote"),
        )
        .map((element) => formatBlock(element))
        .filter((text) => text.length > 0);
      const semanticText = normalizeDocumentText(blocks.join("\n\n"));
      if (semanticText) {
        return this.buildFallbackHtmlExtraction({
          title: metaTitle,
          byline: metaByline,
          publishedAt,
          headings,
          text: semanticText,
          paragraphCount: clone.querySelectorAll("p").length || blocks.length,
          reason: "semantic_dom_fallback",
        });
      }
    }

    // 2. Embedded JSON-LD or YouTube ytInitialPlayerResponse fallback
    const jsonLd = extractJsonLdContent(document);
    const youtube = extractYouTubeVideoDetails(rawMarkup);
    const metaDescription = findMetaContent(document, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]);

    const candidateTitle = youtube?.title ?? jsonLd?.headline ?? metaTitle;
    const candidateByline = youtube?.author ?? jsonLd?.author ?? metaByline;
    const candidateBody =
      youtube?.shortDescription ??
      jsonLd?.articleBody ??
      jsonLd?.description ??
      metaDescription;

    if (!candidateBody) return null;

    const normalizedBody = normalizeDocumentText(candidateBody);
    if (!normalizedBody) return null;

    const headings = candidateTitle ? [{ level: 1, text: candidateTitle }] : [];
    const combinedText =
      candidateTitle && !normalizedBody.startsWith(candidateTitle)
        ? `# ${candidateTitle}\n\n${normalizedBody}`
        : normalizedBody;

    return this.buildFallbackHtmlExtraction({
      title: candidateTitle,
      byline: candidateByline,
      publishedAt,
      headings,
      text: combinedText,
      paragraphCount: combinedText.split(/\n\s*\n/gu).filter(Boolean).length,
      reason: "metadata_fallback",
    });
  }

  private buildFallbackHtmlExtraction(options: {
    readonly title: string | null;
    readonly byline: string | null;
    readonly publishedAt: Date | null;
    readonly headings: readonly ArticleHeading[];
    readonly text: string;
    readonly paragraphCount: number;
    readonly reason: string;
  }): ArticleExtraction {
    const confidenceReasons: string[] = [options.reason];
    if (options.text.length < this.minimumCharacterCount) {
      confidenceReasons.push("short_content");
    }
    if (options.paragraphCount < this.minimumParagraphCount) {
      confidenceReasons.push("few_paragraphs");
    }
    return {
      status:
        options.text.length >= this.minimumCharacterCount &&
        options.paragraphCount >= this.minimumParagraphCount
          ? "extracted"
          : "low_confidence",
      title: options.title,
      byline: options.byline,
      publishedAt: options.publishedAt,
      headings: options.headings,
      text: options.text,
      contentHash: createHash("sha256").update(options.text).digest("hex"),
      wordCount: options.text.split(/\s+/u).length,
      characterCount: options.text.length,
      confidenceReasons,
      adapterId: "html-v1",
      evidenceLocations:
        options.headings.length > 0
          ? headingEvidence(options.headings)
          : lineEvidence(options.text),
    };
  }

  private extractText(
    content: string | Uint8Array,
    markdown: boolean,
    adapterId: string,
    repositoryPath?: string,
  ): ArticleExtraction {
    let decoded: string;
    try {
      decoded =
        typeof content === "string"
          ? content
          : new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return emptyExtraction("invalid_utf8_text", adapterId);
    }
    if (decoded.includes("\0"))
      return emptyExtraction("binary_text_content", adapterId);
    const text = normalizeDocumentText(decoded);
    if (!text)
      return emptyExtraction("normalized_article_was_empty", adapterId);

    const blocks = text.split(/\n\s*\n/gu).filter(Boolean);
    const headings = markdown
      ? text
          .split("\n")
          .map((line) => /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match) => ({
            level: match[1]?.length ?? 1,
            text: normalizeInlineText(match[2] ?? ""),
          }))
          .filter(({ text: heading }) => heading.length > 0)
      : [];
    const confidenceReasons: string[] = [];
    if (text.length < this.minimumCharacterCount)
      confidenceReasons.push("short_content");
    if (blocks.length < this.minimumParagraphCount)
      confidenceReasons.push("few_paragraphs");

    return {
      status: confidenceReasons.length === 0 ? "extracted" : "low_confidence",
      title: markdown ? (headings[0]?.text ?? null) : null,
      byline: null,
      publishedAt: null,
      headings,
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
      wordCount: text.split(/\s+/u).length,
      characterCount: text.length,
      confidenceReasons,
      adapterId,
      evidenceLocations: [
        ...(repositoryPath
          ? [{ kind: "file_path" as const, path: repositoryPath }]
          : []),
        ...(markdown ? headingEvidence(headings) : lineEvidence(text)),
      ],
    };
  }

  private extractFeed(content: string | Uint8Array): ArticleExtraction {
    const parsed = parseFeedEntry(content);
    if (parsed.status === "unsupported") {
      return emptyExtraction(parsed.reason, "rss-atom-v1");
    }
    const headings = parsed.title
      ? [{ level: 1, text: normalizeInlineText(parsed.title) }]
      : [];
    const text = normalizeDocumentText(
      [parsed.title ? `# ${parsed.title}` : null, parsed.text]
        .filter((value): value is string => value !== null)
        .join("\n\n"),
    );
    if (!text)
      return emptyExtraction("feed_entry_missing_content", "rss-atom-v1");
    const confidenceReasons: string[] = [];
    if (text.length < this.minimumCharacterCount) {
      confidenceReasons.push("short_content");
    }
    if (
      parsed.text.split(/\n\s*\n/gu).filter(Boolean).length <
      this.minimumParagraphCount
    ) {
      confidenceReasons.push("few_paragraphs");
    }
    return {
      status: confidenceReasons.length === 0 ? "extracted" : "low_confidence",
      title: parsed.title,
      byline: parsed.author,
      publishedAt: parsed.publishedAt,
      headings,
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
      wordCount: text.split(/\s+/u).length,
      characterCount: text.length,
      confidenceReasons,
      adapterId: `${parsed.kind}-v1`,
      evidenceLocations: [
        { kind: "entry", entryId: parsed.entryId },
        ...headingEvidence(headings),
      ],
    };
  }
}

function githubRepositoryPath(url: URL): string | null {
  if (url.hostname.toLowerCase() !== "github.com") return null;
  let parts: string[];
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (parts.length < 5 || parts[2] !== "blob") return null;
  const path = parts.slice(4).join("/");
  return path && !path.split("/").some((part) => part === "." || part === "..")
    ? path
    : null;
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

function findMetaContent(
  document: Document,
  selectors: readonly string[],
): string | null {
  for (const selector of selectors) {
    const content = normalizeNullable(
      document.querySelector(selector)?.getAttribute("content"),
    );
    if (content) return content;
  }
  return null;
}

function extractJsonLdContent(document: Document): {
  readonly headline: string | null;
  readonly author: string | null;
  readonly articleBody: string | null;
  readonly description: string | null;
} | null {
  const scripts = [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ];
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const found = findJsonLdNode(parsed);
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

function findJsonLdNode(value: unknown): {
  readonly headline: string | null;
  readonly author: string | null;
  readonly articleBody: string | null;
  readonly description: string | null;
} | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    const found = findJsonLdNode(record["@graph"]);
    if (found) return found;
  }
  const articleBody =
    typeof record.articleBody === "string"
      ? normalizeDocumentText(record.articleBody)
      : typeof record.text === "string"
        ? normalizeDocumentText(record.text)
        : null;
  const description =
    typeof record.description === "string"
      ? normalizeDocumentText(record.description)
      : null;
  if (!articleBody && !description) return null;

  const headline =
    typeof record.headline === "string"
      ? normalizeNullable(record.headline)
      : typeof record.name === "string"
        ? normalizeNullable(record.name)
        : null;
  let author: string | null = null;
  if (typeof record.author === "string") {
    author = normalizeNullable(record.author);
  } else if (
    typeof record.author === "object" &&
    record.author !== null &&
    !Array.isArray(record.author) &&
    typeof (record.author as Record<string, unknown>).name === "string"
  ) {
    author = normalizeNullable(
      (record.author as Record<string, unknown>).name as string,
    );
  }
  return { headline, author, articleBody, description };
}

function extractYouTubeVideoDetails(rawMarkup: string): {
  readonly title: string | null;
  readonly author: string | null;
  readonly shortDescription: string | null;
} | null {
  const marker = '"videoDetails":{';
  const start = rawMarkup.indexOf(marker);
  if (start < 0) return null;
  const objectStart = start + '"videoDetails":'.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const maxEnd = Math.min(rawMarkup.length, objectStart + 100_000);
  for (let index = objectStart; index < maxEnd; index += 1) {
    const char = rawMarkup[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(
            rawMarkup.slice(objectStart, index + 1),
          ) as Record<string, unknown>;
          const shortDescription =
            typeof parsed.shortDescription === "string"
              ? normalizeDocumentText(parsed.shortDescription)
              : null;
          if (!shortDescription) return null;
          return {
            title:
              typeof parsed.title === "string"
                ? normalizeNullable(parsed.title)
                : null,
            author:
              typeof parsed.author === "string"
                ? normalizeNullable(parsed.author)
                : null,
            shortDescription,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
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

function emptyExtraction(
  reason: string,
  adapterId = "html-v1",
): ArticleExtraction {
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
    adapterId,
    evidenceLocations: [],
  };
}

function headingEvidence(
  headings: readonly ArticleHeading[],
): EvidenceLocation[] {
  return headings.map(({ level, text }) => ({
    kind: "heading",
    heading: text,
    level,
  }));
}

function lineEvidence(text: string): EvidenceLocation[] {
  return [
    { kind: "line_range", startLine: 1, endLine: text.split("\n").length },
  ];
}

function requireNonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
  return value;
}
