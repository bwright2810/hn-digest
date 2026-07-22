import { describe, expect, it } from "vitest";

import { parseOnDemandStoryCount } from "./on-demand";

describe("parseOnDemandStoryCount", () => {
  it("uses the configured maximum when no count is supplied", () => {
    expect(parseOnDemandStoryCount(undefined, 5)).toBe(5);
  });

  it("accepts an integer within the configured bound", () => {
    expect(parseOnDemandStoryCount("3", 5)).toBe(3);
  });

  it.each(["0", "6", "1.5", "not-a-number"])(
    "rejects an unsafe count of %s",
    (value) => {
      expect(() => parseOnDemandStoryCount(value, 5)).toThrow(
        "story count must be an integer from 1 to 5",
      );
    },
  );
});
