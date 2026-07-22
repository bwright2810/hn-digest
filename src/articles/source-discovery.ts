import type { HackerNewsStory } from "../hn/schemas";

export type DiscoveredSourceType =
  | "hn_text_post"
  | "github_repository"
  | "github_file"
  | "pdf"
  | "feed"
  | "structured_json"
  | "image"
  | "audio"
  | "video"
  | "other_web";

export interface RankedStorySource {
  readonly rank: number;
  readonly story: HackerNewsStory;
}

export interface SourceDiscoveryMetric {
  readonly sourceType: DiscoveredSourceType;
  readonly count: number;
  readonly medianCommentCount: number;
  readonly medianRank: number;
  readonly eligibleStoryCount: number;
  readonly representativeHnItemIds: readonly number[];
}

export function classifyStorySource(
  story: HackerNewsStory,
): DiscoveredSourceType {
  if (!story.url) return "hn_text_post";
  const url = new URL(story.url);
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (hostname === "github.com" || hostname === "www.github.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 2) return "github_repository";
    if (parts.length >= 4 && ["blob", "raw"].includes(parts[2] ?? "")) {
      return "github_file";
    }
  }
  if (hostname === "raw.githubusercontent.com") return "github_file";
  if (path.endsWith(".pdf")) return "pdf";
  if (/\.(rss|atom|xml)$/u.test(path) || /\/(feed|rss|atom)\/?$/u.test(path)) {
    return "feed";
  }
  if (path.endsWith(".json")) return "structured_json";
  if (/\.(avif|gif|jpe?g|png|webp)$/u.test(path)) return "image";
  if (/\.(aac|flac|m4a|mp3|ogg|wav)$/u.test(path)) return "audio";
  if (/\.(m4v|mov|mp4|webm)$/u.test(path)) return "video";
  return "other_web";
}

export function summarizeStorySources(
  sources: readonly RankedStorySource[],
  minimumCommentCount = 10,
): SourceDiscoveryMetric[] {
  const groups = new Map<DiscoveredSourceType, RankedStorySource[]>();
  for (const source of sources) {
    const sourceType = classifyStorySource(source.story);
    groups.set(sourceType, [...(groups.get(sourceType) ?? []), source]);
  }
  return [...groups.entries()]
    .map(([sourceType, entries]) => ({
      sourceType,
      count: entries.length,
      medianCommentCount: median(
        entries.map(({ story }) => story.descendants ?? 0),
      ),
      medianRank: median(entries.map(({ rank }) => rank)),
      eligibleStoryCount: entries.filter(
        ({ story }) => (story.descendants ?? 0) >= minimumCommentCount,
      ).length,
      representativeHnItemIds: entries.slice(0, 5).map(({ story }) => story.id),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.sourceType.localeCompare(right.sourceType),
    );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}
