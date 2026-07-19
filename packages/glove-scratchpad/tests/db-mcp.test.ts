import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import { Database } from "../src/db/database";
import { mcpResources, mountMcpDatabase } from "../src/db/mcp";

/** A minimal in-memory MCP connection for tests. */
function fakeConn(
  tools: McpToolDef[],
  handler: (name: string, args: unknown) => unknown,
): McpServerConnection {
  return {
    namespace: "srv",
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

test("mcpResources turns a read tool into a queryable resource", async () => {
  const conn = fakeConn(
    [
      {
        name: "list_prs",
        description: "list pull requests",
        inputSchema: { type: "object", properties: {}, required: [] },
        annotations: { readOnlyHint: true },
      },
    ],
    () => [
      { title: "feat: x", merged: true },
      { title: "wip: y", merged: false },
    ],
  );
  const db = await Database.create();
  const names = await mountMcpDatabase(db, conn, {
    table: (t) =>
      t.name === "list_prs"
        ? {
            name: "github_pr",
            op: "select",
            volatility: "stable",
            columns: [{ name: "title", type: "text" }, { name: "merged", type: "boolean" }],
            rows: (d) => JSON.parse(d as string),
          }
        : null,
  });
  assert.deepEqual(names, ["github_pr"]);
  const r = await db.execute(`SELECT title FROM github_pr WHERE merged = true`);
  assert.deepEqual(r.rows, [{ title: "feat: x" }]);
});

test("a write tool (no readOnlyHint) defaults to an insertable resource", async () => {
  const sent: unknown[] = [];
  const conn = fakeConn(
    [
      {
        name: "create_issue",
        description: "create an issue",
        inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      },
    ],
    (_name, args) => {
      sent.push(args);
      return { ok: true };
    },
  );
  const resources = await mcpResources(conn);
  assert.equal(resources.length, 1);
  const issue = resources[0];
  assert.equal(issue.name, "create_issue");
  assert.ok(issue.insert && !issue.select, "write tool → insert-only resource");

  const db = await Database.create({ policy: { writes: true } });
  db.register(issue);
  await db.execute(`INSERT INTO create_issue (title) VALUES ('bug: x')`);
  assert.deepEqual(sent, [{ title: "bug: x" }]);
});

test("mcpResources mounts no table for a tool the connection excludes (bubble-through)", async () => {
  const { includeTool } = await import("glove-mcp");
  const excludeTools = new Set(["delete_repository"]);
  const all = [
    { name: "list_pull_requests", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "delete_repository", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
  ];
  const conn = {
    namespace: "github",
    async listTools() {
      return all.filter((t) => includeTool(t, { excludeTools }));
    },
    async callTool() {
      return { content: [], isError: false };
    },
    async close() {},
    raw: {},
  };
  const resources = await mcpResources(conn as never);
  assert.deepEqual(resources.map((r) => r.name), ["list_pull_requests"]);
});
