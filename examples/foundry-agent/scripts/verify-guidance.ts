import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FoundryRuntime, FoundryServer, FileFoundryDataAdapter, defineApplication, foundryGuidanceSubject } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { intakeGoals } from "../agents/guided-intake/workflow.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "foundry-guidance-e2e-"));
const file = join(directory, "memory.sqlite");
process.env.FOUNDRY_GUIDANCE_DB = file;
process.env.FOUNDRY_FORCE_DEMO = "1";
const owner = { agentId: "guided-test", conversationId: "guided-conversation", workspaceId: "test" };
const memory = () => createSqliteMemoryAdapters({ file, namespace: foundryGuidanceSubject(owner, "instance"), schema: new MemorySchema() });
try {
  for (let pass = 0; pass < 2; pass++) {
    const runtime = await FoundryRuntime.discover({
      rootDir, agentsDir: resolve(rootDir, "agents"),
      application: defineApplication({ name: "Guidance verification", data: new FileFoundryDataAdapter({ file: join(directory, "runtime.json") }) }),
      config: { execution: { pollIntervalMs: 25, maxConcurrent: 1 } },
    });
    const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });
    await runtime.start();
    try {
      if (pass === 0) {
        await runtime.createAgent("guided-intake", { id: owner.agentId, workspaceId: owner.workspaceId });
        await runtime.createConversation(owner.agentId, { id: owner.conversationId });
      }
      const listening = await server.listen();
      const client = createFoundryClient({ baseUrl: listening.url });
      const handle = await client.send(owner.agentId, owner.conversationId, "My name is Mira");
      const run = await handle.wait({ timeoutMs: 60000 });
      assert.equal(run.status, "completed", JSON.stringify(run.error));
      assert.match(String(run.output?.value), /Thanks, Mira\. Your intake progress is saved\./);
      const events = await handle.events();
      const latest = [...events].reverse().find(e => e.type === "agent.foundry.guidance.state");
      assert.ok(latest, "Worker emitted guidance state through Foundry observability");
      assert.ok(!JSON.stringify(latest.data).includes("Mira"), "Summary excludes answer/fact bodies");
      const saved = await memory().goals.get({ subject: foundryGuidanceSubject(owner), key: intakeGoals.key });
      assert.equal(saved?.version, 2, "Restart does not reset or duplicate goal updates");
      assert.equal(saved?.progress.identity.name.done, true);
      const forms = await memory().forms.findInstances({ subject: foundryGuidanceSubject(owner) });
      assert.equal(forms.length, 1, "Restart does not start a duplicate form");
      assert.equal(forms[0].entries.name.revisions[0].value, "Mira");
      assert.equal(forms[0].status, "complete");
      const facts = await memory().facts.withScope({ subject: foundryGuidanceSubject(owner), context: "conversation-evidence" }, tx => tx.read());
      assert.equal(facts.facts.length, 1);
      console.log(`Pass ${pass + 1}: native tools, saved goals/facts/forms and inspector summary verified.`);
    } finally { await server.close(); await runtime.stop(); }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
