import { describe, expect, it } from "vitest";

import { derivePublicApiClientIp } from "./client-ip";

describe("HD-110 public API client identity", () => {
  const trustedProxyCidrs = ["10.20.0.0/16", "2001:db8:1::/48"];

  it("ignores spoofed forwarding headers from untrusted peers", () => {
    expect(
      derivePublicApiClientIp({
        directAddress: "198.51.100.8",
        forwardedFor: "203.0.113.1, 203.0.113.2",
        trustedProxyCidrs,
      }),
    ).toBe("198.51.100.8");
  });

  it("removes explicitly trusted proxy hops from the closest side", () => {
    expect(
      derivePublicApiClientIp({
        directAddress: "10.20.1.4",
        forwardedFor: "198.51.100.20, 10.20.1.3",
        trustedProxyCidrs,
      }),
    ).toBe("198.51.100.20");
  });

  it("uses one fail-safe bucket for missing and fully trusted chains", () => {
    expect(
      derivePublicApiClientIp({
        directAddress: "10.20.1.4",
        forwardedFor: "10.20.1.3",
        trustedProxyCidrs,
      }),
    ).toBe("unavailable");
    expect(
      derivePublicApiClientIp({
        directAddress: null,
        forwardedFor: "198.51.100.20",
        trustedProxyCidrs,
      }),
    ).toBe("unavailable");
  });
});
