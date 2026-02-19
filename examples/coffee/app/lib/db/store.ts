import { SqliteStore } from "glove-core";
import path from "path";

const DB_PATH = path.join(process.cwd(), "coffee-sessions.db");

/**
 * Get a SqliteStore for a given session. Each API call opens/closes its own
 * connection — fine for a demo app with WAL mode.
 */
export function getStore(sessionId: string): SqliteStore {
  return new SqliteStore({ dbPath: DB_PATH, sessionId });
}

export function listAllSessions() {
  return SqliteStore.listSessions(DB_PATH);
}

export { DB_PATH };
