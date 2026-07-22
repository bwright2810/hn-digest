import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  const authorization = request.headers.get("authorization");
  if (expected && authorization?.startsWith("Basic ")) {
    try {
      const [username, ...passwordParts] = atob(authorization.slice(6)).split(
        ":",
      );
      if (
        username === "admin" &&
        constantTimeEqual(passwordParts.join(":"), expected)
      )
        return NextResponse.next();
    } catch {
      // Malformed credentials receive the same response as incorrect ones.
    }
  }

  return new NextResponse("Authentication required", {
    status: expected ? 401 : 503,
    headers: expected
      ? { "WWW-Authenticate": 'Basic realm="HN Digest operator"' }
      : undefined,
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1)
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
