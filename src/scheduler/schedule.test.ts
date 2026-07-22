import { describe, expect, it } from "vitest";

import { findLatestEligibleSlot, localDateTimeToUtc } from "./schedule";

describe("HD-051 digest schedule", () => {
  it("maps the configured Eastern schedule to UTC across DST", () => {
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 1, day: 15, hour: 7, minute: 0 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-01-15T12:00:00.000Z");
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 7, day: 15, hour: 7, minute: 0 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-07-15T11:00:00.000Z");
  });

  it("selects only the latest due slot after a restart", () => {
    const slot = findLatestEligibleSlot({
      now: new Date("2026-07-22T12:30:00Z"),
      timeZone: "America/New_York",
      times: ["07:00", "19:00"],
      missedRunGraceMs: 6 * 60 * 60 * 1_000,
    });
    expect(slot).toEqual({
      key: "America/New_York|2026-07-22|07:00",
      scheduledFor: new Date("2026-07-22T11:00:00Z"),
      localDate: "2026-07-22",
      localTime: "07:00",
    });
  });

  it("does not backfill a slot older than the grace period", () => {
    expect(
      findLatestEligibleSlot({
        now: new Date("2026-07-22T18:00:00Z"),
        timeZone: "America/New_York",
        times: ["07:00", "19:00"],
        missedRunGraceMs: 6 * 60 * 60 * 1_000,
      }),
    ).toBeNull();
  });

  it("keeps stable local keys while UTC offsets change at DST boundaries", () => {
    const before = findLatestEligibleSlot({
      now: new Date("2026-03-07T12:05:00Z"),
      timeZone: "America/New_York",
      times: ["07:00"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    const after = findLatestEligibleSlot({
      now: new Date("2026-03-08T11:05:00Z"),
      timeZone: "America/New_York",
      times: ["07:00"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    expect(before?.key).toMatch(/2026-03-07\|07:00$/u);
    expect(after?.key).toMatch(/2026-03-08\|07:00$/u);
    expect(before?.scheduledFor.toISOString()).toBe("2026-03-07T12:00:00.000Z");
    expect(after?.scheduledFor.toISOString()).toBe("2026-03-08T11:00:00.000Z");

    const fallBack = findLatestEligibleSlot({
      now: new Date("2026-11-01T12:05:00Z"),
      timeZone: "America/New_York",
      times: ["07:00"],
      missedRunGraceMs: 60 * 60 * 1_000,
    });
    expect(fallBack?.key).toMatch(/2026-11-01\|07:00$/u);
    expect(fallBack?.scheduledFor.toISOString()).toBe(
      "2026-11-01T12:00:00.000Z",
    );
  });
});
