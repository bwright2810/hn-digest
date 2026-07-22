import { describe, expect, it, vi } from "vitest";

import type { CommentTreeResult } from "../hn/client";
import type { HackerNewsStory } from "../hn/schemas";

import {
  ingestStoryComments,
  normalizeHackerNewsText,
  type CommentIngestionStore,
} from "./comments";

const story: HackerNewsStory = {
  by: "alice",
  descendants: 3,
  id: 100,
  kids: [101, 102],
  score: 50,
  time: 1_720_000_000,
  title: "Story",
  type: "story",
  url: "https://example.com/story",
};

describe("comment ingestion", () => {
  it("normalizes markup, hashes text, and preserves unavailable parents", async () => {
    const fetchedAt = new Date("2026-07-22T12:00:00Z");
    const tree: CommentTreeResult = {
      comments: [
        {
          by: "bob",
          id: 101,
          kids: [103],
          parent: 100,
          text: '<p>Hello &amp; welcome. <a href="https://bad.example">Link</a></p><script>alert(1)</script>',
          time: 1_720_000_010,
          type: "comment",
        },
        {
          by: "carol",
          id: 103,
          parent: 101,
          text: "Child reply",
          time: 1_720_000_020,
          type: "comment",
        },
      ],
      unavailableComments: [
        { id: 102, parent: 100, deleted: true, dead: false },
      ],
      unavailableItemIds: [102],
      failures: [],
    };
    const client = { getCommentDescendants: vi.fn().mockResolvedValue(tree) };
    const store = {
      saveComments: vi
        .fn<CommentIngestionStore["saveComments"]>()
        .mockResolvedValue(),
    };

    const result = await ingestStoryComments({
      story,
      client,
      store,
      now: () => fetchedAt,
    });

    expect(client.getCommentDescendants).toHaveBeenCalledWith([101, 102], 100);
    expect(store.saveComments).toHaveBeenCalledWith({
      storyHnItemId: 100,
      fetchedAt,
      comments: [
        expect.objectContaining({
          hnItemId: 101,
          parentHnItemId: 100,
          text: "Hello & welcome. Link",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({ hnItemId: 103, parentHnItemId: 101 }),
        expect.objectContaining({
          hnItemId: 102,
          parentHnItemId: 100,
          text: null,
          isDeleted: true,
        }),
      ],
    });
    expect(result).toEqual({
      savedCommentCount: 3,
      unavailableItemIds: [102],
      failures: [],
    });
  });

  it("normalizes whitespace and removes unsafe or non-text elements", () => {
    expect(
      normalizeHackerNewsText(
        "<p>First&nbsp;line</p><p>Second   line</p><img src=x onerror=bad>",
      ),
    ).toBe("First line\n\nSecond line");
    expect(normalizeHackerNewsText("<script>bad()</script> ")).toBeNull();
  });
});
