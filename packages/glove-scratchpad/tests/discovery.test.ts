/** Progressive-discovery helpers — server grouping over a flat ToolFn catalog. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineFn, serverOf, groupByServer, serverSummaries, fnsForServer, type ToolFn } from "../src/fns";

const withServer = (name: string, server?: string, serverDescription?: string): ToolFn => ({
  name,
  ...(server ? { server } : {}),
  ...(serverDescription ? { serverDescription } : {}),
  async call() {
    return null;
  },
});

test("serverOf prefers the explicit field, falls back to the __ prefix", () => {
  assert.equal(serverOf(withServer("github__list_prs", "github")), "github");
  assert.equal(serverOf(withServer("github__list_prs")), "github"); // derived from name
  assert.equal(serverOf(withServer("bare")), undefined); // stdlib-style, ungrouped
});

test("groupByServer buckets functions by origin, first-seen order", () => {
  const fns = [withServer("github__a", "github"), withServer("sentry__x", "sentry"), withServer("github__b", "github")];
  const groups = groupByServer(fns);
  assert.deepEqual([...groups.keys()], ["github", "sentry"]);
  assert.equal(groups.get("github")!.length, 2);
});

test("serverSummaries reports name, description, count, and a name sample", () => {
  const fns = [
    withServer("github__a", "github", "GitHub — issues and PRs"),
    withServer("github__b", "github"),
    withServer("sentry__x", "sentry"),
  ];
  const s = serverSummaries(fns);
  const gh = s.find((x) => x.name === "github")!;
  assert.equal(gh.functionCount, 2);
  assert.equal(gh.description, "GitHub — issues and PRs");
  assert.deepEqual(gh.sample, ["github__a", "github__b"]);
  assert.equal(s.find((x) => x.name === "sentry")!.functionCount, 1);
});

test("fnsForServer scopes to one server", () => {
  const fns = [withServer("github__a", "github"), withServer("sentry__x", "sentry"), withServer("github__b", "github")];
  assert.deepEqual(fnsForServer(fns, "github").map((f) => f.name), ["github__a", "github__b"]);
  assert.deepEqual(fnsForServer(fns, "sentry").map((f) => f.name), ["sentry__x"]);
  assert.deepEqual(fnsForServer(fns, "nope"), []);
});

test("hand-authored fns without a server or __ prefix fall into (ungrouped)", () => {
  const groups = groupByServer([defineFn({ name: "helper", handler: () => 1 })]);
  assert.ok(groups.has("(ungrouped)"));
});
