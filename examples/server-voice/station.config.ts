// Dashboard config:  npx station  →  http://localhost:4400
//
//   /beacons  the voice gateway: status, incarnation, restart count, live logs,
//             and start/stop/restart controls for the voice tier.
//   /signals  every delegated research job — input, answer, duration, retries.
//
// Point it at the same database the runner uses so it sees real runs.

import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";

export default defineConfig({
  port: 4400,
  signalsDir: "./signals",
  beaconsDir: "./beacons",
  adapter: new SqliteAdapter({ dbPath: process.env.STATION_DB ?? "./station.db" }),
});
