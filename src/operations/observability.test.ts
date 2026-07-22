import { describe, expect, it } from "vitest";

import { evaluateSpendBudget, utcPeriodStarts } from "./observability";

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
