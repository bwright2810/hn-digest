# Contributing to HN Digest

Thank you for helping improve HN Digest. Before starting a substantial change,
open an issue so its scope and roadmap task can be agreed upon. Keep pull
requests focused on one `HD-###` task or a small coherent group.

## Development setup

Use Node.js 24.18.x and pnpm 10.15.1. Docker with Compose is required only for
local PostgreSQL.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Replace the secret placeholders in `.env.local`; never commit that file or any
real credential. See `README.md` for PostgreSQL setup and migration commands.

## Making a change

- Read `ROADMAP.md` and the acceptance criteria for the relevant task.
- Preserve the deterministic pipeline and first-release boundaries described
  in `AGENTS.md`.
- Add or update automated tests for functional changes. Tests must use reviewed
  fixtures rather than live Hacker News or model requests.
- Treat articles, HN content, URLs, and model output as untrusted input.
- Do not add copied source documents, secrets, private hostnames, personal data,
  or generated browser artifacts to the repository.
- Update the roadmap decision log when a material architectural decision
  changes.

For user-interface changes, run the relevant headless Playwright tests at
mobile and desktop sizes in addition to the standard checks.

## Validation

Run every standard check before submitting a pull request:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When UI behavior changes, also run `pnpm test:e2e`. Explain intentional visual
or assertion changes instead of weakening tests broadly.

## Pull requests

Use the relevant `HD-###` ID in the title or commit subject when applicable.
Describe the behavior changed, validation performed, migrations or operational
impact, and any follow-up work. By contributing, you agree that your
contribution is licensed under the repository's MIT License.

Report vulnerabilities privately as described in `SECURITY.md`, not in a
public issue.
