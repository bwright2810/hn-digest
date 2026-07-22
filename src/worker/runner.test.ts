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

  it("does not retry unrelated worker failures", () => {
    expect(workerErrorOutcome(new TypeError("bad value"), 1)).toEqual({
      status: "failed",
      errorCode: "typeerror",
    });
  });
});
