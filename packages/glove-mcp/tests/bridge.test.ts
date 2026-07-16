import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeMcpTool, jsonSchemaToShape } from "../src/index";
import type { McpCallToolResult, McpServerConnection, McpToolDef } from "../src/connect";

/** A minimal in-memory MCP connection whose callTool returns a fixed result. */
function fakeConn(result: Partial<McpCallToolResult>): McpServerConnection {
  return {
    namespace: "srv",
    async listTools() {
      return [];
    },
    async callTool() {
      return {
        content: result.content ?? [],
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
        isError: result.isError,
      } as McpCallToolResult;
    },
    async close() {},
    raw: {} as never,
  };
}

// ─── jsonSchemaToShape ───────────────────────────────────────────────────────

test("jsonSchemaToShape renders an array-of-object output schema", () => {
  const shape = jsonSchemaToShape({
    type: "array",
    items: {
      type: "object",
      properties: {
        number: { type: "integer" },
        title: { type: "string" },
        merged: { type: "boolean" },
      },
    },
  });
  assert.equal(shape, "{ number: number, title: string, merged: boolean }[]");
});

test("jsonSchemaToShape folds enum/const to a literal union", () => {
  assert.equal(jsonSchemaToShape({ type: "string", enum: ["open", "closed"] }), `"open"|"closed"`);
  assert.equal(jsonSchemaToShape({ const: "x" }), `"x"`);
});

test("jsonSchemaToShape unions anyOf variants and drops null in tuple types", () => {
  assert.equal(jsonSchemaToShape({ anyOf: [{ type: "string" }, { type: "number" }] }), "string|number");
  assert.equal(jsonSchemaToShape({ type: ["string", "null"] }), "string");
});

test("jsonSchemaToShape infers object/array without an explicit type", () => {
  assert.equal(jsonSchemaToShape({ properties: { a: { type: "string" } } }), "{ a: string }");
  assert.equal(jsonSchemaToShape({ items: { type: "number" } }), "number[]");
});

test("jsonSchemaToShape returns undefined for a shapeless node", () => {
  assert.equal(jsonSchemaToShape({}), undefined);
  assert.equal(jsonSchemaToShape(undefined), undefined);
  assert.equal(jsonSchemaToShape(null), undefined);
});

// ─── bridgeMcpTool: description ──────────────────────────────────────────────

test("bridgeMcpTool appends the declared result shape to the description", () => {
  const tool: McpToolDef = {
    name: "list_prs",
    description: "List pull requests",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" } } },
    },
  };
  const bridged = bridgeMcpTool(fakeConn({}), tool, true);
  assert.match(bridged.description, /^List pull requests/);
  assert.match(bridged.description, /Returns: \{ title: string \}\[\]/);
});

test("bridgeMcpTool leaves the description untouched with no outputSchema", () => {
  const tool: McpToolDef = { name: "t", description: "Plain", inputSchema: { type: "object" } };
  const bridged = bridgeMcpTool(fakeConn({}), tool, true);
  assert.equal(bridged.description, "Plain");
});

// ─── bridgeMcpTool: result data ──────────────────────────────────────────────

test("bridged do() prefers structuredContent for model-visible data", async () => {
  const tool: McpToolDef = { name: "t", inputSchema: { type: "object" } };
  const bridged = bridgeMcpTool(
    fakeConn({
      content: [{ type: "text", text: "fallback text" }],
      structuredContent: { count: 3 },
    }),
    tool,
    true,
  );
  const res = await bridged.do({}, undefined as never, undefined as never);
  assert.equal(res.status, "success");
  assert.equal(res.data, JSON.stringify({ count: 3 }));
  // full content[] still available for renderers
  assert.deepEqual(res.renderData, [{ type: "text", text: "fallback text" }]);
});

test("bridged do() falls back to joined text without structuredContent", async () => {
  const tool: McpToolDef = { name: "t", inputSchema: { type: "object" } };
  const bridged = bridgeMcpTool(fakeConn({ content: [{ type: "text", text: "hello" }] }), tool, true);
  const res = await bridged.do({}, undefined as never, undefined as never);
  assert.equal(res.data, "hello");
});

test("bridged do() surfaces an error result unchanged", async () => {
  const tool: McpToolDef = { name: "t", inputSchema: { type: "object" } };
  const bridged = bridgeMcpTool(
    fakeConn({ content: [{ type: "text", text: "boom" }], isError: true }),
    tool,
    true,
  );
  const res = await bridged.do({}, undefined as never, undefined as never);
  assert.equal(res.status, "error");
  assert.equal(res.message, "boom");
});
