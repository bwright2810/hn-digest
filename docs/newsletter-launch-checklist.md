# Newsletter production launch checklist

Production signup and delivery must remain disabled until an owner completes
every item below. Record evidence in the private operations system; do not add
addresses, credentials, DNS account details, or provider payloads to this public
repository.

## Sender and provider

- [ ] Record the reviewer and review date.
- [ ] Confirm Resend production access, sending quota, billing alert, and a
      least-privilege API key.
- [ ] Verify the dedicated sending subdomain reports passing SPF and DKIM.
- [ ] Verify DMARC is published, aligned with the From domain, and its reports
      go to an owner-controlled mailbox.
- [ ] Register the production HTTPS webhook for `email.sent`,
      `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`,
      `email.complained`, and `email.suppressed`; store its signing secret only in
      Coolify runtime configuration.

## Consent, privacy, and unsubscribe

- [ ] Publish the reviewed privacy text and record its consent-policy version.
- [ ] Confirm the public operator identity, monitored reply/privacy mailbox,
      and valid postal address appear in both HTML and plain-text messages.
- [ ] Complete a confirmed opt-in with morning-only, evening-only, and both
      preferences, verifying that an unconfirmed address receives no digest.
- [ ] Verify the visible preference/unsubscribe link and RFC 8058 one-click
      POST both suppress the next delivery promptly and remain idempotent.
- [ ] Verify the documented retention cleanup and subscriber export/deletion
      procedures, including suppression preservation and backup aging.

## Delivery and incident readiness

- [ ] Send seed messages to representative mailbox providers and verify the
      canonical digest, article, HN discussion, preference, and unsubscribe links.
- [ ] Replay a signed webhook and confirm only one minimized provider event is
      retained.
- [ ] Test hard-bounce, complaint, suppression, delayed-delivery, provider
      rejection, and outage scenarios without real subscriber data.
- [ ] Confirm private diagnostics show aggregate and internal delivery status,
      while public routes expose no subscriber or provider-event data.
- [ ] Confirm sustained failures and provider rejection create address-free
      operator alerts, and rehearse the documented pause procedure.
- [ ] Restore a current backup into an isolated environment, reapply lifecycle
      deletions/suppressions, and verify sending remains disabled during recovery.

After all checks pass, enable signup first at a deliberately small volume.
Enable scheduled delivery only after confirmation and webhook behavior have
been observed successfully. Record any exception as a new roadmap decision
before launch.
