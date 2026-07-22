import type { AnalysisOutput } from "../analysis/contract";
import {
  PostgresDigestReader,
  type DigestRunView,
  type DigestStoryView,
} from "../digests/reader";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "America/New_York",
});

export default async function Home() {
  let run: DigestRunView | null = null;
  let unavailable = false;
  try {
    run = await new PostgresDigestReader().latest();
  } catch {
    unavailable = true;
  }

  return <DigestPage run={run} unavailable={unavailable} />;
}

export function DigestPage({
  run,
  unavailable = false,
}: {
  readonly run: DigestRunView | null;
  readonly unavailable?: boolean;
}) {
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <section className="digest-heading" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">The latest edition</p>
          <h1 id="page-title">Today on Hacker News.</h1>
        </div>
        {run ? (
          <div className="run-meta" aria-label="Digest run information">
            <span className={`status status--${run.status}`}>
              {statusLabel(run.status)}
            </span>
            <p>
              {dateFormatter.format(run.collectedAt ?? run.createdAt)} ET
              <br />
              {run.stories.length} of {run.requestedStoryCount} stories
            </p>
          </div>
        ) : null}
      </section>

      {unavailable ? (
        <EmptyState
          label="Temporarily unavailable"
          title="The latest digest could not be loaded."
          detail="The reading archive is still safe. Try again once the service has recovered."
        />
      ) : run === null ? (
        <EmptyState
          label="No editions yet"
          title="The first digest is being prepared."
          detail="Published runs will appear here in ranked reading order."
        />
      ) : run.stories.length === 0 ? (
        <EmptyState
          label={statusLabel(run.status)}
          title={
            run.status === "failed"
              ? "This digest run did not collect any stories."
              : "Stories are still being collected."
          }
          detail="This page will reflect the run as work progresses."
        />
      ) : (
        <ol className="story-list" aria-label="Ranked digest stories">
          {run.stories.map((story) => (
            <li key={story.id}>
              <StoryCard story={story} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function StoryCard({ story }: { readonly story: DigestStoryView }) {
  const analysis = story.analysis;
  const articleSummary = analysis?.article.thesis?.claim ?? null;
  const discussionSummary = summarizeDiscussion(analysis?.discussion);

  return (
    <article className="story-card" aria-labelledby={`story-${story.id}`}>
      <header className="story-card__header">
        <p className="story-rank" aria-label={`Rank ${story.rank}`}>
          {String(story.rank).padStart(2, "0")}
        </p>
        <div>
          <div className="story-kicker">
            <span>{story.score} points</span>
            <span>{story.commentCount} comments</span>
            {story.author ? <span>by {story.author}</span> : null}
          </div>
          <h2 id={`story-${story.id}`}>{story.title}</h2>
          <nav
            className="source-links"
            aria-label={`Sources for ${story.title}`}
          >
            {story.articleUrl ? (
              <a href={story.articleUrl}>Read original</a>
            ) : null}
            <a href={story.hnUrl}>View HN discussion</a>
          </nav>
        </div>
      </header>

      {analysis ? (
        <div className="analysis-grid">
          <AnalysisSection
            label="Article"
            text={articleSummary ?? "No article summary was available."}
          />
          <AnalysisSection label="Discussion" text={discussionSummary}>
            <CommentLinks analysis={analysis} hnUrl={story.hnUrl} />
          </AnalysisSection>
          <section
            className="takeaway"
            aria-labelledby={`takeaway-${story.id}`}
          >
            <p className="section-label">The takeaway</p>
            <h3 id={`takeaway-${story.id}`}>
              {analysis.combinedTakeaway.summary}
            </h3>
          </section>
        </div>
      ) : (
        <StoryState story={story} />
      )}
    </article>
  );
}

function AnalysisSection({
  label,
  text,
  children,
}: {
  readonly label: string;
  readonly text: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <section className="analysis-section">
      <p className="section-label">{label}</p>
      <p>{text}</p>
      {children}
    </section>
  );
}

function CommentLinks({
  analysis,
  hnUrl,
}: {
  readonly analysis: AnalysisOutput;
  readonly hnUrl: string;
}) {
  const ids = citedCommentIds(analysis);
  if (ids.length === 0) return null;
  return (
    <div className="comment-links" aria-label="Cited Hacker News comments">
      <span>Evidence</span>
      {ids.map((id) => (
        <a key={id} href={`${hnUrl}#${id}`}>
          #{id}
        </a>
      ))}
    </div>
  );
}

function StoryState({ story }: { readonly story: DigestStoryView }) {
  const copy =
    story.status === "failed"
      ? "Analysis failed for this story. Its original sources remain available above."
      : story.status === "discussion_only"
        ? "The article could not be extracted. A discussion-only analysis is being prepared."
        : story.status === "complete"
          ? "The stored analysis was invalid and has been withheld."
          : "Collection and analysis are still in progress.";
  return (
    <div
      className="story-state"
      role={story.status === "failed" ? "alert" : "status"}
    >
      <span className={`status status--${story.status}`}>
        {statusLabel(story.status)}
      </span>
      <p>{copy}</p>
      {story.failureCode ? (
        <p className="error-code">Reference: {story.failureCode}</p>
      ) : null}
    </div>
  );
}

function EmptyState({
  label,
  title,
  detail,
}: {
  readonly label: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <section className="notice" aria-labelledby="digest-status">
      <div>
        <p className="eyebrow">{label}</p>
        <h2 id="digest-status">{title}</h2>
      </div>
      <p>{detail}</p>
    </section>
  );
}

function summarizeDiscussion(
  discussion: AnalysisOutput["discussion"] | undefined,
): string {
  if (!discussion) return "No discussion summary was available.";
  const claims = [...discussion.consensus, ...discussion.competingViewpoints];
  return (
    claims[0]?.claim ??
    "The selected discussion did not support a reliable summary."
  );
}

function citedCommentIds(analysis: AnalysisOutput): readonly number[] {
  const ids = new Set<number>();
  for (const claim of [
    ...analysis.discussion.consensus,
    ...analysis.discussion.competingViewpoints,
    ...analysis.discussion.unresolvedQuestions,
  ]) {
    for (const id of claim.supportingCommentIds) ids.add(id);
  }
  for (const comment of analysis.discussion.insightfulComments)
    ids.add(comment.commentId);
  return [...ids].slice(0, 8);
}

function statusLabel(
  status: DigestRunView["status"] | DigestStoryView["status"],
): string {
  return status.replaceAll("_", " ");
}
