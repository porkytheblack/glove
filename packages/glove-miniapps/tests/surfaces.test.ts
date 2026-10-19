/**
 * The ways in: tools on an agent, functions in a working environment and a
 * REPL, and the same host over HTTP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsSession } from "glove-js";
import { createWorkingEnvironment, defineTools } from "glove-working-environment";
import {
  createAppHost,
  EXAMPLE_APP,
  isMiniAppError,
  memoryBackend,
  miniAppFns,
  mountMiniApps,
  remoteAppHost,
  serveMiniApps,
  type MiniAppTool,
} from "../src/index";

const me = "agent:planner";

function fakeAgent() {
  const tools = new Map<string, MiniAppTool>();
  const providers: Array<() => unknown> = [];
  return {
    tools,
    providers,
    fold(t: MiniAppTool) {
      tools.set(t.name, t);
    },
    replaceTools(previous: Iterable<string>, next: ReadonlyArray<MiniAppTool>) {
      for (const n of previous) tools.delete(n);
      for (const t of next) tools.set(t.name, t);
    },
    addContextProvider(p: () => unknown) {
      providers.push(p);
      return () => providers.splice(providers.indexOf(p), 1);
    },
    use: (name: string, input: unknown) => tools.get(name)!.do(input),
  };
}

test("an agent builds an app with its tools, then sees it and its methods", async () => {
  const host = await createAppHost({ backend: memoryBackend() });
  const agent = fakeAgent();
  const mounted = await mountMiniApps(agent, { host, as: me, exposeMethods: true });
  assert.deepEqual([...agent.tools.keys()].sort(), [
    "glove_miniapps_call",
    "glove_miniapps_deploy",
    "glove_miniapps_describe",
    "glove_miniapps_events",
    "glove_miniapps_list",
    "glove_miniapps_output",
    "glove_miniapps_share",
  ]);
  assert.match(String(await agent.providers[0]()), /no mini apps yet/);

  const deployed = await agent.use("glove_miniapps_deploy", { definition: EXAMPLE_APP });
  assert.equal(deployed.status, "success");
  assert.match(deployed.message!, /created habits v1/);
  // the per-method tools appeared without remounting
  assert.ok(agent.tools.has("app_habits__check_in"));
  assert.deepEqual(agent.tools.get("app_habits__streak")!.jsonSchema.required, ["habit"]);
  assert.equal((await agent.use("app_habits__check_in", { habit: "read", day: "2026-10-19" })).status, "success");
  assert.match(String(await agent.providers[0]()), /- habits v1 — Habits I'm tracking.*Methods: check_in!, streak; outputs: weekly/);

  // A mistake comes back as an error the model can read, with every detail.
  const bad = await agent.use("glove_miniapps_deploy", { definition: { ...EXAMPLE_APP, name: "habits2", methods: { x: { kind: "query", description: "x", sql: "SELECT * FROM nope" } } } });
  assert.equal(bad.status, "error");
  assert.match(bad.message!, /no table "nope"/);

  const shared = await agent.use("glove_miniapps_share", { app: "habits", to: "agent:coach", methods: ["streak"] });
  assert.deepEqual(shared.data, [{ to: "agent:coach", methods: ["streak"] }]);
  assert.deepEqual((await agent.use("glove_miniapps_share", { app: "habits", to: "agent:coach", methods: [] })).data, []);

  mounted.close();
  assert.equal(agent.providers.length, 0);
});

test("a working-environment script imports the agent's apps as env:apps", async () => {
  const host = await createAppHost({ backend: memoryBackend(), clock: () => new Date("2026-10-19T12:00:00Z") });
  await host.deploy(EXAMPLE_APP, { as: me });
  for (const day of ["2026-10-18", "2026-10-19"]) await host.call("habits", "check_in", { habit: "run", day }, { as: me });

  const env = await createWorkingEnvironment({ stdlib: [defineTools({ name: "apps", fns: miniAppFns({ host, as: me }) })] });
  try {
    const verb = (name: string) => env.tools.find((t) => t.name === name)!;
    const wrote = await verb("write_file").do({
      path: "/scripts/report.js",
      content: [
        "import { invoke, list } from 'env:apps';",
        "/** Summarise my habits into /out/habits.md */",
        "export default async function () {",
        "  const apps = await list({});",
        "  const rows = await invoke({ app: 'habits', method: 'check_in', args: { habit: 'read', day: '2026-10-19' } });",
        "  const streak = await invoke({ app: 'habits', method: 'streak', args: { habit: 'run' } });",
        "  return { apps: apps.map((a) => a.name), inserted: rows.id, streak };",
        "}",
      ].join("\n"),
    });
    assert.equal(wrote.status, "success", wrote.message);
    const ran = await verb("run_script").do({ path: "/scripts/report.js", args: {} });
    assert.equal(ran.status, "success", ran.message);
    // run_script reports to the model as text: a status line, then the result.
    const result = JSON.parse(String(ran.data).split("result:\n")[1]);
    assert.deepEqual(result, { apps: ["habits"], inserted: 3, streak: 2 });
  } finally {
    await env.close();
  }
});

