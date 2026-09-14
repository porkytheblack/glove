import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { McpAdapter, McpCatalogueEntry } from "../src/adapter.js";
import { connectMcpEntry } from "../src/connect-entry.js";
import { mcpUtilityTools } from "../src/utilities.js";

const here = dirname(fileURLToPath(import.meta.url));

test("stdio entries resolve process environment only through the connection adapter", async () => {
  let environmentRequests = 0;
  let authRequests = 0;
  const adapter: McpAdapter = {
    identifier: "stdio-test",
    getActive: async () => ["fixture"],
    activate: async () => undefined,
    deactivate: async () => undefined,
    getAuthHeaders: async () => {
      authRequests += 1;
      return { authorization: "must-not-be-used" };
    },
    getStdioEnvironment: async (id) => {
      environmentRequests += 1;
      assert.equal(id, "fixture");
      return { GLOVE_MCP_FIXTURE_PREFIX: "host-owned" };
    },
  };
  const entry: McpCatalogueEntry = {
    id: "fixture",
    name: "Fixture",
    description: "Local stdio MCP fixture",
    transport: {
      kind: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", resolve(here, "fixtures/stdio-server.ts")],
      cwd: resolve(here, ".."),
    },
    includeTools: ["e*"],
    excludeTools: ["echo_private"],
    connectTimeoutMs: 15_000,
    requestTimeoutMs: 50,
  };

  const connection = await connectMcpEntry({ adapter, entry });
  try {
    const tools = await connection.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["echo"]);
    const result = await connection.callTool("echo", { value: "ready" });
    assert.equal(result.content[0]?.text, "host-owned:ready");
    await assert.rejects(
      connection.callTool("wait", { milliseconds: 250 }),
      /timed out|request.*timeout/i,
    );
    assert.equal(environmentRequests, 1);
    assert.equal(authRequests, 0, "HTTP authentication must not be requested for stdio.");

    assert.deepEqual(connection.capabilities, {
      resources: true,
      prompts: true,
      toolsListChanged: true,
    });
    const resources = await connection.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri), ["file:///brief.txt"]);
    assert.equal((await connection.listResources()).resources.length, 1, "re-listing stays stable");
    const resource = await connection.readResource("file:///brief.txt");
    assert.equal(resource.contents[0]?.text, "resource:ready");
    assert.deepEqual(resource.contents[0]?._meta, { "vendor.example/checksum": "fixture" });
    assert.deepEqual(resource.metadata, { "vendor.example/page": "resource-list" });

    const prompts = await connection.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ["summarize"]);
    assert.equal((await connection.listPrompts()).prompts.length, 1, "re-listing stays stable");
    const prompt = await connection.getPrompt("summarize", { topic: "release" });
    assert.deepEqual(prompt.messages, [{
      role: "user",
      content: { type: "text", text: "Summarize release." },
    }]);
    assert.deepEqual(prompt.metadata, { "vendor.example/prompt": "fixture" });

    const utilityTools = mcpUtilityTools(connection, {
      occupiedNames: tools.map((tool) => tool.name),
    });
    assert.deepEqual(utilityTools.map((tool) => tool.name), [
      "fixture__list_resources",
      "fixture__read_resource",
      "fixture__list_prompts",
      "fixture__get_prompt",
    ]);
    const readUtility = utilityTools.find((tool) => tool.name === "fixture__read_resource");
    assert.ok(readUtility);
    const utilityResult = await readUtility.do(
      { uri: "file:///brief.txt" },
      undefined as never,
      undefined as never,
    );
    assert.equal(utilityResult.status, "success");
    assert.match(String(utilityResult.data), /resource:ready/);

    assert.deepEqual(
      mcpUtilityTools(connection, { resources: false }).map((tool) => tool.name),
      ["fixture__list_prompts", "fixture__get_prompt"],
    );
  } finally {
    await connection.close();
  }
});

test("stdio connections surface negotiated tool-list changes through the filtered listing", async () => {
  const adapter: McpAdapter = {
    identifier: "stdio-list-change-test",
    getActive: async () => [],
    activate: async () => undefined,
    deactivate: async () => undefined,
    getStdioEnvironment: async () => ({}),
  };
  const connection = await connectMcpEntry({
    adapter,
    entry: {
      id: "fixture",
      name: "Fixture",
      description: "Dynamic stdio MCP fixture",
      transport: {
        kind: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", resolve(here, "fixtures/stdio-server.ts")],
        cwd: resolve(here, ".."),
      },
      includeTools: ["late_*"],
      requestTimeoutMs: 1_000,
    },
  });

  try {
    assert.deepEqual(await connection.listTools(), []);
    const changed = new Promise<void>((resolveChanged, reject) => {
      const timer = setTimeout(() => reject(new Error("tools/list_changed was not delivered")), 2_000);
      connection.onToolsChanged?.(async () => {
        const tools = await connection.listTools();
        if (tools.some((tool) => tool.name === "late_tool")) {
          clearTimeout(timer);
          resolveChanged();
        }
      });
    });
    await connection.callTool("install_late_tool", {});
    await changed;
    assert.deepEqual((await connection.listTools()).map((tool) => tool.name), ["late_tool"]);
  } finally {
    await connection.close();
  }
});

test("stdio idle recycling respawns with freshly resolved adapter environment", async () => {
  let environmentRequests = 0;
  const adapter: McpAdapter = {
    identifier: "stdio-recycle-test",
    getActive: async () => ["fixture"],
    activate: async () => undefined,
    deactivate: async () => undefined,
    getStdioEnvironment: async () => ({
      GLOVE_MCP_FIXTURE_PREFIX: `generation-${++environmentRequests}`,
    }),
  };
  const entry: McpCatalogueEntry = {
    id: "fixture",
    name: "Fixture",
    description: "Recycling stdio MCP fixture",
    transport: {
      kind: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", resolve(here, "fixtures/stdio-server.ts")],
      cwd: resolve(here, ".."),
    },
    idleTimeoutMs: 25,
    requestTimeoutMs: 1_000,
  };

  const connection = await connectMcpEntry({ adapter, entry });
  try {
    assert.equal((await connection.callTool("echo", { value: "first" })).content[0]?.text, "generation-1:first");
    await new Promise((done) => setTimeout(done, 80));
    assert.equal((await connection.callTool("echo", { value: "second" })).content[0]?.text, "generation-2:second");
    assert.equal(environmentRequests, 2);
  } finally {
    await connection.close();
  }
});

test("invalid stdio recycle policy fails before resolving environment or spawning", async () => {
  let environmentRequests = 0;
  const adapter: McpAdapter = {
    identifier: "stdio-invalid-recycle-test",
    getActive: async () => [],
    activate: async () => undefined,
    deactivate: async () => undefined,
    getStdioEnvironment: async () => {
      environmentRequests += 1;
      return {};
    },
  };
  await assert.rejects(connectMcpEntry({
    adapter,
    entry: {
      id: "invalid",
      name: "Invalid",
      description: "Must never spawn",
      transport: { kind: "stdio", command: process.execPath },
      idleTimeoutMs: -1,
    },
  }), /idleTimeoutMs/);
  assert.equal(environmentRequests, 0);
});
