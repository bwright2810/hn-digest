import { describe, expect, it, vi } from "vitest";

import { HackerNewsClientError } from "../hn/client";
import type { HackerNewsStory } from "../hn/schemas";

import {
  ingestTopStories,
  TopStoriesIngestionError,
  type DigestRunStore,
} from "./top-stories";

const firstStory = story({ id: 100, score: 80, title: "First" });
const secondStory = story({ id: 200, score: 60, title: "Second" });

function story(
  overrides: Partial<HackerNewsStory> & Pick<HackerNewsStory, "id">,
): HackerNewsStory {
  return {
    by: "alice",
    descendants: 12,
    score: 50,
    time: 1_720_000_000,
    title: "Story",
    type: "story",
    url: `https://example.com/${overrides.id}`,
    ...overrides,
  };
}

function store() {
  return {
    createRun: vi.fn<DigestRunStore["createRun"]>().mockResolvedValue("run-1"),
    saveStory: vi.fn<DigestRunStore["saveStory"]>().mockResolvedValue(),
    finishRun: vi.fn<DigestRunStore["finishRun"]>().mockResolvedValue(),
  };
}

describe("ingestTopStories", () => {
  it("persists the requested top stories in their original rank order", async () => {
    const runStore = store();
    const onRunCreated = vi.fn();
    const client = {
      getTopStoryIds: vi.fn().mockResolvedValue([100, 200, 300]),
      getItems: vi.fn().mockResolvedValue([firstStory, secondStory]),
    };
    const collectedAt = new Date("2026-07-22T12:00:00Z");

    const result = await ingestTopStories({
      storyCount: 2,
      client,
      store: runStore,
      now: () => collectedAt,
      onRunCreated,
    });

    expect(onRunCreated).toHaveBeenCalledWith("run-1");
    expect(client.getItems).toHaveBeenCalledWith([100, 200]);
    expect(runStore.saveStory).toHaveBeenNthCalledWith(
      1,
      "run-1",
      1,
      firstStory,
      collectedAt,
    );
    expect(runStore.saveStory).toHaveBeenNthCalledWith(
      2,
      "run-1",
      2,
      secondStory,
      collectedAt,
    );
    expect(runStore.finishRun).toHaveBeenCalledWith(
      "run-1",
      "complete",
      collectedAt,
      null,
    );
    expect(result).toEqual({
      runId: "run-1",
      status: "complete",
      collectedStoryCount: 2,
      failures: [],
    });
  });

  it("records a partial run while preserving successful stories", async () => {
    const runStore = store();
    const failure = {
      itemId: 200,
      error: new HackerNewsClientError("invalid-response", "invalid item", 200),
    };
    const client = {
      getTopStoryIds: vi.fn().mockResolvedValue([100, 200, 300]),
      getItems: vi.fn().mockResolvedValue([firstStory, failure, null]),
    };

    const result = await ingestTopStories({
      storyCount: 3,
      client,
      store: runStore,
    });

    expect(runStore.saveStory).toHaveBeenCalledTimes(1);
    expect(runStore.finishRun).toHaveBeenCalledWith(
      "run-1",
      "partial",
      expect.any(Date),
      "STORY_ITEM_FAILURES",
    );
    expect(result).toMatchObject({
      status: "partial",
      collectedStoryCount: 1,
      failures: [
        { itemId: 200, kind: "fetch", detail: "invalid-response" },
        { itemId: 300, kind: "unavailable" },
      ],
    });
  });

  it("records a partial run when Hacker News returns fewer stories than requested", async () => {
    const runStore = store();
    const client = {
      getTopStoryIds: vi.fn().mockResolvedValue([100]),
      getItems: vi.fn().mockResolvedValue([firstStory]),
    };

    const result = await ingestTopStories({
      storyCount: 2,
      client,
      store: runStore,
    });

    expect(result).toMatchObject({ status: "partial", collectedStoryCount: 1 });
    expect(runStore.finishRun).toHaveBeenCalledWith(
      "run-1",
      "partial",
      expect.any(Date),
      "TOP_STORIES_SHORTFALL",
    );
  });

  it("marks the run failed when the top-stories list is unavailable", async () => {
    const runStore = store();
    const client = {
      getTopStoryIds: vi.fn().mockRejectedValue(new Error("offline")),
      getItems: vi.fn(),
    };

    await expect(
      ingestTopStories({ storyCount: 2, client, store: runStore }),
    ).rejects.toMatchObject({
      name: "TopStoriesIngestionError",
      runId: "run-1",
    } satisfies Partial<TopStoriesIngestionError>);
    expect(runStore.finishRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      expect.any(Date),
      "TOP_STORIES_FETCH",
    );
  });
});
