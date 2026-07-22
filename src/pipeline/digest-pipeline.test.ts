import { describe, expect, it } from "vitest";

import { hasArticleContent } from "./digest-pipeline";

describe("article discussion-only fallback", () => {
  it("requires actual extracted text rather than only a document row", () => {
    expect(hasArticleContent({ text: "Source-grounded article text" })).toBe(
      true,
    );
    expect(hasArticleContent({ text: null })).toBe(false);
    expect(hasArticleContent(undefined)).toBe(false);
  });
});
