import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { builtinAllowed, FOUNDRY_BUILTIN_TOOLS, isFoundryBuiltin } from "../src/index.js";
import { VOICE_EXCLUDED_FOUNDRY_TOOLS } from "../src/voice.js";
import { FoundryRuntime } from "../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const ALL = FOUNDRY_BUILTIN_TOOLS.map((tool) => tool.name);

async function eventually<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

test("a policy is an allow list, a block list or a filter, with prefix patterns", () => {
  const all = builtinAllowed(undefined);
  assert.ok(ALL.every(all));

  const allow = builtinAllowed({ allow: ["glove_foundry_schedule", "glove_mesh_*"] });
  assert.deepEqual(ALL.filter(allow), ["glove_foundry_schedule", "glove_mesh_list_agents", "glove_mesh_send_message", "glove_mesh_broadcast", "glove_mesh_acknowledge"]);
  assert.deepEqual(ALL.filter(builtinAllowed(["glove_foundry_sleep"])), ["glove_foundry_sleep"], "a bare list allows");

  const block = builtinAllowed({ block: ["glove_mesh_*", "glove_foundry_spawn"] });
  assert.equal(ALL.filter(block).length, ALL.length - 5);
  assert.equal(block("glove_foundry_spawn"), false);

  const filter = builtinAllowed({ filter: (tool) => tool.group === "scheduling" });
  assert.deepEqual(ALL.filter(filter), ["glove_foundry_schedule", "glove_foundry_schedules", "glove_foundry_sleep"]);

  // Only built-ins are subject to a policy: the agent's own tools are not.
  assert.equal(builtinAllowed({ allow: [] })("lookup_order"), true);
  assert.equal(isFoundryBuiltin("lookup_order"), false);
  assert.throws(() => builtinAllowed({} as never), /allow.*block.*filter/);

  // voiceCall's exclusions are names in the same catalogue, so they work as a block list.
  assert.ok(VOICE_EXCLUDED_FOUNDRY_TOOLS.every(isFoundryBuiltin));
});

test("a run's model sees only the built-ins its policy allows; the controller refuses the rest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-builtins-"));
  const logFile = join(directory, "tools.log");
  process.env.FOUNDRY_TEST_BUILTINS_LOG = logFile;
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "builtins-agents"),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } },
  });
  await runtime.start();
  try {
    const ask = async (definition: string, message: string) => {
      const agent = await runtime.createAgent(definition);
      const conversation = await runtime.createConversation(agent.id);
      return runtime.send(agent.id, conversation.id, message);
    };
    const seen = async (agent: string, message = "hello"): Promise<string[]> => {
      const run = await ask(agent, message);
      assert.equal((await runtime.waitForRun(run.id, { timeoutMs: 30_000 }))?.status, "completed");
      const lines = (await readFile(logFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { agent: string; tools: string[] });
      return lines.filter((line) => line.agent === agent).at(-1)!.tools.filter(isFoundryBuiltin);
    };

    // No policy: every built-in that applies (no delegates or mesh here).
    const open = await seen("open");
    for (const name of ["glove_foundry_spawn", "glove_foundry_workspace", "glove_foundry_schedule", "glove_foundry_sleep"]) assert.ok(open.includes(name), name);
    assert.deepEqual(await seen("allowed"), ["glove_foundry_schedule", "glove_mesh_acknowledge", "glove_mesh_broadcast", "glove_mesh_list_agents", "glove_mesh_send_message"]);
    assert.deepEqual(await seen("listed"), ["glove_foundry_sleep"]);
    assert.deepEqual(await seen("listed", "quiet"), [], "resolved per run");
    const blocked = await seen("blocked");
    for (const name of ["glove_foundry_spawn", "glove_foundry_workspace", "glove_foundry_shared_inbox"]) assert.ok(!blocked.includes(name), name);
    assert.ok(blocked.includes("glove_foundry_schedule"));
    const filtered = await seen("filtered");
    assert.deepEqual(filtered.filter((name) => FOUNDRY_BUILTIN_TOOLS.find((tool) => tool.name === name)!.workspaceWide), []);
    assert.ok(filtered.includes("glove_foundry_sleep"));

    // A run without the spawn tool cannot spawn by sending the command itself.
    const rogue = await ask("rogue", "go");
    assert.equal((await runtime.waitForRun(rogue.id, { timeoutMs: 30_000 }))?.status, "completed");
    const refused = await eventually(async () => (await runtime.observability.list({ runId: rogue.id }))
      .find((event) => event.type === "foundry.builtin.refused"), "the refusal");
    assert.deepEqual(refused.data, { type: "spawn", error: 'This run has no tool that can send "spawn".' });
    const mounted = (await runtime.observability.list({ runId: rogue.id })).find((event) => event.type === "foundry.builtins.mounted");
    assert.ok(mounted, "the mounted built-ins are in the trace");
    assert.ok(!(mounted.data as { tools: string[] }).tools.includes("glove_foundry_spawn"));

    // The same command from a run with no policy goes through.
    const trusted = await ask("trusted", "go");
    assert.equal((await runtime.waitForRun(trusted.id, { timeoutMs: 30_000 }))?.status, "completed");
    await eventually(async () => (await runtime.listRuns("open"))
      .find((run) => JSON.stringify(run.input).includes("spawned by trusted")), "the trusted spawn");
    assert.equal((await runtime.listRuns("open")).some((run) => JSON.stringify(run.input).includes("spawned by rogue")), false);
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_BUILTINS_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});
