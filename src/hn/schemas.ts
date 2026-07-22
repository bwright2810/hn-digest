import { z } from "zod";

const itemId = z.number().int().positive();
const unixTimestamp = z.number().int().nonnegative();

const itemBase = z.object({
  id: itemId,
  deleted: z.boolean().optional(),
  dead: z.boolean().optional(),
});

const storyItem = itemBase.extend({
  type: z.literal("story"),
  by: z.string(),
  time: unixTimestamp,
  title: z.string(),
  descendants: z.number().int().nonnegative().optional(),
  kids: z.array(itemId).optional(),
  score: z.number().int().optional(),
  text: z.string().optional(),
  url: z.url().optional(),
});

const commentItem = itemBase.extend({
  type: z.literal("comment"),
  by: z.string(),
  time: unixTimestamp,
  parent: itemId,
  kids: z.array(itemId).optional(),
  text: z.string().optional(),
});

const jobItem = itemBase.extend({
  type: z.literal("job"),
  by: z.string(),
  time: unixTimestamp,
  title: z.string(),
  score: z.number().int().optional(),
  text: z.string().optional(),
  url: z.url().optional(),
});

const pollItem = itemBase.extend({
  type: z.literal("poll"),
  by: z.string(),
  time: unixTimestamp,
  title: z.string(),
  descendants: z.number().int().nonnegative().optional(),
  kids: z.array(itemId).optional(),
  parts: z.array(itemId),
  score: z.number().int().optional(),
  text: z.string().optional(),
});

const pollOptionItem = itemBase.extend({
  type: z.literal("pollopt"),
  poll: itemId,
  score: z.number().int().optional(),
  text: z.string(),
  time: unixTimestamp,
});

const unavailableItem = itemBase
  .extend({
    type: z.enum(["story", "comment", "job", "poll", "pollopt"]).optional(),
    kids: z.array(itemId).optional(),
  })
  .refine((item) => item.deleted === true || item.dead === true, {
    message: "an unavailable item must be deleted or dead",
  });

export const hackerNewsItemSchema = z.union([
  unavailableItem,
  storyItem,
  commentItem,
  jobItem,
  pollItem,
  pollOptionItem,
]);

export const topStoryIdsSchema = z.array(itemId);

export type HackerNewsItem = z.infer<typeof hackerNewsItemSchema>;
export type HackerNewsStory = z.infer<typeof storyItem>;
export type HackerNewsComment = z.infer<typeof commentItem>;

export function isComment(item: HackerNewsItem): item is HackerNewsComment {
  return item.type === "comment" && !item.deleted && !item.dead;
}
