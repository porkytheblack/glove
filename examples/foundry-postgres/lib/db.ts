import pg from "pg";

/**
 * One pool per process, built from configuration. Foundry runs each agent run
 * in its own child process, which loads this module and opens its own pool:
 * never pass a pool (or any live handle) from the controller to a run.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  // A finished run's child process must be able to exit with idle connections.
  idleTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});
