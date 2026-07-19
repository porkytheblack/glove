/** Progressive discovery in function mode — (servers)/(fns :server) builtins,
 *  native tools, and the progressive vs full preamble. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { LispSession } from "../src/session";
import { buildLispPreamble, buildDiscoveryTools } from "../src/mount";

function fixture(): LispSession {
  const s = LispSession.create({ policy: { writes: true } });
  const mk = (name: string) =>
    defineFn({ name, description: `${name} desc`, input: z.object({ state: z.string().optional() }), readOnlyHint: true, handler: () => [{ id: 1 }] });
  s.registerFns([mk("github__list_pull_requests"), mk("github__create_issue"), mk("sentry__list_issues")]);
  return s;
}

test("(servers) and (fns :server) scope by origin; (fns) returns all", async () => {
  const s = fixture();
  assert.deepEqual(((await s.execute("(map :name (servers))")).value as string[]).sort(), ["github", "sentry"]);
  assert.deepEqual((await s.execute("(map :name (fns :sentry))")).value, ["sentry__list_issues"]);
  assert.equal(((await s.execute("(fns)")).value as unknown[]).length, 3);
});

test("(fns :unknown) suggests the closest server", async () => {
  await assert.rejects(() => fixture().execute("(fns :githbu)"), /no server named "githbu" — did you mean :github/);
});

test("(search \"…\") ranks matching functions in the REPL", async () => {
  const hits = (await fixture().execute('(map :name (search "pull requests"))')).value as string[];
  assert.ok(hits.includes("github__list_pull_requests"));
});

test("(describe :name) warms the result shape lazily — nothing sampled at mount", async () => {
  let calls = 0;
  const s = LispSession.create({ policy: { writes: true } });
  s.registerFns([defineFn({ name: "github__list_pull_requests", input: z.object({ state: z.string().optional() }), readOnlyHint: true, handler: () => { calls++; return [{ number: 1 }]; } })]);
  await s.execute("(servers)");
  assert.equal(calls, 0);
  const d = (await s.execute('(describe :github__list_pull_requests)')).value as { returns?: string };
  assert.equal(calls, 1);
  assert.match(String(d.returns), /number/);
});

test("progressive preamble primes no fn signatures; full does", () => {
  const s = fixture();
  assert.doesNotMatch(buildLispPreamble(s, "progressive"), /- \(github__list_pull_requests/);
  assert.match(buildLispPreamble(s, "progressive"), /\(servers\)/);
  assert.match(buildLispPreamble(s, "full"), /- \(github__list_pull_requests/);
});

test("native discovery tools mirror the builtins; a call still fires after discovery", async () => {
  const s = fixture();
  const [searchFunctions, listServers, listFunctions, describeFunction] = buildDiscoveryTools(s);
  const servers = (await listServers.do({}, null as never, null as never)).data as Array<{ name: string }>;
  assert.deepEqual(servers.map((x) => x.name).sort(), ["github", "sentry"]);
  assert.equal(((await listFunctions.do({ server: "github" } as never, null as never, null as never)).data as unknown[]).length, 2);
  assert.equal((( await describeFunction.do({ name: "sentry__list_issues" } as never, null as never, null as never)).data as { name: string }).name, "sentry__list_issues");
  const hits = (await searchFunctions.do({ query: "pull requests" } as never, null as never, null as never)).data as Array<{ name: string }>;
  assert.ok(hits.some((h) => h.name === "github__list_pull_requests"));
  assert.equal(((await s.execute('(github__list_pull_requests {:state "open"})')).value as unknown[]).length, 1);
});

test("native-tool-name aliases are callable in the REPL ((list_servers)/(list_functions)/(search_functions)/(describe_function))", async () => {
  const s = fixture();
  assert.deepEqual(((await s.execute("(map :name (list_servers))")).value as string[]).sort(), ["github", "sentry"]);
  assert.equal(((await s.execute("(count (list_functions :github))")).value as number), 2);
  assert.equal(((await s.execute("(count (list_functions))")).value as number), 3);
  assert.ok(
    ((await s.execute('(map :name (search_functions "pull requests"))')).value as string[]).includes(
      "github__list_pull_requests",
    ),
  );
  assert.equal(((await s.execute("(:name (describe_function :github__create_issue))")).value as string), "github__create_issue");
});

test("an alias name cannot be registered as a function (reserved)", () => {
  const s = fixture();
  assert.throws(() => s.registerFn(defineFn({ name: "list_functions", handler: () => 1 })), /already/);
});
