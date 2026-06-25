import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { McpServerConnection } from "glove-mcp";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";
import { containMcpTools, mountContainedMcp } from "../src/mcp/index";

// A fake MCP connection — structurally a McpServerConnection, no SDK / no
// network. `bridgeMcpTool` is a pure function, so the whole bridge+contain path
// is exercised end to end against it.
function fakeConnection(): McpServerConnection {
  const accounts = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: i, arr: i * 1000 })));
  return {
    namespace: "crm",
    async listTools() {
      return [
        { name: "list_accounts", description: "all accounts", inputSchema: { type: "object", properties: {} } },
        { name: "ping", description: "health", inputSchema: { type: "object", properties: {} } },
      ];
    },
    async callTool(name) {
      if (name === "list_accounts") return { content: [{ type: "text", text: accounts }] };
      return { content: [{ type: "text", text: "pong" }] };
    },
    async close() {},
    raw: {} as never,
  };
}
function fakeGlove() {
  const folded: GloveFoldArgs<unknown>[] = [];
  const glove = { fold(t: GloveFoldArgs<unknown>) { folded.push(t); return glove; } } as unknown as IGloveRunnable;
  return { glove, folded };
}

test("mountContainedMcp bridges + contains every tool and namespaces names", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const { glove, folded } = fakeGlove();
  const names = await mountContainedMcp(glove, fakeConnection(), { scratchpad: sp, actor: "analyst" });

  assert.deepEqual(names, ["crm__list_accounts", "crm__ping"]);
  assert.equal(folded.length, 2);

  const listAccounts = folded.find((t) => t.name === "crm__list_accounts")!;
  const r = await listAccounts.do({}, undefined as never, undefined as never);
  const data = r.data as {
    scratchpad?: boolean;
    ref: string;
    rowCount: number;
    provenance: { source: string; actor?: string };
  };
  assert.equal(data.scratchpad, true);
  assert.equal(data.rowCount, 120);
  assert.equal(data.provenance.actor, "analyst");
  assert.match(data.provenance.source, /^tool:crm__list_accounts/);
  await sp.close();
});

test("shouldContain leaves small/control tools bridged but uncontained", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const tools = await containMcpTools(fakeConnection(), {
    scratchpad: sp,
    shouldContain: (t) => t.name === "list_accounts",
  });

  const ping = tools.find((t) => t.name === "crm__ping")!;
  const pingRes = await ping.do({}, undefined as never, undefined as never);
  assert.equal(pingRes.data, "pong"); // raw MCP text, not a stub

  const list = tools.find((t) => t.name === "crm__list_accounts")!;
  const listRes = await list.do({}, undefined as never, undefined as never);
  assert.equal((listRes.data as { scratchpad?: boolean }).scratchpad, true);
  await sp.close();
});

test("onContain telemetry flows through the MCP helper", async () => {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const { glove } = fakeGlove();
  const seen: string[] = [];
  await mountContainedMcp(glove, fakeConnection(), {
    scratchpad: sp,
    onContain: (info) => seen.push(info.tool),
    shouldContain: (t) => t.name === "list_accounts",
  });
  // Trigger the contained tool.
  const tools = await containMcpTools(fakeConnection(), { scratchpad: sp, onContain: (i) => seen.push(i.tool), shouldContain: (t) => t.name === "list_accounts" });
  await tools.find((t) => t.name === "crm__list_accounts")!.do({}, undefined as never, undefined as never);
  assert.ok(seen.includes("crm__list_accounts"));
  await sp.close();
});
