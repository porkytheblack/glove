// The whole deployment, declared once.
//
//   pnpm start   →   `station`
//
// That single command IS the system: station-kit builds the SignalRunner from
// the directory below, runs rooms and research jobs, and serves the dashboard —
// all in one process, with the runner's events wired straight into the live UI.
//
//   http://localhost:4420/signals   rooms and delegations alike — every call is
//                                   a run with a duration, an outcome and its
//                                   logs; every delegation shows its input,
//                                   answer and attempts
//   http://localhost:4420/env       runtime env vars injected into runs
//
// Each room listens on its own port (:4701+), assigned by the app when it
// triggers the run — that is what callers connect to.

// FIRST: puts .env.local into process.env, for this config and for every room
// and research run station spawns as a child process.
import "./lib/load-env";

import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { EnvSqliteAdapter } from "station-adapter-sqlite/env";

const dbPath = process.env.STATION_DB ?? "./station.db";

const username = process.env.STATION_USERNAME;
const password = process.env.STATION_PASSWORD;
if (!username || !password) {
  // Deliberately fatal, and deliberately without a default. Station's API can
  // start processes on this machine; an unauthenticated one is a remote-
  // execution endpoint, and a built-in default password is the same thing with
  // extra steps.
  //
  // These credentials are for the DASHBOARD and for minting keys (`pnpm key`).
  // The web app never uses them — it holds an API key and nothing else.
  throw new Error(
    "STATION_USERNAME and STATION_PASSWORD must be set — station's API can start rooms. " +
      "Put them in examples/server-voice/.env.local (see .env.example).",
  );
}

export default defineConfig({
  port: 4420,

  // Gates the dashboard AND the API the web app drives. Once this is set,
  // /api/* requires a session cookie and /api/v1/* accepts either a session or
  // an `Authorization: Bearer sk_live_…` API key.
  auth: { username, password },

  // Rooms and research jobs are both signals — a room simply runs for up to an
  // hour instead of a few seconds. There is no beacons dir: beacon control is
  // session-only on station's dashboard API, and the web app authenticates
  // with an API key, which only works on /api/v1. See signals/room.ts.
  signalsDir: "./signals",

  // SQLite rather than the in-memory default, because the two sides of a
  // delegation live in different processes: a room (itself a run) enqueues the
  // job, the runner in *this* process drains it, and the worker's reply goes
  // back over the mesh. An in-memory queue would leave a room triggering into
  // a queue nobody else can see.
  adapter: new SqliteAdapter({ dbPath }),

  // Lets ELEVENLABS_API_KEY / OPENROUTER_API_KEY be managed from the dashboard
  // and injected into every room and research run, instead of only through the
  // shell that launched station.
  envStorage: new EnvSqliteAdapter({ dbPath }),

  runner: {
    // A voice caller is waiting on these, so poll tightly rather than at the
    // 1s default.
    pollIntervalMs: 250,
    // Rooms hold a slot for the whole call, so this has to cover every
    // concurrent room PLUS the research jobs they dispatch. Each signal caps
    // itself (`.concurrency()`), which is what stops a full house of rooms
    // from starving the worker.
    maxConcurrent: 24,
  },
});
