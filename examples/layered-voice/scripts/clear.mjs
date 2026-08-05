// Wipe all locally persisted data for the example: the PGlite data directory
// (agent transcripts + mesh inbox traffic) and the metrics file.
// Run with the dev server STOPPED (it holds the DB open). While the server is
// running, use the "Clear data" button in the console header instead — it
// clears rows in place and starts a fresh session.
import { existsSync, rmSync, unlinkSync } from "node:fs";

const dbDir = process.env.VOICE_DB_DIR || "voice-agents-db";
const metrics = process.env.VOICE_METRICS_FILE || "voice-metrics.jsonl";

if (existsSync(dbDir)) {
  rmSync(dbDir, { recursive: true, force: true });
  console.log("removed", dbDir + "/");
}
try {
  unlinkSync(metrics);
  console.log("removed", metrics);
} catch {
  /* not present — fine */
}
console.log("clear done");
