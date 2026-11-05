/**
 * A Foundry controller that SIGKILLs its whole process group (itself, the
 * execution daemon and its children) at one checkpoint around a schedule
 * occurrence, with no cleanup. Spawned detached by schedule-recovery tests.
 *
 * FOUNDRY_SCHEDULE_DATA      the FileFoundryDataAdapter file
 * FOUNDRY_SCHEDULE_CRASH_AT  checkpoint, or empty to run until told to stop
 */
import { Effect } from "effect";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineApplication } from "../../../src/application.js";
import { discoverAgents } from "../../../src/discovery.js";
import { FileFoundryDataAdapter } from "../../../src/file-data.js";
import type { FoundryActivationRecord } from "../../../src/primitives.js";
import { FoundryRuntime } from "../../../src/runtime.js";
import type { FoundryScheduleOccurrence } from "../../../src/schedule-occurrences.js";

const here = dirname(fileURLToPath(import.meta.url));
const crashAt = process.env.FOUNDRY_SCHEDULE_CRASH_AT ?? "";

function crash(checkpoint: string): never {
  process.stdout.write(`${JSON.stringify({ crashed: checkpoint })}\n`);
  process.kill(-process.pid, "SIGKILL");
  // SIGKILL to the group includes this process; never continue past it.
  for (;;) { /* unreachable */ }
}

class CrashingAdapter extends FileFoundryDataAdapter {
  private claimed = false;
  override claimScheduleOccurrence(occurrence: FoundryScheduleOccurrence) {
    return Effect.flatMap(Effect.sync(() => { if (crashAt === "before-claim") crash(crashAt); }), () =>
      Effect.tap(super.claimScheduleOccurrence(occurrence), (fresh) => Effect.sync(() => {
        if (!fresh) return;
        this.claimed = true;
        if (crashAt === "after-claim") crash(crashAt);
      })));
  }
  override putActivation(activation: FoundryActivationRecord) {
    return Effect.tap(super.putActivation(activation), () => Effect.sync(() => {
      // The first activation write after a fresh claim moves the cursor past it.
      if (this.claimed && crashAt === "after-advance") crash(crashAt);
    }));
  }
  override putScheduleOccurrence(occurrence: FoundryScheduleOccurrence) {
    const before = (crashAt === "before-receipt" && occurrence.status === "accepted")
      || (crashAt === "before-ack" && occurrence.status === "completed");
    const after = (crashAt === "after-receipt" && occurrence.status === "accepted")
      || (crashAt === "after-ack" && occurrence.status === "completed");
    return Effect.flatMap(Effect.sync(() => { if (before) crash(crashAt); }), () =>
      Effect.tap(super.putScheduleOccurrence(occurrence), () => Effect.sync(() => { if (after) crash(crashAt); })));
  }
}

const data = new CrashingAdapter({ file: process.env.FOUNDRY_SCHEDULE_DATA! });
const agents = await discoverAgents({ agentsDir: resolve(here, "../schedule-agents") });
const runtime = new FoundryRuntime({
  rootDir: resolve(here, ".."),
  agents,
  application: defineApplication({ name: "Schedule recovery", data }),
  config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
});
await runtime.start();
process.stdout.write(`${JSON.stringify({ started: true })}\n`);
process.on("message", (message: { stop?: boolean }) => {
  if (message.stop) void runtime.stop().finally(() => process.exit(0));
});
