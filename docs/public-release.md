# Public release checklist

This checklist governs the deliberate transition of HN Digest from a private
repository to a public MIT-licensed project. Adding the license does not by
itself authorize a visibility change. The repository owner performs that final
GitHub action only after every pre-release item is complete.

## Completed repository preparation

- [x] Add the MIT `LICENSE` and matching `package.json` license metadata.
- [x] Keep npm publication disabled with `private: true`; public source access
      does not imply an npm package release.
- [x] Document public setup and validation in `README.md`.
- [x] Add contribution guidance in `CONTRIBUTING.md`.
- [x] Add private vulnerability-reporting guidance in `SECURITY.md`.
- [x] Review tracked fixtures. Evaluation cases are synthetic CC0 material;
      article and HN fixtures are short, purpose-specific test inputs rather
      than complete source documents.
- [x] Confirm generated logs, local environment files, Playwright output,
      coverage, build output, and dependencies are ignored.
- [x] Scan every reachable Git revision for common private-key, OpenAI, GitHub,
      AWS, and Slack credential patterns. No matches were found on 2026-07-22.
- [x] Inspect reachable Git history for tracked blobs larger than 1 MiB. No
      matches were found on 2026-07-22.
- [x] Review documentation and examples for secrets, private application
      hostnames, and personal data. The GitHub repository path and documented
      public upstream infrastructure are intentional; deployment hostnames and
      credentials are absent.

The scans above are point-in-time evidence, not a permanent guarantee. Repeat
them immediately before changing visibility because new commits may invalidate
the result.

## Required immediately before visibility changes

- [ ] Pull the final `main` branch and rerun formatting, linting, type-checking,
      unit/integration tests, the production build, and headless Playwright.
- [ ] Rerun dependency and full-history secret scans with current tooling;
      investigate every match rather than relying only on allow-lists.
- [ ] Inspect generated build and browser artifacts for secrets or unnecessarily
      complete source text, then remove those artifacts from the workspace.
- [ ] Verify GitHub private vulnerability reporting is enabled and the link in
      `SECURITY.md` works for an unauthenticated reporter.
- [ ] Review repository collaborators, deploy keys, Actions secrets,
      environments, webhooks, branch protections, and workflow permissions.
      Remove stale access without exposing or rotating credentials in Git.
- [ ] Confirm no open issue, pull request, commit, tag, branch, or release
      contains a private hostname, personal data, secret, or unnecessary copied
      source material.
- [ ] Confirm CI passes from a clean checkout at the exact release commit.
- [ ] Create a signed or annotated release tag if a versioned release is
      desired; package publication remains out of scope.
- [ ] Have the repository owner explicitly approve the release and use GitHub's
      visibility control. Do not automate or infer this approval.
- [ ] After the repository is public, verify anonymous clone, README links,
      license detection, security reporting, branch protection, and CI status.

If a secret is found in history, revoke or rotate it first. Rewriting Git
history is optional cleanup and is never a substitute for credential rotation.
Coordinate any rewrite with all collaborators before force-pushing.
