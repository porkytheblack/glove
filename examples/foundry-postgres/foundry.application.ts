import { defineApplication } from "glove-foundry";
import { pool } from "./lib/db.js";
import { PostgresFoundryDataAdapter } from "./src/postgres-data.js";

/**
 * Loaded by the controller and by every run's child process: each builds its
 * own adapter over its own pool, from DATABASE_URL.
 */
export default defineApplication({
  name: "Foundry on PostgreSQL",
  data: new PostgresFoundryDataAdapter({ pool }),
});
