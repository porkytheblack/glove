import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOps,
  compileNamed,
  defineMiniApp,
  deriveAdditiveOps,
  diffSchemas,
  EXAMPLE_APP,
  inspectStatement,
  checkStatement,
  isMiniAppError,
  parseInterval,
  validateDefinition,
  type AppDefinition,
  type Schema,
} from "../src/index";

const base: Schema = {
  notes: { columns: { id: { type: "integer", primaryKey: true }, body: { type: "text" } } },
};

test("named parameters skip literals, quoted names, comments and casts", () => {
  const c = compileNamed(`SELECT ':no', "a:b", x::text, :id, :id + :n -- :gone\n/* :also */ FROM t WHERE s = 'it''s :not'`);
  assert.deepEqual(c.names, ["id", "n"]);
  assert.equal(c.text, `SELECT ':no', "a:b", x::text, $1, $1 + $2 -- :gone\n/* :also */ FROM t WHERE s = 'it''s :not'`);
  assert.equal(compileNamed("SELECT :a, :b", (n) => `?${n}`).text, "SELECT ?1, ?2");
});

test("statement inspection reports reads and writes, minus CTEs", () => {
  const info = inspectStatement("WITH recent AS (SELECT * FROM notes) UPDATE tags SET n = 1 WHERE id IN (SELECT id FROM recent)", "x");
  assert.equal(info.kind, "update");
  assert.deepEqual(info.writes, ["tags"]);
  assert.deepEqual(info.reads, ["notes"]);
});

test("method SQL stays inside the app and inside the portable subset", () => {
  const schema: Schema = { tasks: { columns: { id: { type: "integer", primaryKey: true } } } };
  const check = (sql: string) => () => checkStatement(sql, "query", schema, "m");
  assert.throws(check("SELECT * FROM public.tasks"), /"public\." is outside the app/);
  assert.throws(check("SELECT table_name FROM information_schema.tables"), /outside the app/);
  assert.throws(check("SELECT * FROM other_app.tasks"), /no table "other_app.tasks"/);
  // On a shared Postgres role this would move search_path to another app's schema.
  assert.throws(check("SELECT set_config('search_path', 'miniapp_other', false) AS x FROM tasks"), /set_config\(\) does not run the same/);
  assert.throws(check("SELECT now() AS t FROM tasks"), /:now for the time/);
  assert.doesNotThrow(check("SELECT t.id, coalesce(max(t.id), 0) AS m FROM tasks t WHERE 'public.x' <> '' GROUP BY t.id"));
});

test("ops apply to the schema value, and refuse what cannot apply", () => {
  const next = applyOps(base, [
    { op: "add_column", table: "notes", column: "pinned", def: { type: "boolean", default: false } },
    { op: "rename_column", table: "notes", from: "body", to: "text" },
    { op: "add_index", table: "notes", columns: ["pinned"] },
  ]);
  assert.deepEqual(Object.keys(next.notes.columns), ["id", "text", "pinned"]);
  assert.deepEqual(next.notes.indexes, [["pinned"]]);
  assert.deepEqual(base.notes.indexes, undefined, "the input is not touched");
  assert.throws(() => applyOps(base, [{ op: "add_column", table: "notes", column: "due", def: { type: "timestamp" } }]), /required and has no default/);
  assert.throws(() => applyOps(base, [{ op: "drop_column", table: "notes", column: "id" }]), /primary key cannot be dropped/);
  assert.throws(() => applyOps(base, [{ op: "create_table", table: "_sneaky", def: base.notes }]), /reserved/);
});

test("additive changes derive their ops; anything else does not", () => {
  const added: Schema = structuredClone(base);
  added.notes.columns.tag = { type: "text", nullable: true };
  added.tags = { columns: { name: { type: "text", primaryKey: true } } };
  assert.deepEqual(deriveAdditiveOps(base, added)?.map((o) => o.op), ["add_column", "create_table"]);
  const renamed: Schema = { notes: { columns: { id: base.notes.columns.id, text: { type: "text" } } } };
  assert.equal(deriveAdditiveOps(base, renamed), undefined);
  assert.deepEqual(diffSchemas(base, renamed), ["notes.text is missing", "notes.body is not in the new schema"]);
});

test("a definition is checked as a whole, and every problem is named", () => {
  assert.doesNotThrow(() => defineMiniApp(EXAMPLE_APP));
  const bad = {
    name: "Bad-Name",
    description: "",
    schema: { notes: { columns: { body: { type: "varchar" } } } },
    methods: {
      list: { kind: "query", description: "x", sql: "DELETE FROM notes" },
      add: { kind: "action", description: "x", sql: "INSERT INTO notez (body) VALUES (:body)" },
      both: { kind: "query", description: "x", sql: "SELECT 1", js: "1" },
      undeclared: { kind: "query", description: "x", sql: "SELECT * FROM notes WHERE body = :what" },
      broken: { kind: "query", description: "x", js: "class A {}" },
    },
    outputs: { daily: { description: "x", every: "10s", sql: "SELECT 1" } },
  } as unknown as AppDefinition;
  try {
    validateDefinition(bad);
    assert.fail("should not validate");
  } catch (err) {
    assert.ok(isMiniAppError(err, "invalid"));
    const d = err.details!.join("\n");
    for (const expected of [/name "Bad-Name"/, /description/, /type must be one of/, /a query reads only/, /no table "notez"/, /exactly one of sql or js/, /:what is not a parameter/, /method "broken"/, /every is a number and a unit/]) {
      assert.match(d, expected);
    }
  }
});

test("cadences", () => {
  assert.equal(parseInterval("30m"), 1_800_000);
  assert.equal(parseInterval("7d"), 604_800_000);
  assert.throws(() => parseInterval("1m"), /shortest cadence is 5m/);
});
