import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getConfig } from "../config/server";

import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase() {
  database ??= createDatabase(getConfig().database.url);
  return database.db;
}
