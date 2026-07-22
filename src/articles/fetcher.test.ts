import { describe, expect, it, vi } from "vitest";

import {
  ArticleFetcher,
  isPublicAddress,
  type ArticleFetcherOptions,
} from "./fetcher";

const publicLookup = vi.fn().mockResolvedValue(["93.184.216.34"]);

function fetcher(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ArticleFetcherOptions> = {},
) {
  return new ArticleFetcher({
    fetch,
    lookup: publicLookup,
    maximumBytes: 64,
    maximumRedirects: 2,
    timeoutMs: 1_000,
    ...overrides,
  });
}

describe("ArticleFetcher", () => {
  it("fetches supported HTML and returns bounded metadata", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("<html>article</html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          etag: '"ignored-fixture-header"',
        },
      }),
    );

    const result = await fetcher(fetch).fetch("https://example.com/article");

    expect(new TextDecoder().decode(result.body)).toBe("<html>article</html>");
    expect(result).toMatchObject({
      sourceUrl: "https://example.com/article",
      finalUrl: "https://example.com/article",
      contentType: "text/html",
      byteLength: 20,
      redirectCount: 0,
      status: 200,
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/article"),
      expect.objectContaining({
        redirect: "manual",
        signal: expect.anything(),
      }),
    );
  });

  it.each(["text/plain", "text/markdown", "text/x-markdown"])(
    "fetches bounded %s documents",
    async (contentType) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response("# A supported text document", {
          headers: { "content-type": `${contentType}; charset=utf-8` },
        }),
      );

      await expect(
        fetcher(fetch).fetch("https://example.com/document"),
      ).resolves.toMatchObject({ contentType, byteLength: 27 });
    },
  );

  it("revalidates redirects and rejects private destinations", async () => {
    const lookup = vi.fn(async (hostname: string) =>
      hostname === "example.com" ? ["93.184.216.34"] : ["127.0.0.1"],
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://internal.example/admin" },
      }),
    );

    await expect(
      fetcher(fetch, { lookup }).fetch("https://example.com"),
    ).rejects.toMatchObject({ code: "unsafe_url" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("rejects non-public address %s", async (url) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(fetcher(fetch).fetch(url)).rejects.toMatchObject({
      code: "unsafe_url",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects any hostname with a non-public DNS answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      fetcher(fetch, {
        lookup: vi.fn().mockResolvedValue(["93.184.216.34", "10.0.0.2"]),
      }).fetch("https://example.com"),
    ).rejects.toMatchObject({ code: "unsafe_url" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops streaming a response once the byte limit is exceeded", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(40));
            controller.enqueue(new Uint8Array(40));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    );

    await expect(
      fetcher(fetch).fetch("https://example.com/large"),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("rejects oversized declared lengths before reading the body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("short fixture", {
        headers: { "content-length": "100", "content-type": "text/html" },
      }),
    );
    await expect(
      fetcher(fetch).fetch("https://example.com/large"),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("rejects unsupported content types and excessive redirects", async () => {
    const mediaFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response("binary", { headers: { "content-type": "image/png" } }),
      );
    await expect(
      fetcher(mediaFetch).fetch("https://example.com/image"),
    ).rejects.toMatchObject({ code: "unsupported_content_type" });

    const redirectFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "/again" } }),
      );
    await expect(
      fetcher(redirectFetch, { maximumRedirects: 1 }).fetch(
        "https://example.com/start",
      ),
    ).rejects.toMatchObject({ code: "redirect_limit" });
    expect(redirectFetch).toHaveBeenCalledTimes(2);
  });

  it("classifies timeouts without exposing request details", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(
      fetcher(fetch).fetch("https://example.com/slow"),
    ).rejects.toMatchObject({ code: "timeout", metadata: {} });
  });

  it("applies the overall timeout to DNS resolution", async () => {
    const lookup = vi.fn(() => new Promise<readonly string[]>(() => undefined));
    await expect(
      fetcher(vi.fn(), { lookup, timeoutMs: 5 }).fetch(
        "https://example.com/slow-dns",
      ),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("isPublicAddress", () => {
  it("accepts only globally routable unicast addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("192.0.2.1")).toBe(false);
    expect(isPublicAddress("not-an-address")).toBe(false);
  });
});
