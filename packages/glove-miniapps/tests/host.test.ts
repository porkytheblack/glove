import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createAppHost, EXAMPLE_APP, isMiniAppError, type AppDefinition, type AppHost, type Backend } from "../src/index";
import { BACKENDS } from "./backends";

const me = "agent:planner";
const other = "agent:reviewer";

/** A clock the test moves by hand. */
function clock(start = "2026-10-19T09:00:00.000Z") {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms), set: (iso: string) => void (t = Date.parse(iso)) };
}

const tasks: AppDefinition = {
  name: "tasks",
  description: "Open tasks and when they were done",
  schema: {
    tasks: {
      columns: {
        id: { type: "integer", primaryKey: true },
        title: { type: "text", unique: true },
        done: { type: "boolean", default: false },
        meta: { type: "json", nullable: true },
        created_at: { type: "timestamp" },
      },
    },
  },
  methods: {
    add: {
      kind: "action",
      description: "Add a task",
      params: { title: { type: "string" }, meta: { type: "object", optional: true } },
      sql: "INSERT INTO tasks (title, meta, created_at) VALUES (:title, :meta, :now) RETURNING id, title, done, meta",
      returns: "one",
      emits: "added",
    },
    open: { kind: "query", description: "Open tasks, oldest first", sql: "SELECT id, title, done, meta FROM tasks WHERE done = false ORDER BY id" },
    count: { kind: "query", description: "How many tasks", sql: "SELECT count(*) AS n FROM tasks", returns: "one" },
    complete: {
      kind: "action",
      description: "Mark a task done",
      params: { id: { type: "integer" } },
      js: [
        "const row = db.one({ sql: 'UPDATE tasks SET done = true WHERE id = :id AND done = false RETURNING id, title', params: { id: args.id } });",
        "if (!row) throw new Error('no open task ' + args.id);",
        "app.emit({ event: 'completed', data: { id: row.id, title: row.title } });",
        "row",
      ].join("\n"),
    },
    add_many_then_fail: {
      kind: "action",
      description: "Adds two tasks, then fails",
      js: "db.query({ sql: \"INSERT INTO tasks (title, created_at) VALUES ('a', :now)\" }); db.query({ sql: \"INSERT INTO tasks (title, created_at) VALUES ('b', :now)\" }); throw new Error('changed my mind')",
    },
    swallow: {
      kind: "action",
      description: "Breaks a constraint and catches the error",
      params: { title: { type: "string" } },
      js: "try { db.query({ sql: 'INSERT INTO tasks (title, created_at) VALUES (:t, :now)', params: { t: args.title } }); } catch (e) {} 'ok'",
    },
    spin: { kind: "query", description: "Never finishes", js: "let i = 0; while (true) { i++; } i" },
    sneaky: { kind: "query", description: "A query that tries to write", js: "db.query({ sql: \"DELETE FROM tasks\" })" },
  },
};

async function withHost(make: () => Promise<{ backend: Backend; cleanup(): Promise<void> }>, run: (host: AppHost, c: ReturnType<typeof clock>) => Promise<void>) {
  const { backend, cleanup } = await make();
  const c = clock();
  const host = await createAppHost({ backend, clock: c.now, fuel: 20_000 });
  try {
    await run(host, c);
  } finally {
    await host.close();
    await cleanup();
  }
}

