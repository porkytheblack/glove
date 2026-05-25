import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContinuumRunner,
  MemoryAdapter,
  type ContinuumSubscriber,
} from "../src/index.js";
import { persistentTriggered } from "./fixtures/persistent-triggered.js";

const here = dirname(fileURLToPath(import.meta.url));
const persistentPath = resolve(here, "fixtures/persistent-triggered.ts");

test("continuity across triggered wakeups: persistent store accumulates messages between runs", async () => {
  const tmpDir = mkdtempSync(`${tmpdir()}/continuum-persist-`);
  const storePath = `${tmpDir}/persist.json`;

  // The agent factory passes env vars to spawned subprocesses via the
  // builder's `.env({…})` setter — we use that to ship the storePath.
  process.env.CONTINUUM_TEST_STORE_PATH = storePath;
  try {
    const subscriber: ContinuumSubscriber = {
      onRunCompleted: () => {},
    };
    const runner = new ContinuumRunner({
      adapter: new MemoryAdapter(),
      subscribers: [subscriber],
      pollIntervalMs: 50,
    });
    // The builder needs to inject the env var into each spawned subprocess too.
    runner.registerAgent(
      Object.assign({}, persistentTriggered, {
        env: { CONTINUUM_TEST_STORE_PATH: storePath },
      }) as typeof persistentTriggered,
      persistentPath,
    );

    const startPromise = runner.start();
    try {
      const id1 = await persistentTriggered.trigger({ phrase: "first call" });
      const r1 = await runner.waitForRun(id1, {
        timeoutMs: 15_000,
        pollMs: 50,
      });
      assert.equal(r1!.status, "completed", "first run completed");

      const id2 = await persistentTriggered.trigger({
        phrase: "second call",
      });
      const r2 = await runner.waitForRun(id2, {
        timeoutMs: 15_000,
        pollMs: 50,
      });
      assert.equal(r2!.status, "completed", "second run completed");

      const persisted = JSON.parse(readFileSync(storePath, "utf8")) as {
        messages: Array<{ sender: string; text: string }>;
        turnCount: number;
      };
      // Each `processRequest` appends at minimum: user message + agent
      // message. Two runs => at least 4 messages.
      assert.ok(
        persisted.messages.length >= 4,
        `persisted store should accumulate messages across wakeups, got ${persisted.messages.length}: ${JSON.stringify(persisted.messages)}`,
      );
      // The first user phrase MUST be present in the store after the
      // second run — that's the proof of continuity.
      const firstUser = persisted.messages.find(
        (m) => m.sender === "user" && m.text.includes("first call"),
      );
      assert.ok(
        firstUser,
        `first user message should survive the second wakeup`,
      );
      const secondUser = persisted.messages.find(
        (m) => m.sender === "user" && m.text.includes("second call"),
      );
      assert.ok(secondUser, `second user message should be present`);
    } finally {
      await runner.stop({ graceful: true, timeoutMs: 5_000 });
      await startPromise.catch(() => {});
    }
  } finally {
    delete process.env.CONTINUUM_TEST_STORE_PATH;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
