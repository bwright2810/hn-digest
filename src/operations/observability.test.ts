import { describe, expect, it, vi } from "vitest";

import {
  collectOperationalSnapshot,
  evaluateSpendBudget,
  utcPeriodStarts,
} from "./observability";

const limits = {
  dailySoftLimitUsd: 2,
  dailyHardLimitUsd: 3,
  monthlySoftLimitUsd: 30,
  monthlyHardLimitUsd: 40,
};

describe("HD-071 spend controls", () => {
  it("allows requests below both hard limits and reports soft limits", () => {
    expect(evaluateSpendBudget(2.1, 31, 0.2, limits)).toMatchObject({
      allowed: true,
      dailySoftLimitReached: true,
      monthlySoftLimitReached: true,
      projectedDailySpendUsd: 2.3,
      reason: null,
    });
  });

  it("blocks a request before it crosses the daily hard limit", () => {
    expect(evaluateSpendBudget(2.9, 20, 0.11, limits)).toMatchObject({
      allowed: false,
      reason: "daily_hard_limit",
    });
  });

  it("blocks a request before it crosses the monthly hard limit", () => {
    expect(evaluateSpendBudget(1, 39.9, 0.11, limits)).toMatchObject({
      allowed: false,
      reason: "monthly_hard_limit",
    });
  });

  it("uses UTC calendar periods for reproducible spend windows", () => {
    expect(utcPeriodStarts(new Date("2026-07-22T23:59:00-04:00"))).toEqual({
      dayStart: new Date("2026-07-23T00:00:00.000Z"),
      monthStart: new Date("2026-07-01T00:00:00.000Z"),
    });
  });
});

describe("HD-058 source acquisition metrics", () => {
  it("returns only coarse source dimensions and classified outcomes", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({
        rows: [
          {
            source_type: "pdf",
            content_type: "application/pdf",
            outcome: "unsupported_content_type",
            count: 7,
          },
          {
            source_type: "html",
            content_type: "text/html",
            outcome: "extraction_failure",
            count: 2,
          },
        ],
      });
    const snapshot = await collectOperationalSnapshot({ execute } as never, {
      from: new Date("2026-07-21T00:00:00Z"),
      now: new Date("2026-07-22T00:00:00Z"),
    });

    expect(snapshot.sourceAcquisition).toEqual([
      {
        sourceType: "pdf",
        contentType: "application/pdf",
        outcome: "unsupported_content_type",
        count: 7,
      },
      {
        sourceType: "html",
        contentType: "text/html",
        outcome: "extraction_failure",
        count: 2,
      },
    ]);
    expect(snapshot.sourceAcquisition).not.toHaveProperty("sourceUrl");
  });
});
