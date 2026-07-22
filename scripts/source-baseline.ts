import { createDatabase } from "../src/db/client";
import { collectSourceAdapterBaseline } from "../src/operations/observability";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const [fromArgument, toArgument, minimumRunCountArgument, extra] =
    process.argv.slice(2);
  if (extra !== undefined) usage();

  const to = parseDate(toArgument ?? new Date().toISOString(), "to");
  const from = parseDate(
    fromArgument ??
      new Date(to.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString(),
    "from",
  );
  const minimumRunCount = minimumRunCountArgument
    ? parsePositiveInteger(minimumRunCountArgument, "minimum run count")
    : 10;
  const connection = createDatabase(databaseUrl);
  try {
    const report = await collectSourceAdapterBaseline(connection.db, {
      from,
      to,
      minimumRunCount,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await connection.pool.end();
  }
}

function parseDate(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`${name} must be an ISO date`);
  return date;
}

function usage(): never {
  throw new Error(
    "Usage: node source-baseline.js [from-iso-date] [to-iso-date] [minimum-run-count]",
  );
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
