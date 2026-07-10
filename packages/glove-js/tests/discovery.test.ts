/** Progressive discovery — servers()/fns(server) builtins, native tools, and the
 *  progressive vs full preamble. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn } from "glove-scratchpad/fns";
import { JsSession } from "../src/session";
import { buildJsPreamble, buildDiscoveryTools } from "../src/mount";

function fixture(): JsSession {
  const s = JsSession.create();
  const mk = (name: string) =>
    defineFn({ name, description: `${name} desc`, input: z.object({ state: z.string().optional() }), readOnlyHint: true, handler: () => [{ id: 1 }] });
  s.registerAll([mk("github__list_pull_requests"), mk("github__create_issue"), mk("sentry__list_issues")]);
  return s;
}

test("servers() and fns(server) scope by origin; fns() returns all", async () => {
  const s = fixture();
  assert.deepEqual(((await s.execute("servers().map(x => x.name)")).value as string[]).sort(), ["github", "sentry"]);
  assert.deepEqual((await s.execute("fns('sentry').map(f => f.name)")).value, ["sentry__list_issues"]);
  assert.equal(((await s.execute("fns()")).value as unknown[]).length, 3);
});

test("fns() on an unknown server suggests the closest", async () => {
  await assert.rejects(() => fixture().execute("fns('githbu')"), /no server named 'githbu' — did you mean 'github'/);
});

test("progressive preamble primes no signatures; full does", () => {
  const s = fixture();
  assert.doesNotMatch(buildJsPreamble(s, "progressive"), /- github__list_pull_requests\(/);
  assert.match(buildJsPreamble(s, "progressive"), /list_servers/);
  assert.match(buildJsPreamble(s, "full"), /- github__list_pull_requests\(/);
});

test("native discovery tools mirror the builtins; a call still fires after discovery", async () => {
  const s = fixture();
  const [listServers, listFunctions] = buildDiscoveryTools(s);
  const servers = (await listServers.do({}, null as never, null as never)).data as Array<{ name: string }>;
  assert.deepEqual(servers.map((x) => x.name).sort(), ["github", "sentry"]);
  const fns = (await listFunctions.do({ server: "github" } as never, null as never, null as never)).data as Array<{ name: string }>;
  assert.equal(fns.length, 2);
  assert.equal(((await s.execute("github.list_pull_requests({ state: 'open' })")).value as unknown[]).length, 1);
});
