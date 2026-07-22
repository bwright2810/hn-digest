import { describe, expect, it } from "vitest";

import fixture from "./fixtures/discussion.json";
import { rankComments, selectComments, type RankableComment } from "./ranking";

const discussion = fixture satisfies RankableComment[];

describe("comment ranking", () => {
  it("selects strong comments from multiple substantial branches", () => {
    const result = selectComments(discussion, { maximumComments: 3 });

    expect(result.selected).toHaveLength(3);
    expect(result.selected.map(({ hnItemId }) => hnItemId)).toEqual([
      101, 201, 102,
    ]);
    expect(result.representedBranchIds).toEqual(
      expect.arrayContaining([101, 201]),
    );
    expect(result.selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hnItemId: 101,
          parentHnItemId: 100,
          rootHnItemId: 101,
        }),
        expect.objectContaining({
          hnItemId: 201,
          parentHnItemId: 100,
          rootHnItemId: 201,
        }),
      ]),
    );
    expect(result.selected.every(({ text }) => text.length > 0)).toBe(true);
  });

  it("is deterministic regardless of input order", () => {
    const forward = selectComments(discussion, { maximumComments: 4 });
    const reversed = selectComments([...discussion].reverse(), {
      maximumComments: 4,
    });

    expect(reversed).toEqual(forward);
  });

  it("reports transparent reply, quotation, and duplicate signals", () => {
    const duplicateText = "The same repeated observation.";
    const ranked = rankComments([
      ...discussion,
      comment(501, 100, duplicateText),
      comment(502, 100, duplicateText.toUpperCase()),
    ]);

    expect(
      ranked.find(({ hnItemId }) => hnItemId === 101)?.signals,
    ).toMatchObject({
      depth: 0,
      directReplyCount: 2,
      descendantCount: 2,
      branchCommentCount: 3,
      duplicateCount: 1,
    });
    expect(
      ranked.find(({ hnItemId }) => hnItemId === 301)?.signals.quotationPenalty,
    ).toBeGreaterThan(0);
    expect(
      ranked.find(({ hnItemId }) => hnItemId === 501)?.signals,
    ).toMatchObject({ duplicateCount: 2, duplicatePenalty: 35 });
  });

  it("excludes dead, deleted, and empty comments", () => {
    const ranked = rankComments([
      comment(1, 100, "Useful context"),
      { ...comment(2, 100, "Deleted"), isDeleted: true },
      { ...comment(3, 100, "Dead"), isDead: true },
      comment(4, 100, "   "),
    ]);

    expect(ranked.map(({ hnItemId }) => hnItemId)).toEqual([1]);
  });

  it("validates selection bounds", () => {
    expect(() => selectComments(discussion, { maximumComments: 0 })).toThrow(
      "maximumComments must be a positive integer",
    );
  });
});

function comment(
  hnItemId: number,
  parentHnItemId: number,
  text: string,
): RankableComment {
  return {
    hnItemId,
    parentHnItemId,
    author: "fixture",
    text,
    isDeleted: false,
    isDead: false,
  };
}
