import { describe, expect, it, vi } from "vitest";

import type { ArticleExtraction } from "./extractor";
import {
  SourceDocumentAdapterRegistry,
  type SourceDocumentAdapter,
} from "./adapters";

const extraction: ArticleExtraction = {
  status: "extracted",
  title: "Fixture",
  byline: null,
  publishedAt: null,
  headings: [],
  text: "Fixture article text",
  contentHash: "a".repeat(64),
  wordCount: 3,
  characterCount: 20,
  confidenceReasons: [],
  adapterId: "fixture-v1",
  evidenceLocations: [{ kind: "line_range", startLine: 1, endLine: 1 }],
};

function adapter(id: string, matches = true): SourceDocumentAdapter {
  return {
    id,
    contentTypes: new Set(["text/plain"]),
    matches: vi.fn().mockReturnValue(matches),
    extract: vi.fn().mockReturnValue({ ...extraction, adapterId: id }),
  };
}

const input = {
  body: "Fixture article text",
  sourceUrl: new URL("https://example.com/article.txt"),
  contentType: "text/plain",
} as const;

describe("SourceDocumentAdapterRegistry", () => {
  it("uses the first matching adapter deterministically", () => {
    const first = adapter("first-v1");
    const second = adapter("second-v1");
    const registry = new SourceDocumentAdapterRegistry([first, second]);

    expect(registry.extract(input)).toMatchObject({
      status: "handled",
      adapterId: "first-v1",
      extraction: { adapterId: "first-v1" },
    });
    expect(first.extract).toHaveBeenCalledOnce();
    expect(second.extract).not.toHaveBeenCalled();
  });

  it("returns an explicit unsupported result when no adapter matches", () => {
    const registry = new SourceDocumentAdapterRegistry([adapter("html-v1")]);

    expect(
      registry.extract({ ...input, contentType: "application/pdf" }),
    ).toEqual({ status: "unsupported", reason: "no_matching_adapter" });
  });

  it("rejects duplicate adapter IDs", () => {
    expect(
      () =>
        new SourceDocumentAdapterRegistry([adapter("same"), adapter("same")]),
    ).toThrow(/unique/);
  });
});
