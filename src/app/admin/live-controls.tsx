"use client";

import { type FormEvent, useState } from "react";

export function RunDigestForm({
  maximumStoryCount,
}: {
  readonly maximumStoryCount: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!event.currentTarget.checkValidity()) return;
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      if (!response.ok)
        throw new Error(`run request failed: ${response.status}`);
      window.location.reload();
    } catch {
      setSubmissionError("The run could not be queued. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      className="run-form"
      method="post"
      action="/api/admin/runs"
      onSubmit={handleSubmit}
      aria-busy={submitting}
    >
      <label htmlFor="story-count">Stories</label>
      <input
        id="story-count"
        name="storyCount"
        type="number"
        min="1"
        max={maximumStoryCount}
        defaultValue={maximumStoryCount}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? (
          <>
            <ActivitySpinner /> Queuing…
          </>
        ) : (
          "Run digest now"
        )}
      </button>
      {submissionError ? (
        <p className="run-form__error" role="alert">
          {submissionError}
        </p>
      ) : null}
    </form>
  );
}

export function ActivitySpinner() {
  return <span className="activity-spinner" aria-hidden="true" />;
}
