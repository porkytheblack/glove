// The whole deployment, declared once.
//
//   pnpm start   →   `station`
//
// That single command IS the system: station-kit builds the SignalRunner and
// the BeaconRunner from the directories below, supervises the voice gateway,
// drains the research queue, and serves the dashboard — all in one process,
// with the runners' events wired straight into the live UI.
//
//   http://localhost:4400/beacons   the voice tier: status, incarnation,
//                                   restart count, uptime, live logs, and
//                                   start / stop / restart controls
//   http://localhost:4400/signals   every delegation: input, answer, duration,
//                                   attempts
//   http://localhost:4400/env       runtime env vars injected into runs
//
// The gateway itself listens separately on :4500 (see beacons/voice-gateway.ts)
// — that is the port callers connect to.

import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BeaconSqliteAdapter } from "station-adapter-sqlite/beacon";
import { EnvSqliteAdapter } from "station-adapter-sqlite/env";

const dbPath = process.env.STATION_DB ?? "./station.db";

const username = process.env.STATION_USERNAME;
const password = process.env.STATION_PASSWORD;
if (!username || !password) {
  // Deliberately fatal, and deliberately without a default. Station's API can
  // start and stop processes on this machine; an unauthenticated one is a
  // remote-execution endpoint, and a built-in default password is the same
  // thing with extra steps.
  throw new Error(
    "STATION_USERNAME and STATION_PASSWORD must be set — station's API can start and stop rooms. See .env.example.",
  );
}

export default defineConfig({
  port: 4400,

  // Gates the dashboard AND the API the web app drives. Once this is set,
  // /api/* requires a session cookie and /api/v1/* accepts either a session or
  // an `Authorization: Bearer sk_live_…` API key.
  auth: { username, password },

  signalsDir: "./signals",
  beaconsDir: "./beacons",

  // SQLite rather than the in-memory default, because the two sides of a
  // delegation live in different processes: the gateway (a supervised beacon
  // child) enqueues the job, the runner in *this* process drains it, and the
  // gateway reads the answer back out. An in-memory queue would leave the
  // gateway triggering into a queue nobody can see.
  adapter: new SqliteAdapter({ dbPath }),

  // Supervision state on disk too, so restart counts and incarnation history
  // survive a station restart instead of resetting to a clean slate.
  beaconAdapter: new BeaconSqliteAdapter({ dbPath }),

  // Lets ELEVENLABS_API_KEY / OPENROUTER_API_KEY be managed from the dashboard
  // and injected into the gateway and each research run, instead of only
  // through the shell that launched station.
  envStorage: new EnvSqliteAdapter({ dbPath }),

  runner: {
    // A voice caller is waiting on these, so poll tightly rather than at the
    // 1s default.
    pollIntervalMs: 250,
    maxConcurrent: 5,
  },
});
