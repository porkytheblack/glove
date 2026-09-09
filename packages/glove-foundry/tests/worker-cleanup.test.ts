import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { FoundryRuntime } from "../src/runtime.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function eventually(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!check() && Date.now() < deadline) await delay(100);
  assert.ok(check(), message);
}

test("completed and cancelled workers release leaked handles without exhausting capacity", { timeout: 60_000 }, async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "cleanup-agents"),
    config: { execution: { maxConcurrent: 1, pollIntervalMs: 20, idlePollIntervalMs: 20 } },
  });
  const children = new Set<number>();
  const unsubscribe = runtime.observability.subscribe(event => {
    if (event.type === "agent.test.worker.started") {
      const pid = (event.data as { pid?: number }).pid;
      if (Number.isSafeInteger(pid) && pid !== process.pid) children.add(pid!);
    }
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("worker");
    const conversation = await runtime.createConversation(agent.id);
    for (let i = 0; i < 2; i++) {
      const run = await runtime.send(agent.id, conversation.id, "complete");
      const result = await runtime.waitForRun<{ value: { pid: number } }>(run.id, { timeoutMs: 20_000, pollMs: 25 });
      assert.equal(result?.status, "completed");
      const pid = result?.output?.value.pid;
      assert.ok(pid && Number.isSafeInteger(pid) && pid !== process.pid);
      children.add(pid);
    }
    await eventually(() => [...children].every(pid => !alive(pid)), "completed workers remained alive");
    const prior = new Set(children);
    const run = await runtime.send(agent.id, conversation.id, "cancel");
    await eventually(() => children.size > prior.size, "cancel fixture did not start");
    await runtime.cancel(run.id);
    await eventually(() => [...children].every(pid => !alive(pid)), "cancelled worker ignored termination indefinitely");
    assert.equal((await runtime.getRun(run.id))?.status, "cancelled");
  } finally {
    unsubscribe();
    await runtime.stop();
    // Only fixture-reported children owned by this test; no global process scan.
    for (const pid of children) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});
