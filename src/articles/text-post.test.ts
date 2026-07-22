import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { acquireTextPost, type TextPostDocumentStore } from "./text-post";

function store() {
  return {
    recordTextPost: vi
      .fn<TextPostDocumentStore["recordTextPost"]>()
      .mockResolvedValue(),
  };
}

describe("acquireTextPost", () => {
  it("normalizes and stores an HN text post as article context", async () => {
    const documentStore = store();
    const recordedAt = new Date("2026-07-22T12:00:00Z");
    const outcome = await acquireTextPost({
      storyId: 42,
      hnItemId: 123,
      title: "Ask HN: A fixture",
      html: "<p>First&nbsp;paragraph.</p><p>Second paragraph.</p>",
      store: documentStore,
      now: () => recordedAt,
    });
    const text = "First paragraph.\n\nSecond paragraph.";
    const contentHash = createHash("sha256").update(text).digest("hex");

    expect(outcome).toEqual({
      status: "extracted",
      sourceType: "hn_text_post",
      contentHash,
      text,
    });
    expect(documentStore.recordTextPost).toHaveBeenCalledWith({
      storyId: 42,
      hnItemId: 123,
      title: "Ask HN: A fixture",
      text,
      contentHash,
      recordedAt,
    });
  });

  it("makes an empty text submission explicitly discussion-only", async () => {
    const documentStore = store();
    await expect(
      acquireTextPost({
        storyId: 42,
        hnItemId: 123,
        title: "Ask HN: Empty fixture",
        html: "<script>ignored()</script>",
        store: documentStore,
      }),
    ).resolves.toEqual({
      status: "unsupported",
      sourceType: "empty_text_post",
      discussionOnly: true,
    });
    expect(documentStore.recordTextPost).not.toHaveBeenCalled();
  });
});
