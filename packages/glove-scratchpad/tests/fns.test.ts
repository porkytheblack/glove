/** The function-catalog layer — catalog, defineFn, fnFromTool, fnsFromMcp, signatures. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import {
  assertFnName,
  defineFn,
  FnCatalog,
  fnFromTool,
  parseToolData,
  type ToolFn,
} from "../src/fns";
import { describeFn, fnSignature, missingRequired, unknownKeys } from "../src/fns/signature";
import { fnsFromMcp } from "../src/fns/mcp";
import type { McpServerConnection, McpToolDef } from "glove-mcp";

// ── FnCatalog ────────────────────────────────────────────────────────────────

test("FnCatalog registers, lists, and rejects duplicates", () => {
  const cat = new FnCatalog();
  const a = defineFn({ name: "alpha", handler: () => 1 });
  cat.register(a);
  assert.equal(cat.get("alpha"), a);
  assert.deepEqual(cat.names(), ["alpha"]);
  assert.throws(() => cat.register(defineFn({ name: "alpha", handler: () => 2 })), /already registered/);
});

test("FnCatalog rejects invalid identifier names", () => {
  const cat = new FnCatalog();
  assert.throws(() => cat.register(defineFn({ name: "has space", handler: () => 1 })), /invalid function name/);
  assert.throws(() => assertFnName("3leading"), /invalid function name/);
  assert.throws(() => assertFnName("has-dash"), /invalid function name/);
  assert.doesNotThrow(() => assertFnName("github__list_prs"));
  assert.doesNotThrow(() => assertFnName("_ok0"));
});

test("registerAll folds a whole catalog", () => {
  const cat = new FnCatalog();
  cat.registerAll([defineFn({ name: "a", handler: () => 1 }), defineFn({ name: "b", handler: () => 2 })]);
  assert.deepEqual(cat.names().sort(), ["a", "b"]);
});

// ── defineFn ─────────────────────────────────────────────────────────────────

test("defineFn with a Zod schema converts to JSON Schema and validates at call time", async () => {
  const fn = defineFn({
    name: "greet",
    description: "Greet someone",
    input: z.object({ name: z.string(), loud: z.boolean().optional() }),
    handler: (args) => `hi ${args.name}${args.loud ? "!" : ""}`,
  });
  assert.equal((fn.inputSchema as { type?: string }).type, "object");
  assert.equal(await fn.call({ name: "Ada" }), "hi Ada");
  assert.equal(await fn.call({ name: "Ada", loud: true }), "hi Ada!");
  await assert.rejects(() => fn.call({} as Record<string, unknown>), /greet:/);
});

test("defineFn passes ctx through to the handler", async () => {
  const seen: unknown[] = [];
  const fn = defineFn({
    name: "peek",
    handler: (_args, ctx) => {
      seen.push(ctx.actor);
      return null;
    },
  });
  await fn.call({}, { actor: "tester" });
  assert.deepEqual(seen, ["tester"]);
});

test("defineFn without a schema accepts any object", async () => {
  const fn = defineFn({ name: "echo", handler: (args) => args });
  assert.deepEqual(await fn.call({ anything: 1 }), { anything: 1 });
  assert.equal(fn.inputSchema, undefined);
});

// ── fnFromTool ───────────────────────────────────────────────────────────────

function tool(overrides: Partial<GloveFoldArgs<any>> & { do: GloveFoldArgs<any>["do"] }): GloveFoldArgs<any> {
  return { name: "t", description: "a tool", inputSchema: z.object({}), ...overrides } as GloveFoldArgs<any>;
}

test("fnFromTool wraps a Zod tool and validates input", async () => {
  const fn = fnFromTool(
    tool({
      name: "search",
      description: "Search the web",
      inputSchema: z.object({ query: z.string() }),
      async do(input): Promise<ToolResultData> {
        return { status: "success", data: [{ title: `for ${input.query}` }] };
      },
    }),
  );
  assert.equal(fn.name, "search");
  assert.equal((fn.inputSchema as { type?: string }).type, "object");
  assert.deepEqual(await fn.call({ query: "sql" }), [{ title: "for sql" }]);
  await assert.rejects(() => fn.call({} as Record<string, unknown>), /query/);
});

test("fnFromTool wraps a jsonSchema (MCP-style) tool and skips Zod validation", async () => {
  const fn = fnFromTool(
    tool({
      name: "raw",
      inputSchema: undefined,
      jsonSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      async do(input: any): Promise<ToolResultData> {
        return { status: "success", data: `got ${input.q}` };
      },
    } as any),
  );
  assert.deepEqual(fn.inputSchema, { type: "object", properties: { q: { type: "string" } }, required: ["q"] });
  assert.equal(await fn.call({ q: "hi" }), "got hi");
});

test("fnFromTool turns an error result into a thrown Error", async () => {
  const fn = fnFromTool(
    tool({
      async do(): Promise<ToolResultData> {
        return { status: "error", message: "boom", data: null };
      },
    }),
  );
  await assert.rejects(() => fn.call({}), /boom/);
});

test("fnFromTool honors opts.name and readOnlyHint", () => {
  const fn = fnFromTool(tool({ name: "orig", async do() { return { status: "success", data: 1 }; } }), {
    name: "renamed",
    readOnlyHint: true,
  });
  assert.equal(fn.name, "renamed");
  assert.equal(fn.readOnlyHint, true);
});

// ── parseToolData ────────────────────────────────────────────────────────────

test("parseToolData parses JSON-looking strings and falls back on garbage", () => {
  assert.deepEqual(parseToolData('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolData("[1,2,3]"), [1, 2, 3]);
  assert.deepEqual(parseToolData("  [1]  "), [1]);
  assert.equal(parseToolData("{not json"), "{not json");
  assert.equal(parseToolData("plain text"), "plain text");
  assert.equal(parseToolData(42), 42);
  assert.deepEqual(parseToolData({ already: "object" }), { already: "object" });
});

// ── fnsFromMcp ───────────────────────────────────────────────────────────────

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

const mcpTools: McpToolDef[] = [
  {
    name: "list_pull_requests",
    description: "List PRs",
    inputSchema: { type: "object", properties: { state: { type: "string" } }, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_issue",
    description: "Open an issue",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
];

test("fnsFromMcp namespaces, parses JSON results, and propagates readOnlyHint", async () => {
  const conn = fakeConn(mcpTools, (name) =>
    name === "list_pull_requests" ? [{ number: 1, state: "open" }] : { ok: true },
  );
  const fns = await fnsFromMcp(conn);
  const byName = new Map(fns.map((f) => [f.name, f]));
  assert.deepEqual([...byName.keys()].sort(), ["github__create_issue", "github__list_pull_requests"]);
  assert.equal(byName.get("github__list_pull_requests")!.readOnlyHint, true);
  assert.equal(byName.get("github__create_issue")!.readOnlyHint, undefined);
  assert.deepEqual(await byName.get("github__list_pull_requests")!.call({ state: "open" }), [
    { number: 1, state: "open" },
  ]);
});

test("fnsFromMcp filter can skip and rename tools", async () => {
  const conn = fakeConn(mcpTools, () => "ok");
  const skipped = await fnsFromMcp(conn, { filter: (t) => (t.name === "create_issue" ? null : undefined) });
  assert.deepEqual(skipped.map((f) => f.name), ["github__list_pull_requests"]);

  const renamed = await fnsFromMcp(conn, {
    filter: (t) => (t.name === "list_pull_requests" ? "prs" : null),
  });
  assert.deepEqual(renamed.map((f) => f.name), ["prs"]);
});

test("fnsFromMcp surfaces tool errors as thrown Errors", async () => {
  const conn: McpServerConnection = {
    namespace: "github",
    async listTools() {
      return [mcpTools[1]];
    },
    async callTool() {
      return { content: [{ type: "text", text: "rejected: bad title" }], isError: true } as never;
    },
    async close() {},
    raw: {} as never,
  };
  const [fn] = await fnsFromMcp(conn);
  await assert.rejects(() => fn.call({ title: "x" }), /rejected: bad title/);
});

// ── signature helpers ────────────────────────────────────────────────────────

const listPrs: ToolFn = {
  name: "github__list_pull_requests",
  description: "List pull requests\nwith more detail on a second line",
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "owner/name" },
      state: { type: "string", enum: ["open", "closed", "merged"] },
      limit: { type: "integer" },
    },
    required: ["repo"],
  },
  readOnlyHint: true,
  async call() {
    return [];
  },
};

test("fnSignature renders required-first with enums and a one-line description", () => {
  const sig = fnSignature(listPrs);
  assert.match(sig, /^github__list_pull_requests\(\{repo: string, /);
  assert.match(sig, /state\?: "open"\|"closed"\|"merged"/);
  assert.match(sig, /limit\?: number/);
  assert.match(sig, /— List pull requests$/);
  assert.doesNotMatch(sig, /second line/);
});

test("fnSignature renders args? for a schemaless fn and () for an empty object", () => {
  assert.match(fnSignature({ name: "anything", async call() {} }), /^anything\(args\?\)$/);
  assert.match(
    fnSignature({ name: "now", inputSchema: { type: "object", properties: {} }, async call() {} }),
    /^now\(\)$/,
  );
});

test("describeFn returns structured, required-first params with enum values", () => {
  const d = describeFn(listPrs);
  assert.equal(d.params[0].name, "repo");
  assert.equal(d.params[0].required, true);
  assert.equal(d.params[0].description, "owner/name");
  const state = d.params.find((p) => p.name === "state")!;
  assert.deepEqual(state.enum, ["open", "closed", "merged"]);
  assert.equal(d.readOnlyHint, true);
});

test("missingRequired names absent required keys", () => {
  assert.deepEqual(missingRequired(listPrs, {}), ["repo"]);
  assert.deepEqual(missingRequired(listPrs, { repo: "a/b" }), []);
});

test("unknownKeys flags undeclared keys with did-you-mean, respecting open schemas", () => {
  assert.deepEqual(unknownKeys(listPrs, { repo: "a/b", stat: "open" }), [{ key: "stat", hint: "state" }]);
  assert.deepEqual(unknownKeys(listPrs, { repo: "a/b" }), []);
  // A schemaless fn is open — nothing is "unknown".
  assert.deepEqual(unknownKeys({ name: "x", async call() {} }, { whatever: 1 }), []);
});
