/** fnsFromMcp — result-shape seeding from a server-declared outputSchema. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import { fnsFromMcp } from "../src/fns/mcp";
import { fnSignature, describeFn } from "../src/fns";

/** A minimal in-memory MCP connection for tests. */
function fakeConn(
  tools: McpToolDef[],
  handler: (name: string, args: unknown) => unknown,
): McpServerConnection {
  return {
    namespace: "github",
    async listTools() {
      return tools;
    },
    async callTool(name, args) {
      const out = handler(name, args);
      return {
        content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }],
        isError: false,
      } as never;
    },
    async close() {},
    raw: {} as never,
  };
}

test("fnsFromMcp seeds resultShape from a declared outputSchema without sampling", async () => {
  let called = 0;
  const conn = fakeConn(
    [
      {
        name: "list_pull_requests",
        description: "List PRs",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "array",
          items: {
            type: "object",
            properties: { number: { type: "integer" }, merged: { type: "boolean" } },
          },
        },
        annotations: { readOnlyHint: true },
      },
    ],
    () => {
      called++;
      return [{ number: 1, merged: true }];
    },
  );

  const [fn] = await fnsFromMcp(conn);
  assert.equal(fn.resultShape, "{ number: number, merged: boolean }[]");
  assert.equal(called, 0, "a declared shape must not trigger a live sample call");

  // The shape flows into both discovery surfaces.
  assert.match(fnSignature(fn), /→ \{ number: number, merged: boolean \}\[\]/);
  assert.equal(describeFn(fn).returns, "{ number: number, merged: boolean }[]");
});

test("fnsFromMcp keeps the original description (shape not shown twice)", async () => {
  const conn = fakeConn(
    [
      {
        name: "list_pull_requests",
        description: "List PRs",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "array",
          items: { type: "object", properties: { number: { type: "integer" } } },
        },
        annotations: { readOnlyHint: true },
      },
    ],
    () => [],
  );

  const [fn] = await fnsFromMcp(conn);
  // The bridged tool appends "Returns: …" to its description for the plain path;
  // the fn surfaces the shape via resultShape, so its description stays clean.
  assert.equal(fn.description, "List PRs");
  assert.doesNotMatch(fn.description ?? "", /Returns:/);
});

test("fnsFromMcp leaves resultShape unset when the server declares no outputSchema", async () => {
  const conn = fakeConn(
    [
      {
        name: "search",
        description: "Search",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
    ],
    () => [],
  );
  const [fn] = await fnsFromMcp(conn);
  assert.equal(fn.resultShape, undefined);
});
