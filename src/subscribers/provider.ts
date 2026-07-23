export interface ConfirmationMessage {
  readonly recipient: string;
  readonly confirmationUrl: URL;
  readonly fromEmail: string;
  readonly apiKey: string;
}

export async function sendConfirmationMessage(
  message: ConfirmationMessage,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  if (
    process.env.PLAYWRIGHT_FIXTURES === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }
  const response = await fetchImplementation("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${message.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": confirmationIdempotencyKey(message.confirmationUrl),
    },
    body: JSON.stringify({
      from: message.fromEmail,
      to: [message.recipient],
      subject: "Confirm your HN Digest subscription",
      text: confirmationText(message.confirmationUrl),
      html: confirmationHtml(message.confirmationUrl),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `confirmation_provider_${classifyProviderStatus(response.status)}`,
    );
  }
}

function confirmationIdempotencyKey(url: URL): string {
  const token = url.searchParams.get("token") ?? "missing";
  return `confirmation/${createHash("sha256").update(token).digest("hex")}`;
}

function confirmationText(url: URL): string {
  return `Confirm your HN Digest newsletter subscription:\n\n${url.href}\n\nIf you did not request this, you can ignore this message.`;
}

function confirmationHtml(url: URL): string {
  const href = escapeHtml(url.href);
  return `<p>Confirm your HN Digest newsletter subscription.</p><p><a href="${href}">Confirm subscription</a></p><p>If you did not request this, you can ignore this message.</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function classifyProviderStatus(status: number): string {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "rejected";
}
import { createHash } from "node:crypto";
