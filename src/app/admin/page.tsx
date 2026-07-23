import { getConfig } from "../../config/server";
import { getDatabase } from "../../db/client";
import {
  collectAdminRuns,
  collectNewsletterDiagnostics,
  type AdminRunView,
  type NewsletterDiagnostics,
} from "../../operations/admin";
import { AdminAutoRefresh } from "./auto-refresh";
import { ActivitySpinner, RunDigestForm } from "./live-controls";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

export default async function AdminPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ started?: string; coalesced?: string }>;
}) {
  const config = getConfig();
  if (
    process.env.PLAYWRIGHT_FIXTURES === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return (
      <AdminDashboard
        runs={adminFixtureRuns}
        maximumStoryCount={config.stories.perRun}
        newsletter={adminFixtureNewsletter}
        {...await searchParams}
      />
    );
  }
  const database = getDatabase();
  const [runs, newsletter] = await Promise.all([
    collectAdminRuns(database),
    collectNewsletterDiagnostics(database),
  ]);
  return (
    <AdminDashboard
      runs={runs}
      maximumStoryCount={config.stories.perRun}
      newsletter={newsletter}
      {...await searchParams}
    />
  );
}

const adminFixtureRuns: readonly AdminRunView[] = [
  {
    id: "fixture-active-run",
    trigger: "on_demand",
    status: "analyzing",
    requestedStoryCount: 10,
    excludedStoryCount: 0,
    excludedHnItemIds: [],
    createdAt: new Date("2026-07-22T11:10:00Z"),
    updatedAt: new Date("2026-07-22T11:12:00Z"),
    errorCode: null,
    failures: [],
  },
  {
    id: "fixture-failed-run",
    trigger: "scheduled",
    status: "partial",
    requestedStoryCount: 2,
    excludedStoryCount: 1,
    excludedHnItemIds: [12345],
    createdAt: new Date("2026-07-22T11:00:00Z"),
    updatedAt: new Date("2026-07-22T11:05:00Z"),
    errorCode: null,
    failures: [
      {
        storyTitle: "A source that could not be validated",
        storyRank: 2,
        storyStatus: "failed",
        storyFailureCode: "invalid_citation",
        jobStatus: "failed",
        jobErrorCode: "invalid_citation",
        attemptStatus: "failed",
        attempt: 1,
        attemptErrorCode: "invalid_citation",
      },
    ],
  },
];

const adminFixtureNewsletter: NewsletterDiagnostics = {
  totals: [
    { status: "sent", count: 18 },
    { status: "failed", count: 1 },
  ],
  recent: [],
};

