import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports that the application is healthy", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("does not expose configuration or secrets", async () => {
    const responseBody = JSON.stringify(await GET().json());

    expect(responseBody).not.toContain("DATABASE_URL");
    expect(responseBody).not.toContain("OPENAI_API_KEY");
    expect(responseBody).not.toContain("process.env");
  });
});
