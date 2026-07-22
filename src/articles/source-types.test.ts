import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { articleSourceType } from "./acquisition";
import { ArticleFetcher } from "./fetcher";

interface SourceTypeFixture {
  readonly name: string;
  readonly contentType: string;
  readonly policy: "extract" | "discussion_only";
}

async function fixtures(): Promise<readonly SourceTypeFixture[]> {
  return JSON.parse(
    await readFile(
      new URL("fixtures/source-types.json", import.meta.url),
      "utf8",
    ),
  ) as SourceTypeFixture[];
}

describe("HD-058 reviewed source types", () => {
  it("classifies the fixture set without retaining source URLs", async () => {
    const reviewed = await fixtures();

    expect(
      reviewed.map(({ contentType }) => articleSourceType(contentType)),
    ).toEqual([
      "plain_text",
      "markdown",
      "pdf",
      "image",
      "audio",
      "structured_data",
    ]);
    expect(JSON.stringify(reviewed)).not.toContain("http");
  });

  it("keeps every deferred fixture explicitly unsupported", async () => {
    const reviewed = (await fixtures()).filter(
      ({ policy }) => policy === "discussion_only",
    );
    for (const fixture of reviewed) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response("synthetic fixture", {
          headers: { "content-type": fixture.contentType },
        }),
      );
      const fetcher = new ArticleFetcher({
        fetch,
        lookup: vi.fn().mockResolvedValue(["93.184.216.34"]),
        maximumBytes: 1_024,
        maximumRedirects: 1,
        timeoutMs: 1_000,
      });

      await expect(
        fetcher.fetch(`https://example.com/${fixture.name}`),
      ).rejects.toMatchObject({
        code: "unsupported_content_type",
        metadata: { contentType: fixture.contentType },
      });
    }
  });
});
