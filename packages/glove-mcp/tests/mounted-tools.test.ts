import assert from "node:assert/strict";
import { test } from "node:test";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { McpCatalogueEntry } from "../src/adapter.js";
import type { McpServerConnection, McpToolDef } from "../src/connect.js";
import { mountMcpToolSet } from "../src/mounted-tools.js";

function registryGlove() {
  let tools: Array<GloveFoldArgs<unknown>> = [{
    name: "local",
    description: "Local tool",
    jsonSchema: { type: "object" },
    async do() { return { status: "success" as const, data: "local" }; },
  }];
  const glove = {
    serverMode: true,
    replaceTools(previousNames: Iterable<string>, next: ReadonlyArray<GloveFoldArgs<unknown>>) {
      const previous = new Set([...previousNames]);
      tools = [...tools.filter((tool) => !previous.has(tool.name)), ...next];
      return glove;
    },
  } as unknown as IGloveRunnable;
  return { glove, names: () => tools.map((tool) => tool.name) };
}

function changingConnection(initial: McpToolDef[]) {
  let tools = initial;
  let closed = false;
  const handlers = new Set<() => void | Promise<void>>();
  const connection: McpServerConnection = {
    namespace: "remote",
    capabilities: { resources: false, prompts: false, toolsListChanged: true },
    async listTools() { return tools; },
    async callTool() { return { content: [] }; },
    onToolsChanged(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async close() { closed = true; },
    raw: {} as never,
  };
  return {
    connection,
    set: (next: McpToolDef[]) => { tools = next; },
    change: async (next: McpToolDef[]) => {
      tools = next;
      await Promise.all([...handlers].map((handler) => handler()));
    },
    closed: () => closed,
  };
}

const entry: McpCatalogueEntry = {
  id: "remote",
  name: "Remote",
  description: "Remote fixture",
  url: "https://remote.invalid/mcp",
};

const definition = (name: string): McpToolDef => ({
  name,
  inputSchema: { type: "object" },
});

test("a list-changed notification atomically replaces mounted tools", async () => {
  const runtime = registryGlove();
  const remote = changingConnection([definition("old")]);
  const mounted = await mountMcpToolSet({
    glove: runtime.glove,
    connection: remote.connection,
    entry,
  });

  assert.deepEqual(runtime.names(), ["local", "remote__old"]);
  await remote.change([definition("new"), definition("extra")]);
  assert.deepEqual(runtime.names(), ["local", "remote__new", "remote__extra"]);
  assert.deepEqual(mounted.toolNames, ["remote__new", "remote__extra"]);

  await mounted.dispose();
  assert.deepEqual(runtime.names(), ["local"]);
  assert.equal(remote.closed(), true);
});

test("a failed live wrap leaves the previous provider surface intact", async () => {
  const runtime = registryGlove();
  const remote = changingConnection([definition("stable")]);
  const mounted = await mountMcpToolSet({
    glove: runtime.glove,
    connection: remote.connection,
    entry,
    wrapTool(tool) {
      if (tool.name.endsWith("broken")) throw new Error("wrapper rejected tool");
      return tool;
    },
  });

  remote.set([definition("broken")]);
  await assert.rejects(
    mounted.refresh(),
    /wrapper rejected tool/,
  );
  assert.deepEqual(runtime.names(), ["local", "remote__stable"]);
  await mounted.dispose();
});
