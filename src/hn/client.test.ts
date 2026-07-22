import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { HackerNewsClient, HackerNewsClientError } from "./client";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("HackerNewsClient", () => {
  it("fetches and validates top stories and items", async () => {
    const story = await fixture("story");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([100, 99]))
      .mockResolvedValueOnce(jsonResponse(story));
    const client = new HackerNewsClient({ fetch, retries: 0 });

    await expect(client.getTopStoryIds()).resolves.toEqual([100, 99]);
    await expect(client.getItem(100)).resolves.toEqual(story);
  });

  it("reports malformed items without aborting unrelated items", async () => {
    const story = await fixture("story");
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      jsonResponse(String(url).includes("/100.") ? story : { id: "wrong" }),
    );
    const client = new HackerNewsClient({ fetch, retries: 0 });

    const results = await client.getItems([100, 200]);

    expect(results[0]).toEqual(story);
    expect(results[1]).toMatchObject({
      itemId: 200,
      error: { kind: "invalid-response", itemId: 200 },
    });
  });

  it("classifies malformed JSON as an invalid response without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("not JSON", {
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new HackerNewsClient({ fetch, retries: 2 });

    await expect(client.getItem(100)).rejects.toMatchObject({
      kind: "invalid-response",
      itemId: 100,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches deep comment trees iteratively and preserves unavailable items", async () => {
    const fixtures = new Map<number, unknown>([
      [101, await fixture("comment")],
      [102, await fixture("deleted-comment")],
      [103, null],
      [104, await fixture("comment-child")],
      [
        105,
        {
          by: "dave",
          id: 105,
          parent: 102,
          text: "A reply below a deleted comment",
          time: 1720000030,
          type: "comment",
        },
      ],
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const id = Number(/item\/(\d+)/.exec(String(url))?.[1]);
      return jsonResponse(fixtures.get(id));
    });
    const client = new HackerNewsClient({ concurrency: 2, fetch, retries: 0 });

    const result = await client.getCommentDescendants([101, 102, 103], 100);

    expect(result.comments.map(({ id }) => id)).toEqual([101, 104, 105]);
    expect(result.unavailableComments).toEqual([
      { id: 102, parent: 100, deleted: true, dead: false },
    ]);
    expect(result.unavailableItemIds).toEqual([102, 103]);
    expect(result.failures).toEqual([]);
  });

  it("bounds concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const id = Number(/item\/(\d+)/.exec(String(url))?.[1]);
      return jsonResponse({ deleted: true, id, type: "comment" });
    });
    const client = new HackerNewsClient({ concurrency: 2, fetch, retries: 0 });

    await client.getItems([1, 2, 3, 4, 5]);

    expect(maximumActive).toBe(2);
  });

  it("retries transient failures with bounded backoff", async () => {
    const sleep = vi
      .fn<(milliseconds: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([100]));
    const client = new HackerNewsClient({
      fetch,
      retries: 1,
      retryDelayMs: 10,
      sleep,
    });

    await expect(client.getTopStoryIds()).resolves.toEqual([100]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("classifies timeout failures", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const client = new HackerNewsClient({ fetch, retries: 0 });

    await expect(client.getItem(100)).rejects.toMatchObject({
      kind: "timeout",
      itemId: 100,
    } satisfies Partial<HackerNewsClientError>);
  });
});
