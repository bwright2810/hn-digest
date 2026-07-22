import { describe, expect, it } from "vitest";

import {
  createAnalysisCacheKeys,
  explainAnalysisCacheMiss,
  type AnalysisCacheComponents,
} from "./cache";

const baseline: AnalysisCacheComponents = {
  articleContentHash: "a".repeat(64),
  selectedCommentHash: "b".repeat(64),
  promptVersion: "prompt-v1",
  schemaVersion: "schema-v1",
  model: "economical-model",
  reasoningConfig: { effort: "low", summary: "auto" },
};

describe("HD-043 analysis cache keys", () => {
  it("is deterministic across reasoning configuration key order", () => {
    const first = createAnalysisCacheKeys(baseline);
    const second = createAnalysisCacheKeys({
      ...baseline,
      reasoningConfig: { summary: "auto", effort: "low" },
    });

    expect(second).toEqual(first);
    expect(first.analysis).toMatch(/^[a-f\d]{64}$/u);
  });

  it("reuses the article key when only selected comments change", () => {
    const first = createAnalysisCacheKeys(baseline);
    const second = createAnalysisCacheKeys({
      ...baseline,
      selectedCommentHash: "c".repeat(64),
    });

    expect(second.article).toBe(first.article);
    expect(second.analysis).not.toBe(first.analysis);
    expect(second.discussion).not.toBe(first.discussion);
  });

  it.each([
    ["articleContentHash", { articleContentHash: "c".repeat(64) }],
    ["selectedCommentHash", { selectedCommentHash: "c".repeat(64) }],
    ["promptVersion", { promptVersion: "prompt-v2" }],
    ["schemaVersion", { schemaVersion: "schema-v2" }],
    ["model", { model: "other-model" }],
    ["reasoningConfig", { reasoningConfig: { effort: "medium" } }],
  ] as const)("reports a changed %s component", (component, change) => {
    const current = { ...baseline, ...change };
    expect(explainAnalysisCacheMiss(current, baseline)).toEqual([component]);
  });

  it("supports discussion-only analysis without inventing an article hash", () => {
    const keys = createAnalysisCacheKeys({
      ...baseline,
      articleContentHash: null,
    });

    expect(keys.article).toBeNull();
    expect(keys.analysis).toMatch(/^[a-f\d]{64}$/u);
  });

  it("rejects hashes that are not canonical SHA-256 values", () => {
    expect(() =>
      createAnalysisCacheKeys({ ...baseline, selectedCommentHash: "BAD" }),
    ).toThrow("selectedCommentHash");
  });
});
