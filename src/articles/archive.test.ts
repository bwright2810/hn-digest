import { describe, expect, it } from "vitest";

import { InternetArchiveFallbackFetcher, parseSnapshot } from "./archive";

const options = {
  timeoutMs: 1_000,
  maximumBytes: 10_000,
  maximumRedirects: 2,
  lookup: async () => ["207.241.224.2"],
};

describe("InternetArchiveFallbackFetcher", () => {
  it("selects one bounded HTML snapshot and preserves the original source URL", async () => {
    const fetcher = new InternetArchiveFallbackFetcher({
      ...options,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/cdx/search/cdx")) {
          return new Response(
            JSON.stringify([
              ["timestamp", "mimetype", "statuscode"],
              ["20240722120000", "text/html", "200"],
            ]),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response("<html><p>Archived article</p></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });

    const result = await fetcher.fetch("https://example.com/article");

    expect(result.sourceUrl).toBe("https://example.com/article");
    expect(result.finalUrl).toContain("web.archive.org/web/20240722120000id_");
    expect(new TextDecoder().decode(result.body)).toContain("Archived article");
  });

  it("rejects malformed archive metadata and unsupported snapshots", () => {
    expect(() => parseSnapshot(new TextEncoder().encode("not-json"))).toThrow(
      "Archive returned malformed metadata",
    );
    expect(
      parseSnapshot(
        new TextEncoder().encode(
          JSON.stringify([["timestamp", "mimetype", "statuscode"]]),
        ),
      ),
    ).toBeNull();
  });
});
