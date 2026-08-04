import { describe, expect, it } from "vitest";

import type { DigestRunView } from "../digests/reader";

import { calendarDateToUtc, mapPublicDigest } from "./digests";

describe("HD-110 public digest representation", () => {
  it("rejects impossible calendar dates", () => {
    expect(calendarDateToUtc("2026-02-29")).toBeNull();
    expect(calendarDateToUtc("2024-02-29")?.toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("maps only public fields in deterministic rank order", () => {
    const digest: DigestRunView = {
      id: "private-run-id",
      status: "complete",
      collectedAt: new Date("2026-07-23T11:05:00Z"),
      createdAt: new Date("2026-07-23T11:00:00Z"),
      requestedStoryCount: 1,
      stories: [
        {
          id: "private-story-id",
          rank: 1,
          title: "Public title",
          articleUrl: "https://example.com/article",
          hnUrl: "https://news.ycombinator.com/item?id=123",
          score: 42,
          commentCount: 12,
          author: "alice",
          status: "complete",
          failureCode: "must-not-leak",
          analysis: null,
        },
      ],
    };
    const result = mapPublicDigest(
      digest,
      "2026-07-23",
      "morning",
      new Date("2026-07-23T11:00:00Z"),
    );
    expect(result.stories.map(({ rank }) => rank)).toEqual([1]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-run-id");
    expect(serialized).not.toContain("private-story-id");
    expect(serialized).not.toContain("must-not-leak");
  });
});
