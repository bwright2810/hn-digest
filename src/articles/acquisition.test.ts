import { describe, expect, it, vi } from "vitest";

import { acquireArticle, type ArticleFetchStore } from "./acquisition";
import { ArticleFetchError, type ArticleFetchResult } from "./fetcher";

const fetchedAt = new Date("2026-07-22T12:00:00Z");
const result: ArticleFetchResult = {
  sourceUrl: "https://example.com/source",
  finalUrl: "https://www.example.com/article",
  contentType: "text/html",
  body: new TextEncoder().encode("article"),
  byteLength: 7,
  redirectCount: 1,
  status: 200,
};

function store() {
  return {
    recordFetch: vi.fn<ArticleFetchStore["recordFetch"]>().mockResolvedValue(),
  };
}

describe("acquireArticle", () => {
  it("persists safe fetch metadata without storing the source body", async () => {
    const fetchStore = store();
    const outcome = await acquireArticle({
      storyId: 42,
      sourceUrl: result.sourceUrl,
      fetcher: { fetch: vi.fn().mockResolvedValue(result) },
      store: fetchStore,
      now: () => fetchedAt,
    });

    expect(outcome).toEqual({ status: "fetched", result });
    expect(fetchStore.recordFetch).toHaveBeenCalledWith({
      storyId: 42,
      sourceUrl: result.sourceUrl,
      canonicalUrl: result.finalUrl,
      status: "pending",
      fetchedAt,
      metadata: {
        fetchStatus: "fetched",
        httpStatus: 200,
        contentType: "text/html",
        sourceType: "html",
        byteLength: 7,
        redirectCount: 1,
      },
    });
    expect(fetchStore.recordFetch.mock.calls[0]?.[0]).not.toHaveProperty(
      "body",
    );
  });

  it("persists classified failures without throwing away the outcome", async () => {
    const fetchStore = store();
    const outcome = await acquireArticle({
      storyId: 42,
      sourceUrl: result.sourceUrl,
      fetcher: {
        fetch: vi.fn().mockRejectedValue(
          new ArticleFetchError("http_status", "unsuccessful response", {
            status: 503,
          }),
        ),
      },
      store: fetchStore,
      now: () => fetchedAt,
    });

    expect(outcome).toEqual({
      status: "failed",
      failureCode: "http_status",
      discussionOnly: true,
    });
    expect(fetchStore.recordFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        metadata: {
          fetchStatus: "failed",
          failureCode: "http_status",
          sourceType: "unknown",
          status: 503,
        },
      }),
    );
  });

  it.each([
    {
      code: "unsupported_content_type" as const,
      metadata: { contentType: "application/pdf" },
      status: "unsupported" as const,
    },
    {
      code: "http_status" as const,
      metadata: { status: 403 },
      status: "access_restricted" as const,
    },
  ])("records $status sources as discussion-only", async (fixture) => {
    const fetchStore = store();
    const outcome = await acquireArticle({
      storyId: 42,
      sourceUrl: result.sourceUrl,
      fetcher: {
        fetch: vi
          .fn()
          .mockRejectedValue(
            new ArticleFetchError(
              fixture.code,
              "unavailable",
              fixture.metadata as unknown as Record<string, string | number>,
            ),
          ),
      },
      store: fetchStore,
      now: () => fetchedAt,
    });

    expect(outcome).toEqual({
      status: fixture.status,
      failureCode: fixture.code,
      discussionOnly: true,
    });
    expect(fetchStore.recordFetch).toHaveBeenCalledWith(
      expect.objectContaining({ status: fixture.status }),
    );
  });

  it("does not misclassify persistence failures as fetch failures", async () => {
    const databaseError = new Error("database unavailable");
    const fetchStore = store();
    fetchStore.recordFetch.mockRejectedValue(databaseError);

    await expect(
      acquireArticle({
        storyId: 42,
        sourceUrl: result.sourceUrl,
        fetcher: { fetch: vi.fn().mockResolvedValue(result) },
        store: fetchStore,
      }),
    ).rejects.toBe(databaseError);
    expect(fetchStore.recordFetch).toHaveBeenCalledTimes(1);
  });
});
