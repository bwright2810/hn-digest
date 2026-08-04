import { describe, expect, it, vi } from "vitest";

import { DeliveryProviderError, ResendDeliveryProvider } from "./provider";

const message = {
  recipient: "reader@example.com",
  from: "digest@example.com",
  replyTo: "privacy@example.com",
  subject: "Morning HN Digest",
  html: "<p>Digest</p>",
  text: "Digest",
  unsubscribeUrl: new URL("https://digest.example/unsubscribe/opaque"),
  idempotencyKey: "digest/delivery-1",
};

describe("ResendDeliveryProvider", () => {
  it("sends one recipient with alternatives, unsubscribe headers, and idempotency", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-1" }), { status: 200 }),
      );
    await expect(
      new ResendDeliveryProvider("secret", fetchImplementation).send(message),
    ).resolves.toEqual({ messageId: "provider-1" });
    const [, init] = fetchImplementation.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "digest/delivery-1",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: ["reader@example.com"],
      reply_to: "privacy@example.com",
      html: "<p>Digest</p>",
      text: "Digest",
      headers: {
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });

  it.each([
    [429, true, "rate_limited"],
    [503, true, "unavailable"],
    [401, false, "authentication"],
    [422, false, "rejected"],
  ] as const)("classifies status %s", async (status, retryable, code) => {
    const provider = new ResendDeliveryProvider(
      "secret",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
    );
    const error = await provider.send(message).catch((caught) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect(error).toMatchObject({ code, retryable });
  });
});
