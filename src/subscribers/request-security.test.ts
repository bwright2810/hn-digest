import { describe, expect, it } from "vitest";

import { hasSameOrigin } from "./request-security";

describe("HD-102 request origin validation", () => {
  it("accepts only the configured application origin", () => {
    const applicationUrl = new URL("https://digest.example/base");
    expect(
      hasSameOrigin(
        new Request("https://digest.example/api", {
          headers: { Origin: "https://digest.example" },
        }),
        applicationUrl,
      ),
    ).toBe(true);
    expect(
      hasSameOrigin(
        new Request("https://digest.example/api", {
          headers: { Origin: "https://attacker.example" },
        }),
        applicationUrl,
      ),
    ).toBe(false);
    expect(
      hasSameOrigin(new Request("https://digest.example/api"), applicationUrl),
    ).toBe(false);
  });
});
