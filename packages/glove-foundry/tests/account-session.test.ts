import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { defineAccount, defineApplication, install } from "../src/index.js";
import { FoundryRuntime } from "../src/runtime.js";
import notesApp from "./fixtures/account-agents/teller/apps/notes.app.js";
import notes from "./fixtures/account-agents/teller/transmissions/notes.transmission.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");

test("an installation's account reaches the app inside a run, with its session", async () => {
  const account = defineAccount({
    id: "notes-account",
    transmission: notes,
    externalAccountId: "ext-1",
    accessRef: "fixture://notes",
    metadata: { label: "Fixture" },
  });
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "account-agents"),
    application: defineApplication({ name: "accounts", accounts: [account] }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("teller", {
      id: "teller-1",
      installations: [install(notesApp, undefined, { account })],
    });
    const conversation = await runtime.createConversation(agent.id, { id: "teller-chat" });
    const run = await runtime.send(agent.id, conversation.id, "who am I?");
    const done = await runtime.waitForRun(run.id, { timeoutMs: 30_000 });
    assert.equal(done?.status, "completed", done?.error);
    assert.deepEqual((done?.output as { value?: unknown }).value, {
      accountId: "notes-account",
      session: { token: "token-for-notes-account", operation: "notes:read" },
    });
  } finally {
    await runtime.stop();
  }
});
