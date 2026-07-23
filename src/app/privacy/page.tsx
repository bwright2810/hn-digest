import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main id="main-content" className="page newsletter-page" tabIndex={-1}>
      <header className="newsletter-heading">
        <p className="eyebrow">Privacy notice · newsletter-v1</p>
        <h1>Privacy, in plain language.</h1>
        <p>
          HN Digest controls the personal information used for its optional
          email newsletter. Questions and verified privacy requests can be sent
          to <a href="mailto:privacy@just-dev.us">privacy@just-dev.us</a>.
        </p>
      </header>
      <section className="newsletter-form" aria-label="Privacy details">
        <h2>What is collected</h2>
        <p>
          When you subscribe, HN Digest stores your email address, selected
          editions, confirmation and preference history, consent-policy version,
          and minimized delivery or suppression status. Public signup also uses
          short-lived keyed rate-limit records. The address is encrypted at rest
          and a separate keyed digest prevents duplicates.
        </p>
        <h2>Why it is used</h2>
        <p>
          This information is used only to confirm your request, deliver the
          editions you selected, manage preferences and unsubscribe requests,
          prevent unwanted resubscription, and diagnose delivery failures. It is
          not sold or used for unrelated marketing.
        </p>
        <h2>Service provider and location</h2>
        <p>
          HN Digest sends email through Resend. The recipient address and email
          content are sent to Resend for US-based processing and delivery.
          Resend may retain standard email records for up to 30 days under the
          service configuration reviewed for this release.
        </p>
        <h2>Retention</h2>
        <p>
          Stale unconfirmed subscriptions and ordinary expired tokens are
          removed after seven days. Detailed delivery and minimized provider
          events are retained for up to 90 days. Thirty days after unsubscribe
          or verified deletion, the encrypted address and related detail are
          removed. A keyed address digest, unsubscribe time, suppression reason
          when applicable, and minimal consent-policy evidence remain while the
          newsletter operates so the address is not contacted again. Backups
          expire under the separate backup-retention schedule.
        </p>
        <h2>Your choices</h2>
        <p>
          Every edition includes preference and unsubscribe links. You may
          withdraw consent at any time or email the privacy address to request
          access, correction, export, or deletion. HN Digest may ask you to
          verify control of the address before acting on a request.
        </p>
      </section>
    </main>
  );
}
