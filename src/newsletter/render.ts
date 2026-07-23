import type { DigestRunView, DigestStoryView } from "../digests/reader";

export interface NewsletterLinks {
  readonly canonicalDigest: URL;
  readonly preferences: URL;
  readonly unsubscribe: URL;
}

export interface RenderedNewsletter {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export function renderNewsletter(
  digest: DigestRunView,
  edition: "morning" | "evening",
  links: NewsletterLinks,
  postalAddress: string,
): RenderedNewsletter {
  if (digest.status !== "complete" && digest.status !== "partial") {
    throw new RangeError("digest is not deliverable");
  }
  const label = edition === "morning" ? "Morning" : "Evening";
  const subject = `${label} HN Digest`;
  const stories = digest.stories.map((story) => renderStory(story));
  const text = [
    subject,
    "",
    ...stories.map((story) => story.text).flatMap((value) => [value, ""]),
    `Read this digest: ${links.canonicalDigest.href}`,
    `Manage preferences: ${links.preferences.href}`,
    `Unsubscribe: ${links.unsubscribe.href}`,
    "",
    postalAddress,
  ].join("\n");
  const html = `<!doctype html><html><body><main><h1>${escapeHtml(subject)}</h1>${stories
    .map((story) => story.html)
    .join(
      "",
    )}<p><a href="${escapeAttribute(links.canonicalDigest.href)}">Read this digest on the web</a></p></main><footer><p><a href="${escapeAttribute(links.preferences.href)}">Manage preferences</a> · <a href="${escapeAttribute(links.unsubscribe.href)}">Unsubscribe</a></p><p>${escapeHtml(postalAddress)}</p></footer></body></html>`;
  return { subject, html, text };
}

function renderStory(story: DigestStoryView): { html: string; text: string } {
  const summary =
    story.analysis?.combinedTakeaway.summary ??
    (story.status === "failed"
      ? "Analysis was unavailable; the original sources remain available."
      : "Analysis is unavailable for this story.");
  const articleLink = story.articleUrl
    ? `<a href="${escapeAttribute(story.articleUrl)}">Original article</a> · `
    : "";
  return {
    html: `<article><h2>${story.rank}. ${escapeHtml(story.title)}</h2><p>${escapeHtml(summary)}</p><p>${articleLink}<a href="${escapeAttribute(story.hnUrl)}">HN discussion</a></p></article>`,
    text: `${story.rank}. ${story.title}\n${summary}\n${story.articleUrl ? `Original article: ${story.articleUrl}\n` : ""}HN discussion: ${story.hnUrl}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