for (const B of BACKENDS) {
  describe(`on ${B.name}`, () => {
    test("the deploy tool's worked example deploys, runs and reports", () =>
      withHost(B.make, async (host, c) => {
        const r = await host.deploy(EXAMPLE_APP, { as: me });
        assert.equal(r.created, true);
        assert.equal(r.version, 1);
        for (const day of ["2026-10-17", "2026-10-18", "2026-10-19"]) {
          await host.call("habits", "check_in", { habit: "run", day }, { as: me });
        }
        const checked = await host.call("habits", "check_in", { habit: "read", day: "2026-10-19", note: "ch. 3" }, { as: me });
        assert.deepEqual(checked.value, { id: 4, habit: "read", day: "2026-10-19" });
        assert.equal(checked.events[0].event, "checked_in");
        assert.equal((await host.call("habits", "streak", { habit: "run" }, { as: me })).value, 3);
        assert.equal((await host.call("habits", "streak", { habit: "swim" }, { as: me })).value, 0);
        const out = await host.output("habits", "weekly", { as: me });
        assert.equal(out.markdown, true);
        assert.equal(out.value, "- read: 1 of 7 days\n- run: 3 of 7 days");
        c.advance(1000);
      }));

    test("values come back the same on every backend", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        const added = await host.call("tasks", "add", { title: "write the spec", meta: { tags: ["kuiper"], n: 2 } }, { as: me });
        assert.deepEqual(added.value, { id: 1, title: "write the spec", done: false, meta: { tags: ["kuiper"], n: 2 } });
        await host.call("tasks", "add", { title: "no meta" }, { as: me });
        const open = await host.call<any[]>("tasks", "open", {}, { as: me });
        assert.deepEqual(open.value.map((t) => [t.id, t.done, t.meta]), [[1, false, { tags: ["kuiper"], n: 2 }], [2, false, null]]);
        assert.deepEqual((await host.call("tasks", "count", {}, { as: me })).value, { n: 2 });
      }));

    test("an action is all or nothing", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        await assert.rejects(host.call("tasks", "add_many_then_fail", {}, { as: me }), (e) => isMiniAppError(e, "failed") && /changed my mind/.test(e.message) && /nothing was changed/.test(e.message));
        assert.deepEqual((await host.call("tasks", "count", {}, { as: me })).value, { n: 0 });

        // Keys are unique and increasing, not gapless: Postgres keeps the keys
        // a rolled-back action took. So use the key the insert returns.
        const { id } = (await host.call<{ id: number }>("tasks", "add", { title: "one" }, { as: me })).value;
        await assert.rejects(host.call("tasks", "add", { title: "one" }, { as: me }), (e) => isMiniAppError(e, "constraint"));
        // Catching the error inside the program does not let half an action commit.
        await assert.rejects(host.call("tasks", "swallow", { title: "one" }, { as: me }), (e) => isMiniAppError(e, "constraint"));
        assert.deepEqual((await host.call("tasks", "count", {}, { as: me })).value, { n: 1 });

        await assert.rejects(host.call("tasks", "complete", { id: 42 }, { as: me }), /no open task 42/);
        const done = await host.call("tasks", "complete", { id }, { as: me });
        assert.deepEqual(done.events.map((e) => [e.event, e.data]), [["completed", { id, title: "one" }]]);
        const log = await host.events("tasks", { as: me });
        assert.deepEqual(log.map((e) => e.event), ["_deployed", "added", "completed"]);
        assert.equal(log[1].caller, me);
      }));

    test("queries cannot write, and runaway methods stop", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        await assert.rejects(host.call("tasks", "sneaky", {}, { as: me }), (e) => isMiniAppError(e, "invalid") && /reads only/.test(e.message));
        await assert.rejects(host.call("tasks", "spin", {}, { as: me }), (e) => isMiniAppError(e, "budget"));
        const bad = structuredClone(tasks);
        bad.name = "bad";
        bad.methods.open = { kind: "query", description: "x", sql: "UPDATE tasks SET done = true" };
        await assert.rejects(host.deploy(bad, { as: me }), (e) => isMiniAppError(e, "invalid") && e.details!.some((d) => /a query reads only/.test(d)));
      }));

    test("arguments are checked against the method's parameters", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        await assert.rejects(host.call("tasks", "add", {}, { as: me }), /needs "title"/);
        await assert.rejects(host.call("tasks", "add", { title: 3 }, { as: me }), /"title" is string/);
        await assert.rejects(host.call("tasks", "add", { title: "x", colour: "red" }, { as: me }), /no parameter "colour"/);
        await assert.rejects(host.call("tasks", "nope", {}, { as: me }), (e) => isMiniAppError(e, "not_found"));
      }));

    test("additive changes migrate themselves; renames need ops; data survives", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        await host.call("tasks", "add", { title: "keep me" }, { as: me });

        const v2 = structuredClone(tasks);
        v2.schema.tasks.columns.priority = { type: "integer", default: 2 };
        v2.schema.tasks.columns.notes = { type: "text", nullable: true };
        v2.schema.tasks.indexes = [["done"]];
        v2.schema.labels = { columns: { name: { type: "text", primaryKey: true } } };
        v2.methods.by_priority = { kind: "query", description: "Tasks by priority", sql: "SELECT title, priority FROM tasks ORDER BY priority, id" };
        const up = await host.deploy(v2, { as: me });
        assert.equal(up.version, 2);
        assert.deepEqual(up.migration.map((o) => o.op).sort(), ["add_column", "add_column", "add_index", "create_table"]);
        assert.deepEqual((await host.call("tasks", "by_priority", {}, { as: me })).value, [{ title: "keep me", priority: 2 }]);

        // A rename is not additive: refused without ops, with the difference spelled out.
        const v3 = structuredClone(v2);
        v3.schema.tasks.columns.rank = v3.schema.tasks.columns.priority;
        delete v3.schema.tasks.columns.priority;
        v3.methods.by_priority.sql = "SELECT title, rank FROM tasks ORDER BY rank, id";
        await assert.rejects(host.deploy(v3, { as: me }), (e) => isMiniAppError(e, "invalid") && e.details!.includes("tasks.rank is missing"));
        // Ops that don't produce the declared schema are refused before anything runs.
        await assert.rejects(
          host.deploy(v3, { as: me, migration: { ops: [{ op: "drop_column", table: "tasks", column: "priority" }] } }),
          (e) => isMiniAppError(e, "invalid") && /does not produce/.test(e.message),
        );
        const ops = [
          { op: "rename_column", table: "tasks", from: "priority", to: "rank" },
          { op: "sql", sql: "UPDATE tasks SET rank = rank * 10" },
        ] as const;
        const dry = await host.deploy(v3, { as: me, migration: { ops: [...ops] }, dryRun: true });
        assert.equal(dry.dryRun, true);
        assert.deepEqual((await host.call("tasks", "by_priority", {}, { as: me })).value, [{ title: "keep me", priority: 2 }]);
        assert.equal((await host.describe("tasks", { as: me })).version, 2);

        await host.deploy(v3, { as: me, migration: { ops: [...ops] } });
        assert.deepEqual((await host.call("tasks", "by_priority", {}, { as: me })).value, [{ title: "keep me", rank: 20 }]);

        const v4 = structuredClone(v3);
        v4.schema.todo = v4.schema.tasks;
        delete v4.schema.tasks;
        delete v4.schema.labels;
        v4.methods = { all: { kind: "query", description: "Everything", sql: "SELECT title, rank, done FROM todo" } };
        await host.deploy(v4, {
          as: me,
          migration: { ops: [{ op: "rename_table", from: "tasks", to: "todo" }, { op: "drop_table", table: "labels" }] },
        });
        assert.deepEqual((await host.call("tasks", "all", {}, { as: me })).value, [{ title: "keep me", rank: 20, done: false }]);
      }));

    test("a failed migration leaves the old version running", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        await host.call("tasks", "add", { title: "a" }, { as: me });
        const v2 = structuredClone(tasks);
        v2.schema.tasks.columns.score = { type: "integer", nullable: true };
        const v2Add = { op: "add_column", table: "tasks", column: "score", def: { type: "integer", nullable: true } } as const;
        await assert.rejects(host.deploy(v2, { as: me, migration: { ops: [v2Add, { op: "sql", sql: "UPDATE tasks SET nonsense = 1" }] } }));
        await assert.rejects(
          host.deploy(v2, { as: me, migration: { ops: [v2Add, { op: "sql", sql: "SELECT set_config('search_path', 'elsewhere', false) AS x FROM tasks" }] } }),
          (e) => isMiniAppError(e, "invalid") && /migration op 2/.test(e.message),
        );
        const d = await host.describe("tasks", { as: me });
        assert.equal(d.version, 1);
        assert.equal(d.schema.tasks.columns.score, undefined);
        assert.deepEqual((await host.call("tasks", "count", {}, { as: me })).value, { n: 1 });
        // and the app still takes writes
        await host.call("tasks", "add", { title: "b" }, { as: me });
      }));

    test("apps are private until shared, and sharing is per method", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        assert.deepEqual(await host.list({ as: other }), []);
        await assert.rejects(host.call("tasks", "open", {}, { as: other }), (e) => isMiniAppError(e, "not_found"));
        await assert.rejects(host.deploy({ ...tasks, description: "mine now" }, { as: other }), (e) => isMiniAppError(e, "forbidden"));

        await host.grant("tasks", { to: other, methods: ["open"] }, { as: me });
        const seen = await host.list({ as: other });
        assert.deepEqual(seen.map((a) => [a.name, a.access, a.methods.map((m) => m.name)]), [["tasks", "granted", ["open"]]]);
        assert.deepEqual((await host.call("tasks", "open", {}, { as: other })).value, []);
        await assert.rejects(host.call("tasks", "add", { title: "x" }, { as: other }), (e) => isMiniAppError(e, "forbidden"));
        await assert.rejects(host.events("tasks", { as: other }), (e) => isMiniAppError(e, "forbidden"));
        assert.equal((await host.describe("tasks", { as: other })).definition, undefined);
        assert.ok((await host.describe("tasks", { as: me })).definition);

        await host.revoke("tasks", other, { as: me });
        await assert.rejects(host.call("tasks", "open", {}, { as: other }), (e) => isMiniAppError(e, "not_found"));
      }));

    test("an app reacts to another app's events, once it is allowed to", () =>
      withHost(B.make, async (host) => {
        await host.deploy(tasks, { as: me });
        const ledger: AppDefinition = {
          name: "ledger",
          description: "Points earned for finished tasks",
          schema: { points: { columns: { id: { type: "integer", primaryKey: true }, task: { type: "integer" }, title: { type: "text" }, source: { type: "text" } } } },
          methods: {
            award: {
              kind: "action",
              description: "Award a point for a task",
              params: { id: { type: "integer" }, title: { type: "string" } },
              sql: "INSERT INTO points (task, title, source) VALUES (:id, :title, :caller)",
            },
            total: { kind: "query", description: "Points so far", sql: "SELECT count(*) AS points FROM points", returns: "one" },
            sources: { kind: "query", description: "Who awarded points", sql: "SELECT DISTINCT source FROM points" },
            // reading another app from inside a method
            open_tasks: { kind: "query", description: "Open tasks, via the tasks app", js: "apps.query({ app: 'tasks', method: 'open' }).length" },
          },
          subscriptions: [{ on: "tasks.completed", run: "award" }],
        };
        // Another principal's app needs the events grant first.
        const r = await host.deploy(ledger, { as: other });
        assert.match(r.warnings[0], /has not granted you its events/);
        await host.call("tasks", "add", { title: "a" }, { as: me });
        let done = await host.call("tasks", "complete", { id: 1 }, { as: me });
        assert.deepEqual(done.deliveries ?? [], []);
        assert.deepEqual((await host.call("ledger", "total", {}, { as: other })).value, { points: 0 });

        await host.grant("tasks", { to: other, methods: ["open"], events: true }, { as: me });
        await host.call("tasks", "add", { title: "b" }, { as: me });
        done = await host.call("tasks", "complete", { id: 2 }, { as: me });
        assert.deepEqual(done.deliveries, [{ app: "ledger", method: "award", event: "tasks.completed", ok: true }]);
        assert.deepEqual((await host.call("ledger", "total", {}, { as: other })).value, { points: 1 });
        assert.equal((await host.call("ledger", "open_tasks", {}, { as: other })).value, 0);
        // The subscribed action runs as the source app.
        assert.deepEqual((await host.call("ledger", "sources", {}, { as: other })).value, [{ source: "app:tasks" }]);
      }));

    test("outputs run when they are due", () =>
      withHost(B.make, async (host, c) => {
        const seen: string[] = [];
        await host.deploy(EXAMPLE_APP, { as: me });
        await host.call("habits", "check_in", { habit: "run", day: "2026-10-19" }, { as: me });
        assert.deepEqual(await host.tick(), []);
        c.advance(6 * 86_400_000);
        assert.deepEqual(await host.tick(), []);
        await host.call("habits", "check_in", { habit: "run", day: "2026-10-25" }, { as: me });
        c.advance(86_400_000);
        const due = await host.tick();
        assert.deepEqual(due.map((o) => [o.app, o.output]), [["habits", "weekly"]]);
        seen.push(String(due[0].value));
        assert.deepEqual(await host.tick(), [], "and not again until the next week");
        assert.match(seen[0], /run: 1 of 7 days/);
      }));
  });
}

for (const B of BACKENDS) {
  test(`apps survive a restart on ${B.name}`, async (t) => {
    const made = await B.make();
    if (!made.reopen && B.name !== "memory") return t.skip("this backend does not persist");
    let backend = made.backend;
    let host = await createAppHost({ backend });
    await host.deploy(tasks, { as: me });
    await host.call("tasks", "add", { title: "survives" }, { as: me });
    await host.grant("tasks", { to: other, methods: "*" }, { as: me });
    const snapshot = await backend.snapshot?.();
    await host.close();

    backend = made.reopen ? made.reopen() : (await import("../src/index")).memoryBackend({ load: snapshot });
    host = await createAppHost({ backend });
    const open = await host.call<any[]>("tasks", "open", {}, { as: other });
    assert.deepEqual(open.value.map((r) => r.title), ["survives"]);
    assert.equal((await host.call<any>("tasks", "add", { title: "next" }, { as: me })).value.id, 2);
    await host.close();
    await made.cleanup();
  });
}
