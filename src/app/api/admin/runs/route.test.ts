import { describe, expect, it } from "vitest";

import { adminRunRedirectUrl } from "./route";

describe("adminRunRedirectUrl", () => {
  it("uses the configured public application origin behind a proxy", () => {
    expect(
      adminRunRedirectUrl(
        new URL("https://digest.example.com"),
        "run-id",
        false,
      ).href,
    ).toBe("https://digest.example.com/admin?started=run-id");
  });

  it("marks a coalesced active run", () => {
    expect(
      adminRunRedirectUrl(
        new URL("https://digest.example.com/base"),
        "run id/with punctuation",
        true,
      ).href,
    ).toBe(
      "https://digest.example.com/admin?started=run+id%2Fwith+punctuation&coalesced=1",
    );
  });
});
