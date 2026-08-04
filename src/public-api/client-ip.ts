import ipaddr from "ipaddr.js";

export function derivePublicApiClientIp(options: {
  readonly directAddress: string | null;
  readonly forwardedFor: string | null;
  readonly trustedProxyCidrs: readonly string[];
}): string {
  const direct = parseAddress(options.directAddress);
  if (!direct) return "unavailable";
  if (!isTrusted(direct, options.trustedProxyCidrs)) return direct.toString();

  const chain = (options.forwardedFor ?? "")
    .split(",")
    .map((value) => parseAddress(value))
    .filter((value) => value !== null);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index]!;
    if (!isTrusted(address, options.trustedProxyCidrs))
      return address.toString();
  }
  // Missing or fully trusted chains share a fail-safe identity rather than
  // allowing arbitrary headers to create fresh rate-limit buckets.
  return "unavailable";
}

function parseAddress(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    return ipaddr.process(normalized);
  } catch {
    return null;
  }
}

function isTrusted(
  address: ipaddr.IPv4 | ipaddr.IPv6,
  cidrs: readonly string[],
) {
  return cidrs.some((cidr) => {
    const [range, prefix] = ipaddr.parseCIDR(cidr);
    const processedRange = ipaddr.process(range.toString());
    return (
      address.kind() === processedRange.kind() &&
      address.match(processedRange, prefix)
    );
  });
}
