export default async function NewsletterPreferencesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ token?: string; state?: string }>;
}) {
  const { token, state } = await searchParams;
  const config = getConfig();
  const preferences =
    config.newsletter.publicSignupEnabled && token && state !== "saved"
      ? await getSubscriberPreferences(getDatabase(), config.subscribers, token)
      : null;
  const invalid = state === "invalid" || (state !== "saved" && !preferences);
  return (
    <main id="main-content" className="page newsletter-page" tabIndex={-1}>
      <header className="newsletter-heading">
        <p className="eyebrow">Newsletter preferences</p>
        <h1>Set your reading schedule.</h1>
        <p>
          Pick one edition or both. If you save with neither selected, we’ll
          unsubscribe this address.
        </p>
      </header>
      {state === "saved" ? (
        <p className="newsletter-notice" role="status">
          Your schedule has been saved.
        </p>
      ) : invalid ? (
        <p className="newsletter-notice newsletter-notice--error" role="alert">
          This preference link is expired or unavailable.
        </p>
      ) : null}
      {!invalid && state !== "saved" ? (
        <form
          className="newsletter-form"
          action="/api/newsletter/preferences"
          method="post"
        >
          <input type="hidden" name="token" value={token ?? ""} />
          <fieldset>
            <legend>Active editions</legend>
            <label className="newsletter-choice">
              <input
                type="checkbox"
                name="morning"
                value="1"
                defaultChecked={preferences?.morning}
              />
              <span>
                <strong>Morning</strong>
                <small>7:00 AM Eastern</small>
              </span>
            </label>
            <label className="newsletter-choice">
              <input
                type="checkbox"
                name="evening"
                value="1"
                defaultChecked={preferences?.evening}
              />
              <span>
                <strong>Evening</strong>
                <small>7:00 PM Eastern</small>
              </span>
            </label>
          </fieldset>
          <button type="submit">Save preferences</button>
          <button
            className="button-secondary"
            type="submit"
            name="unsubscribe"
            value="1"
          >
            Unsubscribe from all
          </button>
        </form>
      ) : null}
    </main>
  );
}
import { getConfig } from "../../../config/server";
import { getDatabase } from "../../../db/client";
import { getSubscriberPreferences } from "../../../subscribers/persistence";
