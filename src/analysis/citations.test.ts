import { describe, expect, it } from "vitest";

import { instructionsForCitationAttempt } from "./citations";

describe("instructionsForCitationAttempt", () => {
  it("adds a correction only after the first citation attempt", () => {
    expect(instructionsForCitationAttempt("base", 1)).toBe("base");
    expect(instructionsForCitationAttempt("base", 2)).toContain(
      "CORRECTION ATTEMPT",
    );
    expect(instructionsForCitationAttempt("base", 2)).toContain(
      "must exactly match",
    );
  });
});
