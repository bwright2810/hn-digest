import { createHash } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { convert } from "html-to-text";

import { getDatabase } from "../db/client";
import { comments, stories } from "../db/schema";
import type {
  CommentTreeResult,
  HackerNewsClient,
  UnavailableComment,
} from "../hn/client";
import type { HackerNewsComment, HackerNewsStory } from "../hn/schemas";

export interface CommentIngestionStore {
  saveComments(options: {
    readonly storyHnItemId: number;
    readonly comments: readonly NormalizedComment[];
    readonly fetchedAt: Date;
  }): Promise<void>;
}

export interface NormalizedComment {
  readonly hnItemId: number;
  readonly parentHnItemId: number;
  readonly author: string | null;
  readonly text: string | null;
  readonly contentHash: string | null;
  readonly isDeleted: boolean;
  readonly isDead: boolean;
  readonly hnCreatedAt: Date | null;
}

export interface CommentIngestionResult {
  readonly savedCommentCount: number;
  readonly unavailableItemIds: readonly number[];
  readonly failures: CommentTreeResult["failures"];
}

interface CommentClient {
  getCommentDescendants(
    rootItemIds: readonly number[],
    rootParentItemId?: number,
  ): Promise<CommentTreeResult>;
}

export async function ingestStoryComments(options: {
  readonly story: HackerNewsStory;
  readonly client: CommentClient;
  readonly store: CommentIngestionStore;
  readonly now?: () => Date;
}): Promise<CommentIngestionResult> {
  const result = await options.client.getCommentDescendants(
    options.story.kids ?? [],
    options.story.id,
  );
  const normalized = [
    ...result.comments.map(normalizeComment),
    ...result.unavailableComments.map(normalizeUnavailableComment),
  ];

  await options.store.saveComments({
    storyHnItemId: options.story.id,
    comments: normalized,
    fetchedAt: (options.now ?? (() => new Date()))(),
  });

  return {
    savedCommentCount: normalized.length,
    unavailableItemIds: result.unavailableItemIds,
    failures: result.failures,
  };
}

export function normalizeComment(
  comment: HackerNewsComment,
): NormalizedComment {
  const text = normalizeHackerNewsText(comment.text);
  return {
    hnItemId: comment.id,
    parentHnItemId: comment.parent,
    author: comment.by,
    text,
    contentHash: text === null ? null : hashText(text),
    isDeleted: false,
    isDead: false,
    hnCreatedAt: new Date(comment.time * 1_000),
  };
}

function normalizeUnavailableComment(
  comment: UnavailableComment,
): NormalizedComment {
  return {
    hnItemId: comment.id,
    parentHnItemId: comment.parent,
    author: null,
    text: null,
    contentHash: null,
    isDeleted: comment.deleted,
    isDead: comment.dead,
    hnCreatedAt: null,
  };
}

export function normalizeHackerNewsText(html?: string): string | null {
  if (!html) return null;
  const text = convert(html, {
    baseElements: { selectors: ["body"] },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
    wordwrap: false,
  })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type Database = ReturnType<typeof getDatabase>;

export class PostgresCommentStore implements CommentIngestionStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async saveComments(options: {
    readonly storyHnItemId: number;
    readonly comments: readonly NormalizedComment[];
    readonly fetchedAt: Date;
  }): Promise<void> {
    if (options.comments.length === 0) return;

    await this.database.transaction(async (transaction) => {
      const [story] = await transaction
        .select({ id: stories.id })
        .from(stories)
        .where(eq(stories.hnItemId, options.storyHnItemId))
        .limit(1);
      if (!story) throw new Error("Cannot save comments for an unknown story");

      for (const comment of options.comments) {
        await transaction
          .insert(comments)
          .values({
            ...comment,
            storyId: story.id,
            fetchedAt: options.fetchedAt,
            updatedAt: options.fetchedAt,
          })
          .onConflictDoUpdate({
            target: comments.hnItemId,
            set: {
              storyId: story.id,
              parentHnItemId: comment.parentHnItemId,
              author: comment.author,
              text: comment.text,
              contentHash: comment.contentHash,
              isDeleted: comment.isDeleted,
              isDead: comment.isDead,
              hnCreatedAt: comment.hnCreatedAt,
              fetchedAt: options.fetchedAt,
              updatedAt: options.fetchedAt,
            },
          });
      }

      const stored = await transaction
        .select({ id: comments.id, hnItemId: comments.hnItemId })
        .from(comments)
        .where(
          inArray(
            comments.hnItemId,
            options.comments.map(({ hnItemId }) => hnItemId),
          ),
        );
      const ids = new Map(stored.map(({ hnItemId, id }) => [hnItemId, id]));

      for (const comment of options.comments) {
        await transaction
          .update(comments)
          .set({
            parentCommentId: ids.get(comment.parentHnItemId) ?? null,
          })
          .where(eq(comments.hnItemId, comment.hnItemId));
      }
    });
  }
}

export function createCommentIngestion(client: HackerNewsClient) {
  const store = new PostgresCommentStore();
  return (story: HackerNewsStory) =>
    ingestStoryComments({ story, client, store });
}
