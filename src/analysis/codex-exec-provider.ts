import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CodexExecUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

export type CodexExecOutcome<T> = {
  readonly responseId: string;
  readonly model: string;
  readonly usage: CodexExecUsage | null;
} & (
  | { readonly kind: "completed"; readonly output: T }
  | { readonly kind: "refusal"; readonly refusal: string }
  | { readonly kind: "incomplete"; readonly reason: string }
  | { readonly kind: "failed"; readonly code: string }
);

export interface CodexExecRequest {
  readonly binaryPath: string;
  readonly codexHome: string | null;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly instructions: string;
  readonly content: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

export interface CodexExecRawResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class CodexExecProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
    readonly requestId: string | null,
    options?: ErrorOptions,
  ) {
    super(`Codex exec request failed (${code})`, options);
    this.name = "CodexExecProviderError";
  }
}

export function buildCodexExecArgs(
  request: Pick<CodexExecRequest, "model" | "reasoningEffort">,
  schemaPath: string,
): string[] {
  return [
    "exec",
    "-m",
    request.model,
    "-c",
    `model_reasoning_effort=${request.reasoningEffort}`,
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-s",
    "read-only",
    "--output-schema",
    schemaPath,
    "--json",
    "-",
  ];
}

export function buildCodexExecPrompt(
  request: Pick<CodexExecRequest, "instructions" | "content">,
): string {
  return [
    "Do not run any shell commands, tools, or file operations. Do not inspect the workspace. Return only the final structured JSON response directly from the supplied instructions and evidence.",
    request.instructions,
    request.content,
  ].join("\n\n");
}

export async function runCodexExecProcess(
  request: CodexExecRequest,
): Promise<CodexExecRawResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hn-digest-codex-"));
  const schemaPath = path.join(tempDir, "schema.json");

  try {
    await writeFile(schemaPath, JSON.stringify(request.outputSchema), "utf8");
    const args = buildCodexExecArgs(request, schemaPath);
    const prompt = buildCodexExecPrompt(request);
    const environment: NodeJS.ProcessEnv = request.codexHome
      ? { ...process.env, CODEX_HOME: request.codexHome }
      : process.env;

    return await new Promise<CodexExecRawResult>((resolve, reject) => {
      const child = spawn(request.binaryPath, args, {
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      child.stdin.on("error", () => {
        // Ignore EPIPE when the process exits before consuming all stdin.
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(
          new CodexExecProviderError("codex_spawn_error", false, null, null, {
            cause: error,
          }),
        );
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
        });
      });

      child.stdin.end(prompt, "utf8");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

interface ParsedJsonlEvents {
  readonly threadId: string | null;
  readonly agentMessage: string | null;
  readonly usage: CodexExecUsage | null;
  readonly turnFailedMessage: string | null;
}

export function classifyCodexExecResult<T>(
  raw: CodexExecRawResult,
  model: string,
  parseOutput: (value: unknown) => T,
): CodexExecOutcome<T> {
  const events = parseCodexJsonl(raw.stdout);
  const responseId = events.threadId ?? "codex_unknown_thread";

  if (raw.timedOut) {
    throw new CodexExecProviderError(
      "request_timeout",
      true,
      null,
      events.threadId,
    );
  }

  if (events.turnFailedMessage) {
    throw classifyTurnFailure(events.turnFailedMessage, events.threadId);
  }

  if (raw.exitCode !== 0 && !events.agentMessage) {
    throw new CodexExecProviderError(
      "codex_process_failed",
      true,
      null,
      events.threadId,
    );
  }

  if (!events.agentMessage) {
    return {
      responseId,
      model,
      usage: events.usage,
      kind: "incomplete",
      reason: "empty_message",
    };
  }

  try {
    const parsed = parseOutput(JSON.parse(events.agentMessage));
    return {
      responseId,
      model,
      usage: events.usage,
      kind: "completed",
      output: parsed,
    };
  } catch (error) {
    throw new CodexExecProviderError(
      "invalid_structured_output",
      true,
      null,
      events.threadId,
      { cause: error },
    );
  }
}

function parseCodexJsonl(stdout: string): ParsedJsonlEvents {
  let threadId: string | null = null;
  let agentMessage: string | null = null;
  let usage: CodexExecUsage | null = null;
  let turnFailedMessage: string | null = null;

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      ) {
        threadId = event.thread_id;
      } else if (
        event.type === "item.completed" &&
        isRecord(event.item) &&
        event.item.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        agentMessage = event.item.text;
      } else if (event.type === "turn.completed" && isRecord(event.usage)) {
        usage = mapCodexUsage(event.usage);
      } else if (
        event.type === "turn.failed" &&
        isRecord(event.error) &&
        typeof event.error.message === "string"
      ) {
        turnFailedMessage = event.error.message;
      }
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }

  return { threadId, agentMessage, usage, turnFailedMessage };
}

function mapCodexUsage(raw: Record<string, unknown>): CodexExecUsage | null {
  const inputTokens = nonNegativeInt(raw.input_tokens);
  const outputTokens = nonNegativeInt(raw.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    cachedReadTokens: nonNegativeInt(raw.cached_input_tokens) ?? 0,
    cacheWriteTokens: nonNegativeInt(raw.cache_write_input_tokens) ?? 0,
    reasoningTokens: nonNegativeInt(raw.reasoning_output_tokens) ?? 0,
  };
}

function classifyTurnFailure(
  message: string,
  threadId: string | null,
): CodexExecProviderError {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    const status =
      typeof parsed.status === "number" && Number.isInteger(parsed.status)
        ? parsed.status
        : null;
    const errorObj = isRecord(parsed.error) ? parsed.error : null;
    const rawCode =
      (errorObj && typeof errorObj.code === "string" && errorObj.code) ||
      (errorObj && typeof errorObj.type === "string" && errorObj.type) ||
      (status !== null ? `http_${status}` : "codex_turn_failed");
    const code = safeCode(rawCode);
    const retryable =
      status === null ||
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status >= 500;
    return new CodexExecProviderError(code, retryable, status, threadId);
  } catch {
    return new CodexExecProviderError(
      "codex_turn_failed",
      true,
      null,
      threadId,
    );
  }
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeCode(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return normalized || "codex_error";
}
