import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { domainToASCII } from "node:url";

const EMAIL_MAXIMUM_LENGTH = 254;
const LOCAL_PART_MAXIMUM_LENGTH = 64;
const TOKEN_BYTES = 32;

export interface SubscriberKeys {
  readonly emailEncryptionKey: Uint8Array;
  readonly lookupHmacKey: Uint8Array;
  readonly keyVersion: number;
}

function assertKey(key: Uint8Array, name: string): void {
  if (key.byteLength !== 32) {
    throw new RangeError(`${name} must contain exactly 32 bytes`);
  }
}

export function normalizeSubscriberEmail(input: string): string {
  const value = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  const separator = value.lastIndexOf("@");

  if (
    separator <= 0 ||
    separator !== value.indexOf("@") ||
    separator > LOCAL_PART_MAXIMUM_LENGTH ||
    value.length > EMAIL_MAXIMUM_LENGTH
  ) {
    throw new TypeError("invalid email address");
  }

  const localPart = value.slice(0, separator);
  const rawDomain = value.slice(separator + 1);
  const domain = domainToASCII(rawDomain).toLowerCase();
  const labels = domain.split(".");

  if (
    !localPart ||
    !domain ||
    /[\u0000-\u0020\u007f]/u.test(localPart) ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new TypeError("invalid email address");
  }

  const normalized = `${localPart}@${domain}`;
  if (Buffer.byteLength(normalized, "utf8") > EMAIL_MAXIMUM_LENGTH) {
    throw new TypeError("invalid email address");
  }
  return normalized;
}

export function digestSubscriberValue(
  value: string,
  key: Uint8Array,
  context: "email" | "action-token" | "rate-limit" | "public-api-rate-limit",
): string {
  assertKey(key, "lookup HMAC key");
  return createHmac("sha256", key)
    .update(`hn-digest:${context}:v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function encryptSubscriberEmail(email: string, key: Uint8Array): string {
  assertKey(key, "email encryption key");
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(Buffer.from("hn-digest:subscriber-email:v1", "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(email, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  return [initializationVector, authenticationTag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSubscriberEmail(
  envelope: string,
  key: Uint8Array,
): string {
  assertKey(key, "email encryption key");
  const parts = envelope.split(".");
  if (parts.length !== 3) {
    throw new TypeError("invalid subscriber email ciphertext");
  }
  const [ivValue, tagValue, ciphertextValue] = parts;
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new TypeError("invalid subscriber email ciphertext");
  }
  const initializationVector = Buffer.from(ivValue, "base64url");
  const authenticationTag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (initializationVector.length !== 12 || authenticationTag.length !== 16) {
    throw new TypeError("invalid subscriber email ciphertext");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, initializationVector);
  decipher.setAAD(Buffer.from("hn-digest:subscriber-email:v1", "utf8"));
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function createSubscriberActionToken(key: Uint8Array): {
  readonly token: string;
  readonly digest: string;
} {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    digest: digestSubscriberValue(token, key, "action-token"),
  };
}

export function subscriberTokenMatches(
  token: string,
  expectedDigest: string,
  key: Uint8Array,
): boolean {
  const actual = Buffer.from(
    digestSubscriberValue(token, key, "action-token"),
    "hex",
  );
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
