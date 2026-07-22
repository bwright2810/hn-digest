import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // PostgreSQL integration files share the CI service database and manage
    // complete-table fixtures. Running files serially prevents one suite from
    // deleting or claiming another suite's rows.
    fileParallelism: false,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
