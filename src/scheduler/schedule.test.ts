import { describe, expect, it } from "vitest";

import { findLatestEligibleSlot, localDateTimeToUtc } from "./schedule";

describe("HD-051 digest schedule", () => {
  it("maps the configured Eastern schedule to UTC across DST", () => {
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 1, day: 15, hour: 6, minute: 45 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-01-15T11:45:00.000Z");
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 7, day: 15, hour: 6, minute: 45 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-07-15T10:45:00.000Z");
  });

  it("selects only the latest due slot after a restart", () => {
    const slot = findLatestEligibleSlot({
      now: new Date("2026-07-22T12:30:00Z"),
      timeZone: "America/New_York",
      times: ["06:45", "18:45"],
      missedRunGraceMs: 6 * 60 * 60 * 1_000,
    });
    expect(slot).toEqual({
      key: "America/New_York|2026-07-22|06:45",
      scheduledFor: new Date("2026-07-22T10:45:00Z"),
      localDate: "2026-07-22",
      localTime: "06:45",
    });
  });

  it("does not backfill a slot older than the grace period", () => {
    expect(
      findLatestEligibleSlot({
        now: new Date("2026-07-22T18:00:00Z"),
        timeZone: "America/New_York",
        times: ["06:45", "18:45"],
        missedRunGraceMs: 6 * 60 * 60 * 1_000,
      }),
    ).toBeNull();
  });

  it("keeps stable local keys while UTC offsets change at DST boundaries", () => {
    const before = findLatestEligibleSlot({
      now: new Date("2026-03-07T12:05:00Z"),
      timeZone: "America/New_York",
      times: ["06:45"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    const after = findLatestEligibleSlot({
      now: new Date("2026-03-08T11:05:00Z"),
      timeZone: "America/New_York",
      times: ["06:45"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    expect(before?.key).toMatch(/2026-03-07\|06:45$/u);
    expect(after?.key).toMatch(/2026-03-08\|06:45$/u);
    expect(before?.scheduledFor.toISOString()).toBe("2026-03-07T11:45:00.000Z");
    expect(after?.scheduledFor.toISOString()).toBe("2026-03-08T10:45:00.000Z");

    const fallBack = findLatestEligibleSlot({
      now: new Date("2026-11-01T12:05:00Z"),
      timeZone: "America/New_York",
      times: ["06:45"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    expect(fallBack?.key).toMatch(/2026-11-01\|06:45$/u);
    expect(fallBack?.scheduledFor.toISOString()).toBe(
      "2026-11-01T11:45:00.000Z",
    );
  });
});
