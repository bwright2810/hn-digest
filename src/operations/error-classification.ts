const POSTGRES_ERROR_CODE = /^[0-9A-Z]{5}$/u;

const INTERNAL_ERROR_CODES = new Map<string, string>([
  ["Analysis job not found", "analysis_job_not_found"],
  ["Analysis job context metadata is invalid", "invalid_job_context"],
  ["Analysis cited an unselected comment", "invalid_comment_citation"],
  ["Claimed analysis job no longer exists", "claimed_job_missing"],
  ["Selected comment context is incomplete", "incomplete_comment_context"],
]);

/**
 * Converts operational exceptions into bounded, non-sensitive codes suitable
 * for persistence and the private diagnostics UI.
 */
export function classifyOperationalError(
  error: unknown,
  fallback = "unexpected_operational_error",
): string {
  if (!isErrorLike(error)) return fallback;

  const providerCode = stringProperty(error, "code");
  if (error.name === "OpenAIAnalysisError" && providerCode) {
    return boundedCode(`openai_${providerCode}`);
  }
  if (providerCode && POSTGRES_ERROR_CODE.test(providerCode)) {
    return `postgres_${providerCode.toLowerCase()}`;
  }

  const internalCode = INTERNAL_ERROR_CODES.get(error.message);
  if (internalCode) return internalCode;

  if (error.name && error.name !== "Error") {
    return boundedCode(error.name);
  }
  return fallback;
}

function isErrorLike(
  value: unknown,
): value is { readonly name: string; readonly message: string } & Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "message") === "string"
  );
}

function stringProperty(value: object, key: string): string | null {
  const property = Reflect.get(value, key);
  return typeof property === "string" && property.length > 0 ? property : null;
}

function boundedCode(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 100) || "unexpected_operational_error"
  );
}
