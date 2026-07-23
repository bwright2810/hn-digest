import { describe, expect, it } from "vitest";

import {
  createSubscriberActionToken,
  decryptSubscriberEmail,
  digestSubscriberValue,
  encryptSubscriberEmail,
  normalizeSubscriberEmail,
  subscriberTokenMatches,
} from "./crypto";

const encryptionKey = Buffer.alloc(32, 3);
const lookupKey = Buffer.alloc(32, 7);

describe("HD-101 subscriber cryptography", () => {
  it("normalizes only surrounding whitespace and the domain", () => {
    expect(normalizeSubscriberEmail("  User+News@EXAMPLE.COM\r\n")).toBe(
      "User+News@example.com",
    );
    expect(normalizeSubscriberEmail("user@bücher.example")).toBe(
      "user@xn--bcher-kva.example",
    );
  });

  it.each([
    "missing-at.example",
    "a@@example.com",
    ".a@example.com",
    "a..b@example.com",
    "a@example..com",
    "a@-example.com",
  ])("rejects malformed address %s", (email) => {
    expect(() => normalizeSubscriberEmail(email)).toThrow(
      "invalid email address",
    );
  });

  it("encrypts with randomized authenticated ciphertext", () => {
    const first = encryptSubscriberEmail("User@example.com", encryptionKey);
    const second = encryptSubscriberEmail("User@example.com", encryptionKey);

    expect(first).not.toBe(second);
    expect(decryptSubscriberEmail(first, encryptionKey)).toBe(
      "User@example.com",
    );
    const [iv, tag, encodedCiphertext] = first.split(".");
    const changedCiphertext = Buffer.from(encodedCiphertext!, "base64url");
    changedCiphertext[0] ^= 1;
    expect(() =>
      decryptSubscriberEmail(
        `${iv}.${tag}.${changedCiphertext.toString("base64url")}`,
        encryptionKey,
      ),
    ).toThrow();
  });

  it("uses separated deterministic lookup and opaque token values", () => {
    const emailDigest = digestSubscriberValue(
      "User@example.com",
      lookupKey,
      "email",
    );
    const repeatedDigest = digestSubscriberValue(
      "User@example.com",
      lookupKey,
      "email",
    );
    const actionToken = createSubscriberActionToken(lookupKey);

    expect(emailDigest).toBe(repeatedDigest);
    expect(emailDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(actionToken.token).not.toContain("@");
    expect(actionToken.digest).not.toBe(emailDigest);
    expect(
      subscriberTokenMatches(actionToken.token, actionToken.digest, lookupKey),
    ).toBe(true);
    expect(subscriberTokenMatches("wrong", actionToken.digest, lookupKey)).toBe(
      false,
    );
  });
});
