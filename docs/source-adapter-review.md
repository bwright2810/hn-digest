# HD-081 alternate source-adapter review

Completed on 2026-07-23 without fetching linked source bodies or invoking an
LLM. This review combines the observed HD-075 production baseline, a bounded
scan of the current 500 Hacker News `topstories`, and a fixture-readiness review
for each gated adapter.

## Production evidence

The retained HD-075 baseline covers 10 digest runs and 70 story occurrences.
That historical output predates the distinct-story field now emitted by
`source:baseline`, so it does not support an overall distinct-story total.
Candidate decisions therefore use the distinct current-story discovery below,
and the known repeated discussion-only cases are called out separately rather
than inferred as unique demand.

| Candidate         | Occurrences | Unsupported occurrences | Incremental recovery |
| ----------------- | ----------: | ----------------------: | -------------------: |
| GitHub repository |           2 |                       0 |                   0% |
| RSS/Atom          |           0 |                       0 |      Not established |
| JSON Feed         |           0 |                       0 |      Not established |

Both observed GitHub repository stories were extracted successfully by the
existing HTML adapter. The production baseline contained no RSS/Atom or JSON
Feed story. Access restrictions and ordinary HTML extraction failures account
for the observed discussion-only results; none is recoverable by HD-077,
HD-078, or HD-079.

## Bounded current-story discovery

`pnpm source:discover 500` completed at `2026-07-23T02:01:33.141Z`. It requested
500 HN items and classified 499 available stories using URL shape only. It did
not follow article links or retain complete URLs.

| Coarse source type | Distinct stories | Eligible distinct stories | Median comments | Median rank |
| ------------------ | ---------------: | ------------------------: | --------------: | ----------: |
| Other web          |              455 |                       200 |               5 |         254 |
| GitHub repository  |               36 |                        12 |               2 |         209 |
| HN text post       |                6 |                         4 |              13 |         229 |
| PDF                |                2 |                         0 |               5 |         267 |
| RSS/Atom           |                0 |                         0 |               — |           — |
| Structured JSON    |                0 |                         0 |               — |           — |

The GitHub count shows current demand for repository pages, but it does not show
incremental demand for a GitHub-specific adapter: existing production evidence
shows those pages are already recoverable through bounded HTML extraction.

## Fixture and security review

No candidate qualifies for implementation, so no candidate parser is selected
and the acceptance requirement for executable selected-adapter fixtures is
vacuous. Before any future activation, its task must add reviewed,
redistribution-safe fixtures covering these cases:

| Candidate | Successful evidence                                                   | Malformed input                              | Oversized input                         | Unsafe input                                                       |
| --------- | --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| GitHub    | README or curated file with repository-relative heading/line evidence | Missing repository, revision, or path        | Response above the shared byte limit    | Private target or unsafe redirect rejected before every request    |
| RSS/Atom  | Deterministically selected entry with stable entry evidence           | Invalid XML and prohibited parser constructs | Feed or entry above explicit limits     | DTD, external entity, XInclude, and parser network access rejected |
| JSON Feed | Versioned JSON Feed entry with stable entry evidence                  | Invalid JSON or unknown schema/version       | Document or entry above explicit limits | Embedded URLs retained as evidence only and never followed         |

These cases preserve the existing shared timeout, redirect, response-size,
content-type, concurrency, and SSRF controls. Generic XML, arbitrary JSON,
repository cloning/traversal, and following embedded URLs remain unsupported.

## Ranked decision

| Candidate         | Frequency             | Expected recovery                              | Evidence fidelity | Effort | Security risk | Decision          |
| ----------------- | --------------------- | ---------------------------------------------- | ----------------- | ------ | ------------- | ----------------- |
| GitHub repository | Moderate in discovery | 0% incremental in observed production outcomes | High              | Medium | Medium        | Keep HD-077 gated |
| RSS/Atom          | None observed         | Not established                                | High              | Medium | High          | Keep HD-078 gated |
| JSON Feed         | None observed         | Not established                                | High              | Medium | Medium        | Keep HD-079 gated |

HD-081 selects no adapter. None meets the required 20% expected incremental
recovery threshold. Discovery and fixture planning supplement the production
outcomes but do not replace them. HD-077 through HD-079 remain gated unless new
measured evidence causes the roadmap decision log to be revised.

## Subsequent owner decision

On 2026-07-23 the owner explicitly activated HD-077 despite this review's
selection result. The roadmap decision log records that override. HD-077 is
limited to one public repository README or one explicitly linked curated text
file per story; the evidence review continues to govern HD-078 and HD-079.
