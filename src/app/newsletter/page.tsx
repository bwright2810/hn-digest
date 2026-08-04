import Link from "next/link";

import { getConfig } from "../../config/server";

export default async function NewsletterPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const enabled = getConfig().newsletter.publicSignupEnabled;
  return (
    <main id="main-content" className="page newsletter-page" tabIndex={-1}>
      <header className="newsletter-heading">
        <p className="eyebrow">Morning, evening, or both</p>
        <h1>Get the edition when you read.</h1>
        <p>
          Choose the morning edition, the evening one, or both. We send the same
          sourced analysis you see here, with links to change your choices or
          unsubscribe in every email.
        </p>
      </header>

      {state === "check-email" ? (
        <NewsletterNotice>
          If that address can receive a confirmation, an email is on its way.
          Check your inbox before the link expires.
        </NewsletterNotice>
      ) : state === "invalid" ? (
        <NewsletterNotice error>
          Enter a valid email address and select at least one edition.
        </NewsletterNotice>
      ) : state === "unavailable" ? (
        <NewsletterNotice error>
          Signup is unavailable right now. Please try again later.
        </NewsletterNotice>
      ) : null}

      {!enabled && !state ? (
        <NewsletterNotice>
          Email signup isn’t open yet. You can keep reading the digest here
          while we finish the launch checks.
        </NewsletterNotice>
      ) : null}

      {enabled ? (
        <form
          className="newsletter-form"
          action="/api/newsletter/signup"
          method="post"
        >
          <label htmlFor="newsletter-email">Email address</label>
          <input
            id="newsletter-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
          <fieldset>
            <legend>Choose your editions</legend>
            <label className="newsletter-choice">
              <input type="checkbox" name="morning" value="1" />
              <span>
                <strong>Morning</strong>
                <small>Prepared for 7:00 AM Eastern</small>
              </span>
            </label>
            <label className="newsletter-choice">
              <input type="checkbox" name="evening" value="1" />
              <span>
                <strong>Evening</strong>
                <small>Prepared for 7:00 PM Eastern</small>
              </span>
            </label>
          </fieldset>
          <p className="newsletter-consent">
            By subscribing, you agree to receive the selected HN Digest
            editions. You can change your choices or unsubscribe at any time.
            See the <Link href="/privacy">privacy notice</Link> for how your
            information is handled.
          </p>
          <button type="submit">Send confirmation</button>
        </form>
      ) : null}
    </main>
  );
}

function NewsletterNotice({
  children,
  error = false,
}: {
  readonly children: React.ReactNode;
  readonly error?: boolean;
}) {
  return (
    <p
      className={`newsletter-notice${error ? " newsletter-notice--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
