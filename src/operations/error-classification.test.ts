import { describe, expect, it } from "vitest";

import { classifyOperationalError } from "./error-classification";

describe("classifyOperationalError", () => {
  it("preserves provider and PostgreSQL codes without persisting messages", () => {
    expect(
      classifyOperationalError({
        name: "OpenAIAnalysisError",
        message: "request failed with sensitive details",
        code: "rate_limit_exceeded",
      }),
    ).toBe("openai_rate_limit_exceeded");
    expect(
      classifyOperationalError({
        name: "error",
        message: "duplicate value includes private database details",
        code: "23505",
      }),
    ).toBe("postgres_23505");
  });

  it("maps known internal failures and hides unknown messages", () => {
    expect(
      classifyOperationalError(
        new Error("Analysis cited an unselected comment"),
      ),
    ).toBe("invalid_comment_citation");
    expect(classifyOperationalError(new Error("secret source text"))).toBe(
      "unexpected_operational_error",
    );
  });
});
