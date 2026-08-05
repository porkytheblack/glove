/**
 * The fn catalog on the working environment.
 *
 * `glove-working-environment`'s `defineTools` declares its `ToolFn` shape
 * structurally so that package can stay zero-dependency — which means nothing
 * in either package's own build would notice if these two definitions drifted
 * apart. This is the test that would.
 *
 * It is also the only place the three mounting routes are exercised together:
 * a hand-authored fn, a Glove tool, and a whole MCP server, all reaching the
 * same script as ordinary imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { McpServerConnection, McpToolDef } from "glove-mcp";
import { createWorkingEnvironment, defineTools } from "glove-working-environment";
import { defineFn, fnFromTool, type ToolFn } from "../src/fns";
import { fnsFromMcp } from "../src/fns/mcp";

/** A minimal in-memory MCP connection, as in fns-mcp.test.ts. */
function fakeConn(tools: McpToolDef[], handler: (name: string, args: unknown) => unknown): McpServerConnection {
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

/**
 * The compile-time half. If either `ToolFn` gains a required member the other
 * lacks, this assignment stops typechecking — which is the whole point of
 * writing it down.
 */
test("a catalog fn is a defineTools fn, at the type level and at runtime", async () => {
  const fn: ToolFn = defineFn({
    name: "add",
    description: "Add two numbers.",
    input: z.object({ a: z.number(), b: z.number() }),
    handler: ({ a, b }: { a: number; b: number }) => a + b,
  });

  const env = await createWorkingEnvironment({ stdlib: [defineTools({ name: "math", fns: [fn] })] });
  try {
    const write = env.tools.find((t) => t.name === "write_file")!;
    const run = env.tools.find((t) => t.name === "run_script")!;
    const w = await write.do({
      path: "/scripts/sum.js",
      content:
        `import { add } from 'env:math';\n` +
        `export default async function () { return await add({ a: 2, b: 40 }); }\n`,
    });
    assert.equal(w.status, "success", String(w.message));
    const r = await run.do({ path: "/scripts/sum.js" });
    assert.equal(r.status, "success", String(r.message));
    assert.match(String(r.data ?? ""), /42/);
  } finally {
    await env.close();
  }
});

test("defineFn's Zod schema reaches the script as a typed .d.ts", async () => {
  const fn = defineFn({
    name: "search",
    description: "Search the index.",
    input: z.object({ query: z.string(), limit: z.number().optional() }),
    handler: () => [],
  });
  const env = await createWorkingEnvironment({ stdlib: [defineTools({ name: "index", fns: [fn] })] });
  try {
    const dts = await env.fs.readFile("/std/index/index.d.ts");
    assert.match(dts, /export function search\(/);
    assert.match(dts, /query: string/);
    assert.match(dts, /limit\?: number/);
  } finally {
    await env.close();
  }
});

test("a Glove tool, an MCP server and a hand-written fn all mount as one module", async () => {
  const searchTool = {
    name: "search_web",
    description: "Search the web.",
    inputSchema: z.object({ query: z.string() }),
    async do(input: { query: string }): Promise<ToolResultData> {
      return { status: "success", data: JSON.stringify([{ title: `hit for ${input.query}` }]) };
    },
  } as unknown as GloveFoldArgs<any>;

  const conn = fakeConn(
    [
      {
        name: "list_pull_requests",
        description: "List merged PRs.",
        inputSchema: { type: "object", properties: { since: { type: "string" } }, required: ["since"] },
        annotations: { readOnlyHint: true },
      } as McpToolDef,
    ],
    (_name, args) => [{ title: `merged since ${(args as { since: string }).since}` }],
  );

  const fns: ToolFn[] = [
    fnFromTool(searchTool),
    ...(await fnsFromMcp(conn)),
    defineFn({ name: "today", description: "Today's date.", handler: () => "2026-08-05" }),
  ];

  const env = await createWorkingEnvironment({
    stdlib: [defineTools({ name: "capabilities", fns, description: "Everything this agent can reach." })],
  });
  try {
    const write = env.tools.find((t) => t.name === "write_file")!;
    const run = env.tools.find((t) => t.name === "run_script")!;

    // The shape of the ask that motivated all of this: gather from several
    // capabilities, reduce in the script, write one file. None of the
    // intermediate records ever enter the context window.
    const w = await write.do({
      path: "/scripts/weekly.js",
      content:
        `import { search_web, github__list_pull_requests, today } from 'env:capabilities';\n` +
        `import { writeFile } from 'env:fs';\n` +
        `export default async function () {\n` +
        `  const since = await today();\n` +
        `  const prs = await github__list_pull_requests({ since });\n` +
        `  const web = await search_web({ query: 'glove release notes' });\n` +
        `  const lines = [...prs, ...web].map(x => '- ' + x.title);\n` +
        `  await writeFile('/out/weekly.md', lines.join('\\n'));\n` +
        `  return lines.length;\n` +
        `}\n`,
    });
    assert.equal(w.status, "success", String(w.message));

    const r = await run.do({ path: "/scripts/weekly.js" });
    assert.equal(r.status, "success", String(r.message));
    assert.equal(
      await env.fs.readFile("/out/weekly.md"),
      "- merged since 2026-08-05\n- hit for glove release notes",
    );
  } finally {
    await env.close();
  }
});

test("the MCP namespace survives the trip, so `server__tool` stays importable", async () => {
  const conn = fakeConn(
    [{ name: "create_issue", description: "Open an issue.", inputSchema: { type: "object", properties: {} } } as McpToolDef],
    () => ({ number: 7 }),
  );
  const fns = await fnsFromMcp(conn);
  assert.deepEqual(fns.map((f) => f.name), ["github__create_issue"]);
  // Double underscore is a valid JS identifier; defineTools accepts it as-is.
  assert.doesNotThrow(() => defineTools({ name: "github", fns }));
});
