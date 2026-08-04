import { describe, expect, it, vi } from "vitest";

import { sendConfirmationMessage } from "./provider";

describe("HD-102 confirmation provider", () => {
  it("sends bounded HTML and text alternatives without exposing the token as the idempotency key", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "message-id" }), { status: 200 }),
      );
    const confirmationUrl = new URL(
      "https://digest.example/newsletter/confirm?token=opaque-secret-token",
    );
    await sendConfirmationMessage(
      {
        recipient: "reader@example.com",
        confirmationUrl,
        fromEmail: "digest@example.com",
        replyToEmail: "privacy@example.com",
        apiKey: "provider-secret",
      },
      fetchImplementation,
    );

    const [, request] = fetchImplementation.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(headers.get("authorization")).toBe("Bearer provider-secret");
    expect(headers.get("idempotency-key")).not.toContain("opaque-secret-token");
    expect(body).toMatchObject({
      to: ["reader@example.com"],
      reply_to: "privacy@example.com",
      subject: "Confirm your HN Digest subscription",
    });
    expect(String(body.text)).toContain(confirmationUrl.href);
    expect(String(body.html)).toContain("Confirm subscription");
  });

  it("classifies provider rejection without including response content", async () => {
    await expect(
      sendConfirmationMessage(
        {
          recipient: "reader@example.com",
          confirmationUrl: new URL(
            "https://digest.example/newsletter/confirm?token=token",
          ),
          fromEmail: "digest@example.com",
          replyToEmail: "privacy@example.com",
          apiKey: "provider-secret",
        },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("sensitive provider response", { status: 429 }),
          ),
      ),
    ).rejects.toThrow("confirmation_provider_rate_limited");
  });
});
