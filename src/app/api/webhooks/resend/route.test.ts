import { Webhook } from "svix";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processProviderEvent: vi.fn(),
}));

vi.mock("../../../../config/server", () => ({
  getConfig: () => ({
    newsletter: {
      resendWebhookSecret: `whsec_${Buffer.alloc(32, 9).toString("base64")}`,
      consentPolicyVersion: "newsletter-v1",
    },
  }),
}));
vi.mock("../../../../db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("../../../../newsletter/events", () => ({
  processProviderEvent: mocks.processProviderEvent,
}));

import { POST } from "./route";

describe("HD-104 Resend webhook route", () => {
  const secret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;

  beforeEach(() => {
    mocks.processProviderEvent.mockReset().mockResolvedValue({
      outcome: "processed",
    });
  });

  it("rejects unsigned payloads before processing", async () => {
    const response = await POST(
      new Request("https://digest.example/api/webhooks/resend", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.processProviderEvent).not.toHaveBeenCalled();
  });

  it("verifies the raw body and passes only the verified event onward", async () => {
    const id = "msg_fixture_event";
    const timestamp = new Date();
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: timestamp.toISOString(),
      data: { email_id: "provider-message" },
    });
    const signature = new Webhook(secret).sign(id, timestamp, body);
    const response = await POST(
      new Request("https://digest.example/api/webhooks/resend", {
        method: "POST",
        headers: {
          "svix-id": id,
          "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
          "svix-signature": signature,
        },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.processProviderEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        providerEventId: id,
        payload: expect.objectContaining({ type: "email.delivered" }),
      }),
      "newsletter-v1",
    );
  });
});
