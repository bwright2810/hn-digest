import { beforeEach, describe, expect, it, vi } from "vitest";

const { reissue } = vi.hoisted(() => ({ reissue: vi.fn() }));

vi.mock("../../../../../config/server", () => ({
  getConfig: () => ({
    application: { url: new URL("https://digest.example") },
  }),
}));
vi.mock("../../../../../db/client", () => ({
  getDatabase: () => ({ fixture: true }),
}));
vi.mock("../../../../../newsletter/reissue", () => ({
  reissueNewsletterDelivery: reissue,
}));

import { POST } from "./route";

describe("newsletter delivery reissue route", () => {
  beforeEach(() => reissue.mockReset());

  it("rejects cross-origin mutation requests", async () => {
    const response = await POST(
      new Request("https://digest.example/api/admin/newsletter/reissue", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
        body: JSON.stringify({
          deliveryId: "929db688-b8fe-40d5-b61a-1aa026a4a77f",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(reissue).not.toHaveBeenCalled();
  });

  it("queues a new auditable delivery sequence", async () => {
    reissue.mockResolvedValue({
      id: "c48d69bf-3da4-4c98-8dc9-f2df2c9ec547",
      sequence: 2,
    });
    const response = await POST(
      new Request("https://digest.example/api/admin/newsletter/reissue", {
        method: "POST",
        headers: {
          origin: "https://digest.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deliveryId: "929db688-b8fe-40d5-b61a-1aa026a4a77f",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      delivery: { sequence: 2 },
    });
    expect(reissue).toHaveBeenCalledOnce();
  });
});
