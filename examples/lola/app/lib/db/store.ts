import { SqliteStore } from "glove-core";
import path from "path";

const DB_PATH = path.join(process.cwd(), "lola-sessions.db");

export function getStore(sessionId: string): SqliteStore {
  return new SqliteStore({ dbPath: DB_PATH, sessionId });
}

export function listAllSessions() {
  return SqliteStore.listSessions(DB_PATH);
}

export { DB_PATH };
