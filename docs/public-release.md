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
- [ ] Verify the private-contact fallback in `SECURITY.md` is available before
      publication. GitHub private vulnerability reporting is unavailable while
      this repository is private on its current plan; enable it and verify the
      unauthenticated reporting link immediately after publication.
- [ ] Review repository collaborators, deploy keys, Actions secrets,
      environments, webhooks, branch protections, and workflow permissions.
      Remove stale access without exposing or rotating credentials in Git.
      If branch rules are unavailable on the current private-repository plan,
      configure and verify them immediately after publication.
- [ ] Confirm no open issue, pull request, commit, tag, branch, or release
      contains a private hostname, personal data, secret, or unnecessary copied
      source material.
- [ ] Confirm CI passes from a clean checkout at the exact release commit.
- [ ] Create a signed or annotated release tag if a versioned release is
      desired; package publication remains out of scope.
- [ ] Have the repository owner explicitly approve the release and use GitHub's
      visibility control. Do not automate or infer this approval.
- [ ] After the repository is public, verify anonymous clone, README links,
      license detection, security reporting, branch protection, Dependabot,
      secret scanning, code scanning, and CI status. GitHub features that are
      plan-gated while private must be enabled before announcing the release.

## 2026-07-23 pre-publication security review

- Full reachable history contains no matches for the reviewed private-key,
  OpenAI, GitHub, AWS, or Slack credential patterns and no blob larger than
  1 MiB.
- The repository has one collaborator, one branch, no deploy keys, webhooks,
  Actions secrets, environments, issues, pull requests, tags, or releases.
- Actions are enabled with read-only default workflow permissions and cannot
  approve pull-request reviews. CI passed at the reviewed commit, including
  headless Playwright.
- Dependabot vulnerability alerts and automated security fixes are enabled.
- Direct `esbuild` is patched to 0.28.1. The remaining moderate audit finding
  is `esbuild` 0.18.20 inside Drizzle Kit's deprecated development-only ESM
  loader. HN Digest does not invoke that dependency as a development server;
  forcing an unsupported transitive override is riskier than retaining the
  build-only tool until Drizzle Kit removes it.
- GitHub rejected private vulnerability reporting, secret scanning, code
  scanning, and branch rules in the current private repository state. These
  controls are post-visibility gates, not waived release requirements.

If a secret is found in history, revoke or rotate it first. Rewriting Git
history is optional cleanup and is never a substitute for credential rotation.
Coordinate any rewrite with all collaborators before force-pushing.
