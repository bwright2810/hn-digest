import { describe, expect, it } from "vitest";

import { InvalidCommentCitationError } from "../analysis/citations";
import { workerErrorOutcome } from "./runner";

describe("workerErrorOutcome", () => {
  it("retries one invalid citation response and then stops", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    expect(
      workerErrorOutcome(new InvalidCommentCitationError(), 1, now),
    ).toEqual({
      status: "retry",
      errorCode: "invalid_comment_citation",
      availableAt: now,
    });
    expect(
      workerErrorOutcome(new InvalidCommentCitationError(), 2, now),
    ).toEqual({ status: "failed", errorCode: "invalid_comment_citation" });
  });

  it("retries one incomplete prose boundary response and marks incomplete on attempt 2", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const boundaryError = new Error(
      "Analysis output prose ended at an incomplete boundary",
    );
    expect(workerErrorOutcome(boundaryError, 1, now)).toEqual({
      status: "retry",
      errorCode: "output_boundary",
      availableAt: now,
    });
    expect(workerErrorOutcome(boundaryError, 2, now)).toEqual({
      status: "incomplete",
      errorCode: "output_boundary",
    });
  });

  it("does not retry unrelated worker failures", () => {
    expect(workerErrorOutcome(new TypeError("bad value"), 1)).toEqual({
      status: "failed",
      errorCode: "typeerror",
    });
  });
});
