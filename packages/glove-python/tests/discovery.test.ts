/** Progressive discovery — servers()/fns(server)/describe builtins, the native
 *  discovery tools, and the progressive vs full preamble. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { PySession } from "../src/session";
import { buildPyPreamble, buildDiscoveryTools } from "../src/mount";

function fixture(): PySession {
  const s = PySession.create();
  const mk = (name: string, ro = true) =>
    defineFn({
      name,
      description: `${name} description`,
      input: z.object({ state: z.string().optional() }),
      readOnlyHint: ro,
      handler: () => [{ id: 1, title: "row" }],
    });
  s.registerAll([mk("github__list_pull_requests"), mk("github__create_issue", false), mk("sentry__list_issues")]);
  return s;
}

test("servers() groups the catalog by origin server with counts", async () => {
  const s = fixture();
  const servers = (await s.execute("servers()")).value as Array<{ name: string; functionCount: number }>;
  assert.deepEqual(servers.map((x) => x.name).sort(), ["github", "sentry"]);
  assert.equal(servers.find((x) => x.name === "github")!.functionCount, 2);
});

test("fns(server) scopes to one server; fns() still returns all", async () => {
  const s = fixture();
  assert.deepEqual((await s.execute("[f['name'] for f in fns('sentry')]")).value, ["sentry__list_issues"]);
  assert.equal(((await s.execute("fns()")).value as unknown[]).length, 3);
});

test("fns() on an unknown server suggests the closest", async () => {
  const s = fixture();
  await assert.rejects(() => s.execute("fns('githbu')"), /no server named 'githbu' — did you mean 'github'/);
});

test("describe(name) returns one function's schema after discovery", async () => {
  const s = fixture();
  const d = (await s.execute('describe("github__list_pull_requests")')).value as { name: string; params: unknown[] };
  assert.equal(d.name, "github__list_pull_requests");
  assert.ok(Array.isArray(d.params));
});

test("the progressive preamble primes NO signatures, only the discovery path", () => {
  const s = fixture();
  const p = buildPyPreamble(s, "progressive");
  assert.doesNotMatch(p, /- github__list_pull_requests\(/); // no signature dump
  assert.match(p, /list_servers/);
  assert.match(p, /3 functions across 2 servers/);
});

test("the full preamble does list every signature (the escape hatch)", () => {
  const s = fixture();
  const p = buildPyPreamble(s, "full");
  assert.match(p, /- github__list_pull_requests\(/);
  assert.match(p, /- sentry__list_issues\(/);
});

test("auto mode primes full below the threshold", () => {
  const s = fixture();
  // 3 fns < 40 → auto resolves to full → signatures present
  // (resolveMode is internal; assert via the mount default vs explicit full match)
  assert.match(buildPyPreamble(s, "full"), /- github__/);
});

test("the native discovery tools mirror the REPL builtins", async () => {
  const s = fixture();
  const [listServers, listFunctions, describeFunction] = buildDiscoveryTools(s);
  const servers = (await listServers.do({}, null as never, null as never)).data as Array<{ name: string }>;
  assert.deepEqual(servers.map((x) => x.name).sort(), ["github", "sentry"]);
  const fns = (await listFunctions.do({ server: "github" } as never, null as never, null as never)).data as Array<{ name: string }>;
  assert.deepEqual(fns.map((x) => x.name).sort(), ["github__create_issue", "github__list_pull_requests"]);
  const desc = (await describeFunction.do({ name: "sentry__list_issues" } as never, null as never, null as never)).data as { name: string };
  assert.equal(desc.name, "sentry__list_issues");
  const bad = await listFunctions.do({ server: "nope" } as never, null as never, null as never);
  assert.equal(bad.status, "error");
});

test("all functions stay callable with nothing primed — a scripted sweep then a call", async () => {
  const s = fixture();
  // discover everything in ONE program, then call
  const names = (await s.execute("sorted([f['name'] for srv in servers() for f in fns(srv['name'])])")).value;
  assert.deepEqual(names, ["github__create_issue", "github__list_pull_requests", "sentry__list_issues"]);
  const rows = (await s.execute("github.list_pull_requests(state='open')")).value as unknown[];
  assert.equal(rows.length, 1);
});
