import type { AnalysisOutput } from "../analysis/contract";
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

const colors = {
  background: "#f3f0e8",
  canvas: "#fffdf8",
  ink: "#171713",
  muted: "#68675f",
  rule: "#d9d4c8",
  accent: "#d85a32",
  takeaway: "#f1ede2",
} as const;

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
  const storyCount = `${digest.stories.length} ${digest.stories.length === 1 ? "story" : "stories"}`;
  const stories = digest.stories.map((story) => renderStory(story));
  const text = [
    subject,
    storyCount,
    "",
    ...stories.map((story) => story.text).flatMap((value) => [value, ""]),
    `Read this digest: ${links.canonicalDigest.href}`,
    `Manage preferences: ${links.preferences.href}`,
    `Unsubscribe: ${links.unsubscribe.href}`,
    "",
    postalAddress,
  ].join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:20px!important;padding-right:20px!important}.story-title{font-size:25px!important}.digest-title{font-size:34px!important}}a:hover{text-decoration:underline!important}</style></head>
<body style="margin:0;padding:0;background:${colors.background};color:${colors.ink};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">The leading Hacker News stories, articles, and discussion—distilled.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${colors.background};"><tr><td align="center" style="padding:28px 10px;">
<table role="presentation" class="email-shell" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px;max-width:680px;background:${colors.canvas};">
<tr><td class="email-pad" style="padding:38px 42px 30px;border-top:5px solid ${colors.accent};">
<p style="margin:0 0 16px;color:${colors.accent};font-size:12px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;">${escapeHtml(label)} edition · ${escapeHtml(storyCount)}</p>
<h1 class="digest-title" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.05;font-weight:500;letter-spacing:-1px;">HN Digest</h1>
<p style="margin:14px 0 0;color:${colors.muted};font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.55;">What Hacker News is reading, debating, and taking away.</p>
</td></tr>
${stories.map((story) => story.html).join("")}
<tr><td class="email-pad" style="padding:34px 42px;text-align:center;border-top:1px solid ${colors.rule};">
<a href="${escapeAttribute(links.canonicalDigest.href)}" style="display:inline-block;padding:13px 20px;background:${colors.ink};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Read this digest on the web</a>
</td></tr>
<tr><td class="email-pad" style="padding:24px 42px 34px;background:#ebe7dd;color:${colors.muted};font-size:12px;line-height:1.6;text-align:center;">
<p style="margin:0 0 10px;"><a href="${escapeAttribute(links.preferences.href)}" style="color:${colors.ink};text-decoration:underline;">Manage preferences</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${escapeAttribute(links.unsubscribe.href)}" style="color:${colors.ink};text-decoration:underline;">Unsubscribe</a></p>
<p style="margin:0;">${escapeHtml(postalAddress)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

function renderStory(story: DigestStoryView): { html: string; text: string } {
  const article =
    story.analysis?.article.thesis?.claim ??
    (story.status === "failed"
      ? "Analysis was unavailable; the original sources remain available."
      : "No article summary was available.");
  const discussion = summarizeDiscussion(story.analysis?.discussion);
  const takeaway =
    story.analysis?.combinedTakeaway.summary ??
    "A combined takeaway is unavailable for this story.";
  const articleLink = story.articleUrl
    ? `<a href="${escapeAttribute(story.articleUrl)}" style="color:${colors.accent};font-weight:700;text-decoration:none;">Read original</a>&nbsp;&nbsp;·&nbsp;&nbsp;`
    : "";
  const evidence = story.analysis
    ? citedCommentIds(story.analysis)
        .map(
          (id) =>
            `<a href="${escapeAttribute(`${story.hnUrl}#${id}`)}" style="color:${colors.muted};text-decoration:underline;">#${id}</a>`,
        )
        .join("&nbsp; ")
    : "";
  const metadata = [
    `${story.score} points`,
    `${story.commentCount} comments`,
    story.author ? `by ${story.author}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const textEvidence = story.analysis
    ? citedCommentIds(story.analysis)
        .map((id) => `${story.hnUrl}#${id}`)
        .join(", ")
    : "";
  return {
    html: `<tr><td class="email-pad" style="padding:38px 42px 40px;border-top:1px solid ${colors.rule};">
<p style="margin:0 0 9px;color:${colors.accent};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${String(story.rank).padStart(2, "0")} &nbsp; ${escapeHtml(metadata)}</p>
<h2 class="story-title" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.18;font-weight:500;letter-spacing:-0.4px;">${escapeHtml(story.title)}</h2>
<p style="margin:0 0 30px;font-size:13px;line-height:1.5;">${articleLink}<a href="${escapeAttribute(story.hnUrl)}" style="color:${colors.accent};font-weight:700;text-decoration:none;">View HN discussion</a></p>
${renderAnalysisSection("Article", article)}
${renderAnalysisSection("Discussion", discussion, evidence)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:24px;background:${colors.takeaway};"><tr><td style="padding:22px 24px;border-left:3px solid ${colors.accent};">
<p style="margin:0 0 9px;color:${colors.accent};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">The takeaway</p>
<p style="margin:0;color:${colors.ink};font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.6;">${escapeHtml(takeaway)}</p>
</td></tr></table>
</td></tr>`,
    text: `${String(story.rank).padStart(2, "0")}  ${story.title}\n${metadata}\n\nARTICLE\n${article}\n\nDISCUSSION\n${discussion}${textEvidence ? `\nEvidence: ${textEvidence}` : ""}\n\nTHE TAKEAWAY\n${takeaway}\n\n${story.articleUrl ? `Read original: ${story.articleUrl}\n` : ""}View HN discussion: ${story.hnUrl}`,
  };
}

function renderAnalysisSection(
  label: string,
  content: string,
  evidence = "",
): string {
  return `<div style="margin-top:24px;"><p style="margin:0 0 8px;color:${colors.muted};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${label}</p><p style="margin:0;color:${colors.ink};font-size:15px;line-height:1.65;">${escapeHtml(content)}</p>${evidence ? `<p style="margin:10px 0 0;color:${colors.muted};font-size:11px;line-height:1.6;">Evidence&nbsp; ${evidence}</p>` : ""}</div>`;
}

function summarizeDiscussion(
  discussion: AnalysisOutput["discussion"] | undefined,
): string {
  if (!discussion) return "No discussion summary was available.";
  return (
    [...discussion.consensus, ...discussion.competingViewpoints][0]?.claim ??
    "The selected discussion did not support a reliable summary."
  );
}

function citedCommentIds(analysis: AnalysisOutput): readonly number[] {
  const ids = new Set<number>();
  for (const claim of [
    ...analysis.discussion.consensus,
    ...analysis.discussion.competingViewpoints,
    ...analysis.discussion.unresolvedQuestions,
  ])
    for (const id of claim.supportingCommentIds) ids.add(id);
  for (const comment of analysis.discussion.insightfulComments)
    ids.add(comment.commentId);
  return [...ids].slice(0, 8);
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
