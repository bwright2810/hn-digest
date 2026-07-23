export interface DigestEmail {
  readonly recipient: string;
  readonly from: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly unsubscribeUrl: URL;
  readonly idempotencyKey: string;
}

export interface DeliveryProvider {
  send(message: DigestEmail): Promise<{ readonly messageId: string }>;
}

export class DeliveryProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`newsletter_provider_${code}`);
    this.name = "DeliveryProviderError";
  }
}

export class ResendDeliveryProvider implements DeliveryProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async send(message: DigestEmail): Promise<{ readonly messageId: string }> {
    let response: Response;
    try {
      response = await this.fetchImplementation(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.recipient],
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: {
              "List-Unsubscribe": `<${message.unsubscribeUrl.href}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new DeliveryProviderError("timeout_or_network", true);
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new DeliveryProviderError("rate_limited", true);
      if (response.status >= 500)
        throw new DeliveryProviderError("unavailable", true);
      if (response.status === 401 || response.status === 403)
        throw new DeliveryProviderError("authentication", false);
      throw new DeliveryProviderError("rejected", false);
    }
    const body: unknown = await response.json();
    const messageId =
      typeof body === "object" &&
      body &&
      "id" in body &&
      typeof body.id === "string"
        ? body.id
        : null;
    if (!messageId) throw new DeliveryProviderError("invalid_response", true);
    return { messageId };
  }
}
