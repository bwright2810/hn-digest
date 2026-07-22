import type { z } from "zod";

import {
  hackerNewsItemSchema,
  isComment,
  topStoryIdsSchema,
  type HackerNewsComment,
  type HackerNewsItem,
} from "./schemas";

const DEFAULT_BASE_URL = "https://hacker-news.firebaseio.com/v0/";

export type HackerNewsErrorKind =
  "timeout" | "network" | "http" | "invalid-response";

export class HackerNewsClientError extends Error {
  constructor(
    readonly kind: HackerNewsErrorKind,
    message: string,
    readonly itemId?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HackerNewsClientError";
  }
}

export interface ItemFailure {
  readonly itemId: number;
  readonly error: HackerNewsClientError;
}

export interface CommentTreeResult {
  readonly comments: readonly HackerNewsComment[];
  readonly unavailableComments: readonly UnavailableComment[];
  readonly unavailableItemIds: readonly number[];
  readonly failures: readonly ItemFailure[];
}

export interface UnavailableComment {
  readonly id: number;
  readonly parent: number;
  readonly deleted: boolean;
  readonly dead: boolean;
}

export interface HackerNewsClientOptions {
  readonly baseUrl?: string | URL;
  readonly concurrency?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class HackerNewsClient {
  private readonly baseUrl: URL;
  private readonly concurrency: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: HackerNewsClientOptions = {}) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.concurrency = requireNonnegativeInteger(
      options.concurrency ?? 8,
      "concurrency",
      true,
    );
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.retries = requireNonnegativeInteger(options.retries ?? 2, "retries");
    this.retryDelayMs = requireNonnegativeInteger(
      options.retryDelayMs ?? 250,
      "retryDelayMs",
    );
    this.timeoutMs = requireNonnegativeInteger(
      options.timeoutMs ?? 5_000,
      "timeoutMs",
      true,
    );
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async getTopStoryIds(): Promise<readonly number[]> {
    return this.request("topstories.json", topStoryIdsSchema);
  }

  async getItem(itemId: number): Promise<HackerNewsItem | null> {
    requireNonnegativeInteger(itemId, "itemId", true);
    return this.request(
      `item/${itemId}.json`,
      hackerNewsItemSchema.nullable(),
      itemId,
    );
  }

  async getItems(
    itemIds: readonly number[],
  ): Promise<readonly (HackerNewsItem | ItemFailure | null)[]> {
    return mapWithConcurrency(itemIds, this.concurrency, async (itemId) => {
      try {
        return await this.getItem(itemId);
      } catch (error) {
        return { itemId, error: asClientError(error, itemId) };
      }
    });
  }

  async getCommentDescendants(
    rootItemIds: readonly number[],
    rootParentItemId?: number,
  ): Promise<CommentTreeResult> {
    const pending = rootItemIds.map((id) => ({
      id,
      parent: rootParentItemId,
    }));
    const visited = new Set<number>();
    const comments: HackerNewsComment[] = [];
    const unavailableComments: UnavailableComment[] = [];
    const unavailableItemIds: number[] = [];
    const failures: ItemFailure[] = [];

    while (pending.length > 0) {
      const batch = pending.splice(0, this.concurrency);
      const unvisited = batch.filter(({ id }) => {
        if (visited.has(id)) return false;
        visited.add(id);
        return true;
      });
      const results = await this.getItems(unvisited.map(({ id }) => id));

      results.forEach((result, index) => {
        const { id: itemId, parent } = unvisited[index];
        if (result === null) {
          unavailableItemIds.push(itemId);
        } else if (isItemFailure(result)) {
          failures.push(result);
        } else if (result.deleted || result.dead) {
          unavailableItemIds.push(itemId);
          if (parent !== undefined && result.type === "comment") {
            unavailableComments.push({
              id: itemId,
              parent,
              deleted: result.deleted === true,
              dead: result.dead === true,
            });
          }
          if ("kids" in result) {
            pending.push(
              ...(result.kids ?? []).map((id) => ({ id, parent: itemId })),
            );
          }
        } else if (isComment(result)) {
          comments.push(result);
          pending.push(
            ...(result.kids ?? []).map((id) => ({ id, parent: itemId })),
          );
        }
      });
    }

    return { comments, unavailableComments, unavailableItemIds, failures };
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    itemId?: number,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImplementation(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          throw new HackerNewsClientError(
            "http",
            `Hacker News returned HTTP ${response.status}`,
            itemId,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          throw new HackerNewsClientError(
            "invalid-response",
            "Hacker News returned invalid JSON",
            itemId,
            { cause: error },
          );
        }

        const result = schema.safeParse(payload);
        if (!result.success) {
          throw new HackerNewsClientError(
            "invalid-response",
            "Hacker News returned an invalid response",
            itemId,
            { cause: result.error },
          );
        }

        return result.data;
      } catch (error) {
        const clientError = asClientError(error, itemId);
        if (attempt === this.retries || !isRetryable(clientError)) {
          throw clientError;
        }
        await this.sleep(this.retryDelayMs * 2 ** attempt);
      }
    }

    throw new Error("unreachable");
  }
}

function isItemFailure(
  value: HackerNewsItem | ItemFailure,
): value is ItemFailure {
  return "error" in value;
}

function asClientError(error: unknown, itemId?: number): HackerNewsClientError {
  if (error instanceof HackerNewsClientError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new HackerNewsClientError(
      "timeout",
      "Hacker News request timed out",
      itemId,
      { cause: error },
    );
  }
  return new HackerNewsClientError(
    "network",
    "Hacker News request failed",
    itemId,
    { cause: error },
  );
}

function isRetryable(error: HackerNewsClientError): boolean {
  return error.kind !== "invalid-response";
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(inputs[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
  );
  return results;
}

function requireNonnegativeInteger(
  value: number,
  name: string,
  positive = false,
): number {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0)) {
    throw new RangeError(
      `${name} must be ${positive ? "a positive" : "a nonnegative"} integer`,
    );
  }
  return value;
}
