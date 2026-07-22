import { describe, expect, it } from "vitest";

import type { HackerNewsStory } from "../hn/schemas";
import { classifyStorySource, summarizeStorySources } from "./source-discovery";

function story(id: number, url?: string, descendants = 10): HackerNewsStory {
  return {
    id,
    type: "story",
    by: "fixture",
    time: 1,
    title: "Fixture",
    url,
    descendants,
  };
}

describe("source discovery", () => {
  it.each([
    [undefined, "hn_text_post"],
    ["https://github.com/example/project", "github_repository"],
    ["https://github.com/example/project/blob/main/readme.md", "github_file"],
    [
      "https://raw.githubusercontent.com/example/project/main/file.ts",
      "github_file",
    ],
    ["https://example.com/paper.pdf?download=1", "pdf"],
    ["https://example.com/feed.xml", "feed"],
    ["https://example.com/feed", "feed"],
    ["https://example.com/article.json", "structured_json"],
    ["https://example.com/image.webp", "image"],
    ["https://example.com/audio.mp3", "audio"],
    ["https://example.com/video.mp4", "video"],
    ["https://example.com/article", "other_web"],
  ] as const)("classifies %s as %s", (url, expected) => {
    expect(classifyStorySource(story(1, url))).toBe(expected);
  });

  it("returns bounded aggregate examples without URLs", () => {
    const result = summarizeStorySources([
      { rank: 1, story: story(101, "https://example.com/one", 30) },
      { rank: 2, story: story(102, "https://example.com/two", 10) },
      { rank: 3, story: story(103, "https://example.com/file.pdf", 20) },
    ]);
    expect(result).toEqual([
      {
        sourceType: "other_web",
        count: 2,
        medianCommentCount: 10,
        medianRank: 1,
        eligibleStoryCount: 2,
        representativeHnItemIds: [101, 102],
      },
      {
        sourceType: "pdf",
        count: 1,
        medianCommentCount: 20,
        medianRank: 3,
        eligibleStoryCount: 1,
        representativeHnItemIds: [103],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("example.com");
  });
});
