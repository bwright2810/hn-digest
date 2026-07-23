export function hasSameOrigin(request: Request, applicationUrl: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === applicationUrl.origin;
  } catch {
    return false;
  }
}
