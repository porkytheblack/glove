import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FoundryRuntime } from "../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");

interface LogEntry { readonly t: number; readonly pid: number; readonly event: string }

async function entries(file: string): Promise<LogEntry[]> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

test("steering starts the replacement only after the interrupted process lets go", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-steer-"));
  const logFile = join(directory, "steer.log");
  process.env.FOUNDRY_TEST_STEER_LOG = logFile;
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "steer-agents"),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("slow", { id: "slow-steer" });
    const conversation = await runtime.createConversation(agent.id, { id: "steer-conversation" });
    const run = await runtime.send(agent.id, conversation.id, "start-slow");
    const deadline = Date.now() + 20_000;
    while (!(await entries(logFile)).some((entry) => entry.event === "tool-start")) {
      assert.ok(Date.now() < deadline, "the first run reached its tool");
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }

    const steered = await runtime.steer(run.id, "change course");
    assert.equal(steered.interrupted, true);
    assert.equal((await runtime.getRun(run.id))?.status, "cancelled");
    const replacement = await runtime.waitForRun(steered.run.id, { timeoutMs: 20_000 });
    assert.equal(replacement?.status, "completed");

    const log = await entries(logFile);
    const committed = log.find((entry) => entry.event === "tool-side-effect-committed");
    const replacementCall = log.find((entry) => entry.event === "replacement-model-call");
    assert.ok(committed, "the uninterruptible tool still finished");
    assert.ok(replacementCall, "the replacement ran");
    assert.notEqual(committed.pid, replacementCall.pid, "two separate run processes");
    assert.ok(
      committed.t <= replacementCall.t,
      `the replacement read the conversation ${committed.t - replacementCall.t} ms before the interrupted process finished`,
    );
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_STEER_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});
