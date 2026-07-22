# Analysis evaluation

HD-070 defines a fixed, offline evaluation set for comparing prompt, model,
reasoning, selection, and token-budget changes. The canonical cases live in
`src/evaluation/fixtures/cases.json`; their schema, rubric, and comparison
helpers live in `src/evaluation/evaluation.ts`.

## Fixture policy

The 30 versioned cases are original synthetic material released as CC0-1.0.
They cover technical articles, opinion pieces, HN text posts, inaccessible
sources, long discussions, weak discussions, and controversial threads. This
avoids committing unnecessary copyrighted article or comment text and keeps
tests independent of live Hacker News and model APIs.

Each case records expected topics, qualifications, supporting HN comment IDs,
and claims the analysis must not make. These expectations guide human review;
they are not string-match assertions, since wording quality and synthesis
require judgment.

## Rubric and comparison

Review every candidate blind to its model/prompt identity when practical. Score
each dimension from 1 to 5 using the anchors in `evaluationRubric`:

- faithfulness (30%)
- coverage (20%)
- discussion synthesis (15%)
- citation quality (15%)
- concision (10%)
- usefulness (10%)

Use whole-number scores and record a short note for each case. A candidate's
weighted score is on the same 1–5 scale. Compare candidates only when they were
scored on the same case IDs, with the same evaluation-set and rubric versions.
Inspect dimension deltas and individual failures in addition to the aggregate;
a small average gain must not hide a faithfulness regression.

Store completed evaluation results outside source control unless they contain
no provider responses or copyrighted source material. A future benchmark
runner may consume this contract, but HD-070 intentionally performs no paid or
live network requests in CI.
