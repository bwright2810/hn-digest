# HD-075 initial source-adapter baseline

Generated on 2026-07-22 from 10 production digest runs and 70 story
occurrences. This report satisfies the initial HD-075 gate (`ready: true`,
`roadmapReady: true`) but not the 30-run adapter-enablement gate
(`extendedReady: false`). It contains no source bodies or complete URLs.

## Aggregate outcomes

| Source class              | Outcome            | Occurrences | Median comments | Median rank |
| ------------------------- | ------------------ | ----------: | --------------: | ----------: |
| HTML                      | Extracted          |          50 |              17 |           4 |
| Access-restricted/unknown | Discussion-only    |           7 |             956 |           4 |
| HTML                      | Low confidence     |           6 |              34 |           1 |
| HTML                      | Extraction failure |           4 |              79 |           2 |
| GitHub repository         | Extracted          |           2 |              35 |           2 |
| Markdown                  | Extracted          |           1 |              11 |           8 |

The initial discussion-only share is 11/70 (15.7%). Access restrictions
account for 63.6% of those outcomes and HTML extraction failures account for
36.4%. No PDF, RSS/Atom, JSON Feed, GitHub-file, image, audio, or video failure
was observed in this sample.

## Candidate review

Repeated occurrences represent two distinct access-restricted stories and one
distinct empty-extraction story. Scores use a five-point scale for observed frequency, discussion value,
expected recovery, evidence fidelity, and inverse implementation/risk cost.
They are directional because the sample is below the roadmap gate.

| Candidate                       | Frequency | Value | Recovery | Evidence | Cost/risk | Decision                                                           |
| ------------------------------- | --------: | ----: | -------: | -------: | --------: | ------------------------------------------------------------------ |
| Access-restricted HTML metadata |         5 |     5 |        2 |        2 |         3 | Add reviewed fixtures; do not select yet                           |
| HTML extraction fallback        |         3 |     4 |        3 |        4 |         4 | Investigate failure fixtures before adding a task                  |
| GitHub repository adapter       |         1 |     3 |        1 |        5 |         3 | Do not select; existing HTML extraction recovered both occurrences |
| RSS/Atom                        |         0 |     0 |        0 |        4 |         2 | Not observed; keep gated                                           |
| JSON Feed                       |         0 |     0 |        0 |        4 |         3 | Not observed; keep gated                                           |

## Provisional decision

HD-075 is complete with no new format adapter selected from this initial
sample. The next useful test is a
reviewed, redistribution-safe fixture set for the seven access-restricted and
four extraction-failure classes, using only bounded classifications and no
production source bodies. The extended review remains due when 30 varied runs
are available; it may supersede these rankings before any adapter is enabled.
