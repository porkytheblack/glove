// The single process you start. It supervises everything else.
//
//   SignalRunner  drains the research queue, spawning a child process per
//                 delegated job.
//   BeaconRunner  supervises the voice gateway, which is where the sessions,
//                 the STT/TTS sockets, the endpointing model and the front
//                 agent actually live.
//
// Both share one SQLite database, which is what lets the gateway (a beacon
// child process) enqueue work that the signal runner (in this process) picks
// up, and then read the answer back out.

import path from "node:path";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { BeaconRunner, ConsoleBeaconSubscriber } from "station-beacon";
import { SqliteAdapter } from "station-adapter-sqlite";

const dbPath = process.env.STATION_DB ?? "./station.db";
const port = Number(process.env.PORT ?? 4500);

// SQLite rather than the in-memory adapter, because the two sides of a
// delegation live in different processes: the gateway (a beacon child) enqueues
// the job, this runner drains it, and the gateway reads the answer back out.
const adapter = new SqliteAdapter({ dbPath });

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter,
  subscribers: [new ConsoleSubscriber()],
});

const beaconRunner = new BeaconRunner({
  beaconsDir: path.join(import.meta.dirname, "beacons"),
  // Lets beacons trigger signals into the queue this runner drains.
  signalRunner,
  subscribers: [new ConsoleBeaconSubscriber()],
});

// Neither start() returns until its runner is stopped — both are supervision
// loops, not one-shot bootstraps. So they are launched side by side rather than
// awaited in sequence, and each installs its own SIGINT/SIGTERM graceful
// shutdown.
void signalRunner.start().catch((err) => {
  console.error("[signals] runner stopped:", err);
  process.exit(1);
});
void beaconRunner.start().catch((err) => {
  console.error("[beacons] runner stopped:", err);
  process.exit(1);
});

console.log(`
  Orbital Dynamics — server-side voice

  The browser is an audio duct: it ships microphone PCM up and plays PCM back.
  VAD, transcription, endpointing, the agent and speech synthesis all run here.

    console     http://localhost:${port}
    dashboard   npx station        (then http://localhost:4400/beacons)

  Ctrl-C to drain and stop.
`);
