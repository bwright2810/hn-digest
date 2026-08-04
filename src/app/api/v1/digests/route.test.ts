import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  readDigest: vi.fn(),
}));

vi.mock("../../../../config/server", () => ({
  getConfig: () => ({
    publicApi: {
      maximumAgeDays: 30,
      rateLimit: 10,
      rateWindowMs: 60_000,
      trustedProxyCidrs: ["10.20.0.0/16"],
    },
    subscribers: { lookupHmacKey: Buffer.alloc(32, 4) },
    schedule: {
      timeZone: "America/New_York",
      morningTime: "07:00",
      eveningTime: "19:00",
    },
  }),
}));
vi.mock("../../../../db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("../../../../public-api/rate-limit", () => ({
  consumePublicApiRateLimit: mocks.consumeRateLimit,
}));
vi.mock("../../../../public-api/digests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../public-api/digests")>()),
  readPublicDigest: mocks.readDigest,
}));

import { GET } from "./route";

describe("HD-110 public digest API route", () => {
  beforeEach(() => {
    mocks.consumeRateLimit.mockReset().mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
    });
    mocks.readDigest.mockReset().mockResolvedValue({
      version: "v1",
      date: localToday(),
      edition: "morning",
      stories: [],
    });
  });

  it("returns a versioned completed digest with rate and cache headers", async () => {
    const response = await GET(request(localToday(), "morning"));
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-remaining")).toBe("9");
    expect(response.headers.get("cache-control")).toContain("s-maxage");
    expect(await response.json()).toMatchObject({
      version: "v1",
      edition: "morning",
    });
  });

  it("documents invalid, future, over-age, and unavailable outcomes", async () => {
    for (const [date, edition, status, code] of [
      ["2026-02-30", "morning", 400, "invalid_date"],
      ["2999-01-01", "morning", 400, "future_date"],
      ["2000-01-01", "morning", 410, "outside_retention_window"],
      [localToday(), "noon", 400, "invalid_request"],
    ] as const) {
      const response = await GET(request(date, edition));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    mocks.readDigest.mockResolvedValueOnce(null);
    const response = await GET(request(localToday(), "evening"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "digest_unavailable" },
    });
  });

  it("counts requests before lookup and fails safely when shared state is unavailable", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    });
    expect((await GET(request(localToday(), "morning"))).status).toBe(429);
    expect(mocks.readDigest).not.toHaveBeenCalled();
    mocks.consumeRateLimit.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const response = await GET(request(localToday(), "morning"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database unavailable");
  });

  function request(date: string, edition: string) {
    return new Request(
      `https://digest.example/api/v1/digests?date=${date}&edition=${edition}`,
      {
        headers: {
          "x-real-ip": "10.20.0.4",
          "x-forwarded-for": "198.51.100.4",
        },
      },
    );
  }

  function localToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }
});
