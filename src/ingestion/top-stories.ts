import { createHash } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getConfig } from "../config/server";
import { getDatabase } from "../db/client";
import {
  digestRuns,
  digestRunStories,
  stories,
  storySnapshots,
} from "../db/schema";
import { HackerNewsClient, type ItemFailure } from "../hn/client";
import type { HackerNewsItem, HackerNewsStory } from "../hn/schemas";
import { normalizeHackerNewsText } from "./comments";

export type IngestionFailureKind = "fetch" | "unavailable" | "not-story";

export interface IngestionFailure {
  readonly itemId: number;
  readonly kind: IngestionFailureKind;
  readonly detail?: ItemFailure["error"]["kind"];
}

export interface TopStoriesIngestionResult {
  readonly runId: string;
  readonly status: "complete" | "partial" | "failed";
  readonly collectedStoryCount: number;
  readonly failures: readonly IngestionFailure[];
}

export interface DigestRunStore {
  createRun(requestedStoryCount: number): Promise<string>;
  startRun?(runId: string, startedAt: Date): Promise<void>;
  saveStory(
    runId: string,
    rank: number,
    story: HackerNewsStory,
    collectedAt: Date,
  ): Promise<void>;
  finishRun(
    runId: string,
    status: TopStoriesIngestionResult["status"],
    collectedAt: Date,
    errorCode: string | null,
  ): Promise<void>;
}

interface TopStoriesClient {
  getTopStoryIds(): Promise<readonly number[]>;
  getItems(
    itemIds: readonly number[],
  ): Promise<readonly (HackerNewsItem | ItemFailure | null)[]>;
}

export async function ingestTopStories(options: {
  readonly storyCount: number;
  readonly minimumCommentCount?: number;
  readonly client: TopStoriesClient;
  readonly store: DigestRunStore;
  readonly now?: () => Date;
  readonly onRunCreated?: (runId: string) => void | Promise<void>;
  readonly existingRunId?: string;
}): Promise<TopStoriesIngestionResult> {
  if (!Number.isInteger(options.storyCount) || options.storyCount <= 0) {
    throw new RangeError("storyCount must be a positive integer");
  }
  const minimumCommentCount = options.minimumCommentCount ?? 0;
  if (!Number.isInteger(minimumCommentCount) || minimumCommentCount < 0) {
    throw new RangeError("minimumCommentCount must be a nonnegative integer");
  }

  const now = options.now ?? (() => new Date());
  const runId =
    options.existingRunId ??
    (await options.store.createRun(options.storyCount));
  if (options.existingRunId) await options.store.startRun?.(runId, now());
  else await options.onRunCreated?.(runId);

  let topStoryIds: readonly number[];
  try {
    topStoryIds = await options.client.getTopStoryIds();
  } catch (error) {
    await options.store.finishRun(runId, "failed", now(), "TOP_STORIES_FETCH");
    throw new TopStoriesIngestionError(runId, error);
  }

  const failures: IngestionFailure[] = [];
  let collectedStoryCount = 0;
  const scanLimit = Math.min(
    topStoryIds.length,
    Math.max(options.storyCount * 10, 50),
  );
  const batchSize = 20;

  for (
    let offset = 0;
    offset < scanLimit && collectedStoryCount < options.storyCount;
    offset += batchSize
  ) {
    const itemIds = topStoryIds.slice(
      offset,
      Math.min(offset + batchSize, scanLimit),
    );
    const results = await options.client.getItems(itemIds);
    for (
      let index = 0;
      index < itemIds.length && collectedStoryCount < options.storyCount;
      index += 1
    ) {
      const itemId = itemIds[index];
      const item = results[index];

      if (item === null) {
        failures.push({ itemId, kind: "unavailable" });
      } else if ("error" in item) {
        failures.push({ itemId, kind: "fetch", detail: item.error.kind });
      } else if (!isAvailableStory(item)) {
        failures.push({ itemId, kind: "not-story" });
      } else if ((item.descendants ?? 0) >= minimumCommentCount) {
        collectedStoryCount += 1;
        await options.store.saveStory(runId, collectedStoryCount, item, now());
      }
    }
  }

  const hasShortfall = collectedStoryCount < options.storyCount;
  const status =
    failures.length === 0 && !hasShortfall ? "complete" : "partial";
  await options.store.finishRun(
    runId,
    status,
    now(),
    failures.length > 0
      ? "STORY_ITEM_FAILURES"
      : hasShortfall
        ? "TOP_STORIES_SHORTFALL"
        : null,
  );

  return { runId, status, collectedStoryCount, failures };
}

export class TopStoriesIngestionError extends Error {
  constructor(
    readonly runId: string,
    options: unknown,
  ) {
    super("Unable to fetch the Hacker News top-stories list", {
      cause: options,
    });
    this.name = "TopStoriesIngestionError";
  }
}

export class ActiveOnDemandRunError extends Error {
  constructor(readonly runId: string) {
    super("An on-demand digest run is already active");
    this.name = "ActiveOnDemandRunError";
  }
}

