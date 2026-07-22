import { migrate } from "drizzle-orm/node-postgres/migrator";

import { getConfig } from "../src/config/server";
import { createDatabase } from "../src/db/client";

const config = getConfig();
const connection = createDatabase(config.database.url);

void migrate(connection.db, { migrationsFolder: "/app/drizzle" })
  .then(() => {
    console.log(JSON.stringify({ event: "database_migrations_applied" }));
  })
  .finally(() => connection.pool.end());