export function AdminDashboard({
  runs,
  maximumStoryCount,
  newsletter,
  started,
  coalesced,
}: {
  readonly runs: readonly AdminRunView[];
  readonly maximumStoryCount: number;
  readonly newsletter: NewsletterDiagnostics;
  readonly started?: string;
  readonly coalesced?: string;
}) {
  const hasActiveRun = runs.some((run) =>
    ["pending", "collecting", "analyzing"].includes(run.status),
  );
  return (
    <main id="main-content" className="page admin-page" tabIndex={-1}>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Private operator</p>
          <h1>Digest operations.</h1>
        </div>
        <RunDigestForm maximumStoryCount={maximumStoryCount} />
      </section>

      {started ? (
        <p className="operator-notice" role="status">
          {coalesced === "1" ? "Using active run" : "Run queued"}: {started}
        </p>
      ) : null}
      <AdminAutoRefresh active={hasActiveRun} />

      <section className="run-review" aria-labelledby="newsletter-deliveries">
        <div className="section-heading">
          <p className="eyebrow">Newsletter</p>
          <h2 id="newsletter-deliveries">Delivery diagnostics</h2>
        </div>
        <p>
          {newsletter.totals.length === 0
            ? "No newsletter deliveries have been recorded."
            : newsletter.totals
                .map(({ status, count }) => `${status}: ${count}`)
                .join(" · ")}
        </p>
        {newsletter.recent.length > 0 ? (
          <div className="run-table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Updated</th>
                  <th>Edition</th>
                  <th>Status</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {newsletter.recent.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>
                      <time dateTime={delivery.updatedAt.toISOString()}>
                        {dateFormatter.format(delivery.updatedAt)} ET
                      </time>
                    </td>
                    <td>{delivery.edition}</td>
                    <td>
                      {delivery.status}
                      {delivery.providerStatus
                        ? ` · ${delivery.providerStatus}`
                        : ""}
                      {delivery.lastErrorCode
                        ? ` · ${delivery.lastErrorCode}`
                        : ""}
                    </td>
                    <td>
                      <code>{delivery.id}</code>
                      <code>Digest {delivery.digestRunId}</code>
                      <span className="quiet">
                        {delivery.attemptCount} attempt
                        {delivery.attemptCount === 1 ? "" : "s"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="run-review" aria-labelledby="recent-runs">
        <div className="section-heading">
          <p className="eyebrow">Diagnostics</p>
          <h2 id="recent-runs">Recent runs</h2>
        </div>
        {runs.length === 0 ? (
          <p>No runs have been recorded.</p>
        ) : (
          <div className="run-table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Failures</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <time dateTime={run.createdAt.toISOString()}>
                        {dateFormatter.format(run.createdAt)} ET
                      </time>
                      <code>{run.id}</code>
                    </td>
                    <td>{run.trigger.replace("_", " ")}</td>
                    <td>
                      <span className="run-status">
                        <span className={`status status--${run.status}`}>
                          {run.status}
                        </span>
                        {["pending", "collecting", "analyzing"].includes(
                          run.status,
                        ) ? (
                          <ActivitySpinner />
                        ) : null}
                      </span>
                      {run.errorCode ? <code>{run.errorCode}</code> : null}
                      {run.excludedStoryCount > 0 ? (
                        <code>
                          Skipped from previous digest: {run.excludedStoryCount}
                          {" · HN "}
                          {run.excludedHnItemIds.join(", ")}
                        </code>
                      ) : null}
                    </td>
                    <td>
                      {run.failures.length === 0 ? (
                        <span className="quiet">None</span>
                      ) : (
                        <ul className="failure-list">
                          {run.failures.map((failure, index) => (
                            <li key={`${failure.storyRank}-${index}`}>
                              <strong>
                                {failure.storyRank}. {failure.storyTitle}
                              </strong>
                              <code>
                                Story:{" "}
                                {failure.storyFailureCode ??
                                  failure.storyStatus}
                                {failure.jobErrorCode
                                  ? ` · Job: ${failure.jobErrorCode}`
                                  : ""}
                                {failure.attemptErrorCode
                                  ? ` · Attempt ${failure.attempt ?? "?"}: ${failure.attemptErrorCode}`
                                  : ""}
                              </code>
                              <span className="failure-explanation">
                                {explainFailure(
                                  failure.attemptErrorCode ??
                                    failure.jobErrorCode ??
                                    failure.storyFailureCode ??
                                    failure.storyStatus,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export function explainFailure(code: string): string {
  if (code === "Error") {
    return "Legacy generic error; this run predates detailed failure classification.";
  }
  if (code === "invalid_citation" || code === "invalid_comment_citation") {
    return "Model output referenced comment evidence that was not selected for analysis.";
  }
  if (code === "postgres_23505") {
    return "Database uniqueness constraint conflict while saving the analysis.";
  }
  if (code === "postgres_23503") {
    return "Database relationship constraint failed while saving the analysis.";
  }
  if (code === "postgres_23502") {
    return "A required database value was missing while saving the analysis.";
  }
  if (code.startsWith("postgres_")) {
    return `PostgreSQL operation failed with SQLSTATE ${code.slice("postgres_".length).toUpperCase()}.`;
  }
  if (code.startsWith("openai_")) {
    return `OpenAI request failed with provider code ${code.slice("openai_".length)}.`;
  }
  if (code === "unexpected_worker_error") {
    return "Unexpected internal worker failure; no source content or secret was retained.";
  }
  return code.replaceAll("_", " ");
}
