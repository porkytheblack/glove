// Peek at the durable delegation records station kept — the same data the
// dashboard renders at /signals.
import "../lib/load-env";

import { SqliteAdapter } from "station-adapter-sqlite";

const a = new SqliteAdapter({ dbPath: process.env.STATION_DB ?? "./station.db" });
const runs = (await (a as unknown as { listRuns(name: string, limit: number): Promise<unknown[]> }).listRuns("research", 5)) ?? [];
console.log(`${runs.length} run(s)\n`);
for (const run of runs as Array<Record<string, unknown>>) {
  console.log(`${run.signalName} · ${run.status} · attempts=${run.attempts}`);
  console.log(`  in : ${String(run.input).slice(0, 130)}`);
  console.log(`  out: ${String(run.output).slice(0, 400)}\n`);
}
