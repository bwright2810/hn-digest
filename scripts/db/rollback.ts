import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to roll back the database");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Database rollback is disabled when NODE_ENV=production");
}

if (process.env.CONFIRM_DATABASE_ROLLBACK !== "1") {
  throw new Error(
    "Set CONFIRM_DATABASE_ROLLBACK=1 to remove the development schema",
  );
}

async function rollback(): Promise<void> {
  const migration = await readFile(
    resolve("scripts/db/sql/0000_initial.down.sql"),
    "utf8",
  );
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query(migration);
    console.info("Removed the complete development database schema");
  } finally {
    await client.end();
  }
}

void rollback();
