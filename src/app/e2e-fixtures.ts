import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisOutput,
} from "../analysis/contract";
import type { DigestRunView } from "../digests/reader";

const analysis: AnalysisOutput = {
  promptVersion: ANALYSIS_PROMPT_VERSION,
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  article: {
    thesis: {
      claim:
        "A small, carefully measured system can outperform a more elaborate one.",
      citations: [
        { locator: "Results", sourceUrl: "https://example.com/article" },
      ],
    },
    keyPoints: [],
    evidence: [],
    limitations: [],
    confidence: "high" as const,
    sourceQualityNotes: [],
  },
  discussion: {
    consensus: [
      {
        claim:
          "Readers valued the measurements but questioned how broadly they apply.",
        supportingCommentIds: [44000123],
      },
    ],
    competingViewpoints: [],
    insightfulComments: [],
    unresolvedQuestions: [],
    confidence: "medium" as const,
    sourceQualityNotes: [],
  },
  combinedTakeaway: {
    summary:
      "The result is compelling within its tested limits, not a universal rule.",
    tensions: [],
    confidence: "high" as const,
  },
};

const completeRun: DigestRunView = {
  id: "e2e-run",
  status: "complete",
  collectedAt: new Date("2026-07-22T11:00:00Z"),
  createdAt: new Date("2026-07-22T10:59:00Z"),
  requestedStoryCount: 1,
  stories: [
    {
      id: "e2e-story-complete",
      rank: 1,
      title: "What careful measurements reveal about simple systems",
      articleUrl: "https://example.com/article",
      hnUrl: "https://news.ycombinator.com/item?id=44000001",
      score: 312,
      commentCount: 84,
      author: "fixture_reader",
      status: "complete",
      failureCode: null,
      analysis,
    },
  ],
};

export type E2eScenario =
  "complete" | "partial" | "empty" | "unavailable" | "loading";

export async function e2eDigestScenario(name: string | undefined): Promise<{
  run: DigestRunView | null;
  unavailable: boolean;
}> {
  const scenario: E2eScenario =
    name === "partial" ||
    name === "empty" ||
    name === "unavailable" ||
    name === "loading"
      ? name
      : "complete";

  if (scenario === "loading")
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (scenario === "empty") return { run: null, unavailable: false };
  if (scenario === "unavailable") return { run: null, unavailable: true };
  if (scenario === "partial") {
    return {
      unavailable: false,
      run: {
        ...completeRun,
        status: "partial",
        requestedStoryCount: 2,
        stories: [
          ...completeRun.stories,
          {
            id: "e2e-story-failed",
            rank: 2,
            title: "A source that could not be analyzed",
            articleUrl: null,
            hnUrl: "https://news.ycombinator.com/item?id=44000002",
            score: 94,
            commentCount: 20,
            author: null,
            status: "failed",
            failureCode: "ANALYSIS_TERMINAL",
            analysis: null,
          },
        ],
      },
    };
  }
  return { run: completeRun, unavailable: false };
}