test("a glove-js REPL takes the same functions unchanged", async () => {
  const host = await createAppHost({ backend: memoryBackend() });
  await host.deploy(EXAMPLE_APP, { as: me });
  const session = JsSession.create();
  session.registerAll(miniAppFns({ host, as: me }).map((f) => ({ ...f, name: `apps__${f.name}` })));
  const out = await session.execute("const r = apps.invoke({ app: 'habits', method: 'check_in', args: { habit: 'run', day: '2026-10-19' } }); [r.id, apps.list().map(a => a.name)]");
  assert.deepEqual(out.value, [1, ["habits"]]);
});

test("over HTTP the host behaves the same, and keys decide who is calling", async () => {
  const local = await createAppHost({ backend: memoryBackend() });
  const keys: Record<string, { principal: string; actAs?: (p: string) => boolean }> = {
    "k-planner": { principal: me },
    // A Foundry server's key: it acts for the agents of its own project.
    "k-foundry": { principal: "project:demo", actAs: (p) => p.startsWith("agent:") },
  };
  const handler = serveMiniApps(local, {
    base: "/apps/v1",
    authenticate: (req) => keys[(req.headers.get("authorization") ?? "").replace(/^Bearer /, "")] ?? null,
  });
  const fetchToHandler = (async (input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch;
  const remote = (apiKey: string) => remoteAppHost({ url: "https://gateway.example/apps/v1", apiKey, fetch: fetchToHandler });

  const planner = remote("k-planner");
  const r = await planner.deploy(EXAMPLE_APP, { as: me });
  assert.equal(r.created, true);
  const call = await planner.call("habits", "check_in", { habit: "run", day: "2026-10-19" }, { as: me });
  assert.deepEqual(call.value, { id: 1, habit: "run", day: "2026-10-19" });
  assert.equal((await planner.events("habits", { as: me, after: 0, limit: 10 })).at(-1)!.event, "checked_in");
  assert.equal((await planner.output("habits", "weekly", { as: me })).value, "- run: 1 of 7 days");

  // Errors keep their code across the wire.
  await assert.rejects(planner.call("habits", "check_in", {}, { as: me }), (e) => isMiniAppError(e, "invalid") && /needs "habit"/.test(e.message));
  await assert.rejects(planner.describe("nope", { as: me }), (e) => isMiniAppError(e, "not_found"));

  // A key cannot claim to be someone else unless it may act for them.
  await assert.rejects(remote("k-planner").list({ as: "agent:other" }), (e) => isMiniAppError(e, "forbidden"));
  await assert.rejects(remote("nope").list({ as: me }), /a valid key is required/);
  const foundry = remote("k-foundry");
  assert.deepEqual(await foundry.list({ as: "agent:other" }), []);
  await planner.grant("habits", { to: "agent:other", methods: ["streak"] }, { as: me });
  assert.deepEqual((await foundry.list({ as: "agent:other" })).map((a) => a.methods.map((m) => m.name)), [["streak"]]);
  assert.deepEqual(await foundry.tick(), []);
  await assert.rejects(planner.tick(), (e) => isMiniAppError(e, "forbidden"));
});
