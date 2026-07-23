import { z } from "zod";

import { ArticleFetchError, type ArticleFetchResult } from "./fetcher";

interface FetchArticleClient {
  fetch(source: string | URL): Promise<ArticleFetchResult>;
}

interface GitHubSourceRequest {
  readonly owner: string;
  readonly repository: string;
  readonly requestedPath: string | null;
  readonly apiUrl: URL;
}

export interface GitHubSourceFetcherOptions {
  readonly articleFetcher: FetchArticleClient;
  readonly apiFetcher: FetchArticleClient;
  readonly maximumBytes: number;
}

const repositoryPart = /^[A-Za-z0-9_.-]{1,100}$/u;
const refPart = /^[A-Za-z0-9_.-]{1,100}$/u;
const sha = /^[a-f0-9]{40,64}$/u;
const curatedBasenames = new Set([
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
  "rakefile",
]);
const curatedExtensions = new Set([
  ".adoc",
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".ex",
  ".exs",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".mjs",
  ".md",
  ".markdown",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".rst",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const githubFileSchema = z.object({
  type: z.literal("file"),
  encoding: z.literal("base64"),
  content: z.string(),
  size: z.number().int().nonnegative(),
  path: z.string().min(1).max(1_024),
  sha: z.string().regex(sha),
});

export class GitHubSourceFetcher {
  private readonly articleFetcher: FetchArticleClient;
  private readonly apiFetcher: FetchArticleClient;
  private readonly maximumBytes: number;

  constructor(options: GitHubSourceFetcherOptions) {
    this.articleFetcher = options.articleFetcher;
    this.apiFetcher = options.apiFetcher;
    if (!Number.isInteger(options.maximumBytes) || options.maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive integer");
    }
    this.maximumBytes = options.maximumBytes;
  }

  async fetch(source: string | URL): Promise<ArticleFetchResult> {
    const request = githubSourceRequest(source);
    if (!request) return this.articleFetcher.fetch(source);

    const response = await this.apiFetcher.fetch(request.apiUrl);
    const file = parseGitHubFile(response.body);
    const path = normalizedRepositoryPath(file.path);
    if (request.requestedPath === null && !isReadmePath(path)) {
      throw invalidResponse("GitHub returned a non-README repository path");
    }
    if (request.requestedPath !== null && path !== request.requestedPath) {
      throw invalidResponse("GitHub returned a different repository path");
    }
    if (file.size > this.maximumBytes) {
      throw new ArticleFetchError(
        "response_too_large",
        "GitHub source exceeded the size limit",
        { maximumBytes: this.maximumBytes, receivedBytes: file.size },
      );
    }
    const body = decodeBase64(file.content);
    if (body.byteLength !== file.size) {
      throw invalidResponse("GitHub source size did not match its metadata");
    }
    if (body.byteLength > this.maximumBytes) {
      throw new ArticleFetchError(
        "response_too_large",
        "GitHub source exceeded the size limit",
        { maximumBytes: this.maximumBytes, receivedBytes: body.byteLength },
      );
    }

    const canonicalUrl = githubBlobUrl(
      request.owner,
      request.repository,
      file.sha,
      path,
    );
    return {
      sourceUrl: new URL(source).href,
      finalUrl: canonicalUrl.href,
      contentType: isMarkdown(path) ? "text/markdown" : "text/plain",
      body,
      byteLength: body.byteLength,
      redirectCount: response.redirectCount,
      status: response.status,
    };
  }
}

export function githubSourceRequest(
  source: string | URL,
): GitHubSourceRequest | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }
  const parts = decodedPathParts(url);
  const owner = parts[0];
  const repository = parts[1]?.replace(/\.git$/u, "");
  if (
    !owner ||
    !repository ||
    owner === "." ||
    owner === ".." ||
    repository === "." ||
    repository === ".." ||
    !repositoryPart.test(owner) ||
    !repositoryPart.test(repository)
  ) {
    return null;
  }

  if (parts.length === 2) {
    return {
      owner,
      repository,
      requestedPath: null,
      apiUrl: new URL(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/readme`,
      ),
    };
  }

  if (parts[2] !== "blob" || parts.length < 5) return null;
  const ref = parts[3];
  if (!ref || ref === "." || ref === ".." || !refPart.test(ref)) return null;
  const path = normalizedRepositoryPath(parts.slice(4).join("/"));
  if (!isCuratedTextPath(path)) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const apiUrl = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`,
  );
  apiUrl.searchParams.set("ref", ref);
  return { owner, repository, requestedPath: path, apiUrl };
}

function parseGitHubFile(body: Uint8Array) {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw invalidResponse("GitHub returned invalid UTF-8 metadata");
  }
  try {
    return githubFileSchema.parse(JSON.parse(decoded));
  } catch (error) {
    throw invalidResponse("GitHub returned malformed file metadata", error);
  }
}

function decodeBase64(content: string): Uint8Array {
  const compact = content.replaceAll(/\s/gu, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      compact,
    )
  ) {
    throw invalidResponse("GitHub returned invalid base64 content");
  }
  return Uint8Array.from(Buffer.from(compact, "base64"));
}

function decodedPathParts(url: URL): string[] {
  try {
    return url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return [];
  }
}

function normalizedRepositoryPath(path: string): string {
  if (path.length > 1_024 || path.startsWith("/") || path.endsWith("/")) {
    throw invalidResponse("GitHub returned an invalid repository path");
  }
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        /[\u0000-\u001f\u007f]/u.test(part),
    )
  ) {
    throw invalidResponse("GitHub returned an invalid repository path");
  }
  return parts.join("/");
}

function isCuratedTextPath(path: string): boolean {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (curatedBasenames.has(basename)) return true;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && curatedExtensions.has(basename.slice(dot));
}

function isReadmePath(path: string): boolean {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    basename === "readme" ||
    (basename.startsWith("readme.") && isCuratedTextPath(path))
  );
}

function isMarkdown(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function githubBlobUrl(
  owner: string,
  repository: string,
  revision: string,
  path: string,
): URL {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/blob/${revision}/${encodedPath}`,
  );
}

function invalidResponse(message: string, cause?: unknown): ArticleFetchError {
  return new ArticleFetchError(
    "invalid_source_response",
    message,
    {},
    cause === undefined ? undefined : { cause },
  );
}