function isAvailableStory(item: HackerNewsItem): item is HackerNewsStory {
  return item.type === "story" && !item.deleted && !item.dead;
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresDigestRunStore implements DigestRunStore {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly pipelineMode = false,
  ) {}

  async createRun(requestedStoryCount: number): Promise<string> {
    const [run] = await this.database
      .insert(digestRuns)
      .values({
        trigger: "on_demand",
        requestedStoryCount,
        status: "collecting",
      })
      .onConflictDoNothing()
      .returning({ id: digestRuns.id });

    if (!run) {
      const [active] = await this.database
        .select({ id: digestRuns.id })
        .from(digestRuns)
        .where(
          and(
            eq(digestRuns.trigger, "on_demand"),
            inArray(digestRuns.status, ["pending", "collecting", "analyzing"]),
          ),
        )
        .orderBy(desc(digestRuns.createdAt))
        .limit(1);
      if (active) throw new ActiveOnDemandRunError(active.id);
      throw new Error("Failed to create digest run");
    }
    return run.id;
  }

  async startRun(runId: string, startedAt: Date): Promise<void> {
    const updated = await this.database
      .update(digestRuns)
      .set({ status: "collecting", errorCode: null, updatedAt: startedAt })
      .where(and(eq(digestRuns.id, runId), eq(digestRuns.status, "pending")))
      .returning({ id: digestRuns.id });
    if (updated.length === 0) {
      const existing = await this.database.query.digestRuns.findFirst({
        columns: { status: true },
        where: eq(digestRuns.id, runId),
      });
      if (!existing || existing.status !== "collecting") {
        throw new Error("Digest run is not available for collection");
      }
    }
  }

  async saveStory(
    runId: string,
    rank: number,
    story: HackerNewsStory,
    collectedAt: Date,
  ): Promise<void> {
    const normalizedText = normalizeHackerNewsText(story.text);
    const textHash = normalizedText === null ? null : hashText(normalizedText);
    await this.database.transaction(async (transaction) => {
      const [storedStory] = await transaction
        .insert(stories)
        .values({
          hnItemId: story.id,
          type: story.type,
          title: story.title,
          url: story.url ?? null,
          text: normalizedText,
          textHash,
          author: story.by,
          hnCreatedAt: new Date(story.time * 1_000),
          latestScore: story.score ?? 0,
          latestCommentCount: story.descendants ?? 0,
        })
        .onConflictDoUpdate({
          target: stories.hnItemId,
          set: {
            type: story.type,
            title: story.title,
            url: story.url ?? null,
            text: normalizedText,
            textHash,
            author: story.by,
            hnCreatedAt: new Date(story.time * 1_000),
            latestScore: story.score ?? 0,
            latestCommentCount: story.descendants ?? 0,
            updatedAt: collectedAt,
          },
        })
        .returning({ id: stories.id });

      if (!storedStory) throw new Error("Failed to store story");

      const snapshotValues = {
        digestRunId: runId,
        storyId: storedStory.id,
        rank,
        score: story.score ?? 0,
        commentCount: story.descendants ?? 0,
        title: story.title,
        url: story.url ?? null,
        text: normalizedText,
        textHash,
        author: story.by,
        hnCreatedAt: new Date(story.time * 1_000),
        collectedAt,
        metadataHash: storyMetadataHash(story),
      };
      const [snapshot] = await transaction
        .insert(storySnapshots)
        .values(snapshotValues)
        .onConflictDoUpdate({
          target: [storySnapshots.digestRunId, storySnapshots.storyId],
          set: snapshotValues,
        })
        .returning({ id: storySnapshots.id });

      if (!snapshot) throw new Error("Failed to store story snapshot");

      await transaction
        .insert(digestRunStories)
        .values({
          digestRunId: runId,
          storyId: storedStory.id,
          storySnapshotId: snapshot.id,
          rank,
        })
        .onConflictDoUpdate({
          target: [digestRunStories.digestRunId, digestRunStories.storyId],
          set: { rank, storySnapshotId: snapshot.id, updatedAt: collectedAt },
        });
    });
  }

  async finishRun(
    runId: string,
    status: TopStoriesIngestionResult["status"],
    collectedAt: Date,
    errorCode: string | null,
  ): Promise<void> {
    await this.database
      .update(digestRuns)
      .set({
        status:
          this.pipelineMode && status !== "failed" ? "collecting" : status,
        collectedAt,
        errorCode,
        updatedAt: collectedAt,
      })
      .where(eq(digestRuns.id, runId));
  }
}

export function createTopStoriesIngestion() {
  const config = getConfig();
  return (storyCount: number) =>
    ingestTopStories({
      storyCount,
      minimumCommentCount: config.stories.minimumCommentCount,
      client: new HackerNewsClient(),
      store: new PostgresDigestRunStore(),
    });
}

function storyMetadataHash(story: HackerNewsStory): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        author: story.by,
        commentCount: story.descendants ?? 0,
        hnCreatedAt: story.time,
        hnItemId: story.id,
        score: story.score ?? 0,
        title: story.title,
        text: normalizeHackerNewsText(story.text),
        url: story.url ?? null,
      }),
    )
    .digest("hex");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
