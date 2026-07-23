import { describe, expect, it, vi } from "vitest";

import { ArticleFetchError, type ArticleFetchResult } from "./fetcher";
import { GitHubSourceFetcher, githubSourceRequest } from "./github";

const encoder = new TextEncoder();
const revision = "a".repeat(40);

function apiResult(value: unknown): ArticleFetchResult {
  const body = encoder.encode(JSON.stringify(value));
  return {
    sourceUrl: "https://api.github.com/repos/example/project/readme",
    finalUrl: "https://api.github.com/repos/example/project/readme",
    contentType: "application/json",
    body,
    byteLength: body.byteLength,
    redirectCount: 0,
    status: 200,
  };
}

function githubFile(path: string, content: string) {
  const body = encoder.encode(content);
  return {
    type: "file",
    encoding: "base64",
    content: Buffer.from(body).toString("base64"),
    size: body.byteLength,
    path,
    sha: revision,
  };
}

function subject(response: ArticleFetchResult, maximumBytes = 1_024) {
  return {
    articleFetch: vi.fn(),
    apiFetch: vi.fn().mockResolvedValue(response),
    fetcher: new GitHubSourceFetcher({
      articleFetcher: { fetch: vi.fn() },
      apiFetcher: { fetch: vi.fn().mockResolvedValue(response) },
      maximumBytes,
    }),
  };
}

describe("GitHub source request classification", () => {
  it("maps repository roots to one README request", () => {
    expect(
      githubSourceRequest("https://github.com/example/project"),
    ).toMatchObject({
      owner: "example",
      repository: "project",
      requestedPath: null,
      apiUrl: new URL("https://api.github.com/repos/example/project/readme"),
    });
    expect(
      githubSourceRequest("https://www.github.com/example/project"),
    ).not.toBeNull();
  });

  it("maps one explicit curated file without traversing the repository", () => {
    expect(
      githubSourceRequest(
        "https://github.com/example/project/blob/main/src/worker.ts",
      ),
    ).toMatchObject({
      requestedPath: "src/worker.ts",
      apiUrl: new URL(
        "https://api.github.com/repos/example/project/contents/src/worker.ts?ref=main",
      ),
    });
  });

  it.each([
    "https://github.com/example/project/tree/main/src",
    "https://github.com/example/project/issues/1",
    "https://github.com/example/project/blob/main/image.png",
    "https://gitlab.com/example/project",
    "http://github.com/example/project",
    "https://user:password@github.com/example/project",
    "https://github.com:8443/example/project",
  ])("does not claim unsupported GitHub source %s", (url) => {
    expect(githubSourceRequest(url)).toBeNull();
  });
});

describe("GitHubSourceFetcher", () => {
  it("extracts a repository README and pins its canonical URL to the file SHA", async () => {
    const content = "# Example\n\nA bounded README fixture.";
    const response = apiResult(githubFile("README.md", content));
    const apiFetch = vi.fn().mockResolvedValue(response);
    const articleFetch = vi.fn();
    const fetcher = new GitHubSourceFetcher({
      articleFetcher: { fetch: articleFetch },
      apiFetcher: { fetch: apiFetch },
      maximumBytes: 1_024,
    });

    const result = await fetcher.fetch("https://github.com/example/project");

    expect(apiFetch).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/example/project/readme"),
    );
    expect(articleFetch).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(result.body)).toBe(content);
    expect(result).toMatchObject({
      sourceUrl: "https://github.com/example/project",
      finalUrl: `https://github.com/example/project/blob/${revision}/README.md`,
      contentType: "text/markdown",
      byteLength: encoder.encode(content).byteLength,
    });
  });

  it("preserves an explicit repository-relative source path", async () => {
    const content = "export const bounded = true;";
    const response = apiResult(githubFile("src/worker.ts", content));
    const apiFetch = vi.fn().mockResolvedValue(response);
    const fetcher = new GitHubSourceFetcher({
      articleFetcher: { fetch: vi.fn() },
      apiFetcher: { fetch: apiFetch },
      maximumBytes: 1_024,
    });

    await expect(
      fetcher.fetch(
        "https://github.com/example/project/blob/main/src/worker.ts",
      ),
    ).resolves.toMatchObject({
      finalUrl: `https://github.com/example/project/blob/${revision}/src/worker.ts`,
      contentType: "text/plain",
    });
  });

  it("falls back to ordinary article fetching for unselected GitHub pages", async () => {
    const ordinary = apiResult({ ordinary: true });
    const articleFetch = vi.fn().mockResolvedValue(ordinary);
    const apiFetch = vi.fn();
    const fetcher = new GitHubSourceFetcher({
      articleFetcher: { fetch: articleFetch },
      apiFetcher: { fetch: apiFetch },
      maximumBytes: 1_024,
    });
    const url = "https://github.com/example/project/issues/1";

    await expect(fetcher.fetch(url)).resolves.toBe(ordinary);
    expect(articleFetch).toHaveBeenCalledWith(url);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed, mismatched, and oversized API responses", async () => {
    const malformed = subject(apiResult({ type: "directory" })).fetcher;
    await expect(
      malformed.fetch("https://github.com/example/project"),
    ).rejects.toMatchObject({ code: "invalid_source_response" });

    const mismatched = subject(
      apiResult(githubFile("src/other.ts", "fixture")),
    ).fetcher;
    await expect(
      mismatched.fetch(
        "https://github.com/example/project/blob/main/src/worker.ts",
      ),
    ).rejects.toMatchObject({ code: "invalid_source_response" });

    const oversized = subject(
      apiResult({ ...githubFile("README.md", "fixture"), size: 2_000 }),
      1_024,
    ).fetcher;
    await expect(
      oversized.fetch("https://github.com/example/project"),
    ).rejects.toMatchObject({
      code: "response_too_large",
      metadata: { maximumBytes: 1_024, receivedBytes: 2_000 },
    });

    const invalidBase64 = subject(
      apiResult({
        ...githubFile("README.md", "fixture"),
        content: "not base64!",
      }),
    ).fetcher;
    await expect(
      invalidBase64.fetch("https://github.com/example/project"),
    ).rejects.toMatchObject({ code: "invalid_source_response" });

    const notReadme = subject(
      apiResult(githubFile("src/worker.ts", "fixture")),
    ).fetcher;
    await expect(
      notReadme.fetch("https://github.com/example/project"),
    ).rejects.toMatchObject({ code: "invalid_source_response" });
  });

  it("preserves bounded fetch failures without retrying through another path", async () => {
    const failure = new ArticleFetchError("unsafe_url", "unsafe redirect");
    const apiFetch = vi.fn().mockRejectedValue(failure);
    const articleFetch = vi.fn();
    const fetcher = new GitHubSourceFetcher({
      articleFetcher: { fetch: articleFetch },
      apiFetcher: { fetch: apiFetch },
      maximumBytes: 1_024,
    });

    await expect(
      fetcher.fetch("https://github.com/example/project"),
    ).rejects.toBe(failure);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(articleFetch).not.toHaveBeenCalled();
  });
});
