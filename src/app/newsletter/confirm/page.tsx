import Link from "next/link";

import { getConfig } from "../../../config/server";
import { getDatabase } from "../../../db/client";
import { confirmSubscription } from "../../../subscribers/persistence";

export default async function ConfirmNewsletterPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const config = getConfig();
  const confirmed =
    config.newsletter.publicSignupEnabled && token
      ? await confirmSubscription(
          getDatabase(),
          config.subscribers,
          token,
          config.newsletter.consentPolicyVersion,
        )
      : false;

  return (
    <main id="main-content" className="page newsletter-result" tabIndex={-1}>
      <p className="eyebrow">Newsletter</p>
      <h1>
        {confirmed ? "Subscription confirmed." : "This link is not available."}
      </h1>
      <p>
        {confirmed
          ? "Your selected editions are active. Your first email will include links for changing preferences or unsubscribing."
          : "The link may be expired, replaced, or already invalid. You can request a new confirmation without revealing any subscription status."}
      </p>
      <Link href={confirmed ? "/" : "/newsletter"}>
        {confirmed ? "Read the latest digest" : "Return to newsletter signup"}
      </Link>
    </main>
  );
}
