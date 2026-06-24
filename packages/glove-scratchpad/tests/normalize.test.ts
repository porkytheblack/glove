import { test } from "node:test";
import assert from "node:assert/strict";
import { planNormalization, RID, PARENT, IDX } from "../src/core/normalize";

test("scalar value → scalar record with a typed value column", () => {
  const plan = planNormalization(42, "n");
  assert.equal(plan.kind, "scalar");
  assert.equal(plan.tables.length, 1);
  const root = plan.tables[0];
  assert.equal(root.columns.length, 1);
  assert.deepEqual(root.columns[0], { name: "value", field: "value", type: "bigint" });
  assert.deepEqual(root.rows, [{ [RID]: 1, value: 42 }]);
});

test("string value → text record carrying textLength", () => {
  const plan = planNormalization("hello world", "s");
  assert.equal(plan.kind, "text");
  assert.equal(plan.textLength, 11);
  assert.equal(plan.tables[0].columns[0].type, "text");
  assert.equal(plan.tables[0].rows[0].value, "hello world");
});

test("object: scalars → columns, nested array → child table, nested object → jsonb", () => {
  const plan = planNormalization(
    { id: 1, name: "a", active: true, tags: ["x", "y"], meta: { deep: { n: 1 } } },
    "rec",
  );
  assert.equal(plan.kind, "table");
  const root = plan.tables.find((t) => t.role === "root")!;
  const byName = Object.fromEntries(root.columns.map((c) => [c.name, c.type]));
  assert.equal(byName.id, "bigint");
  assert.equal(byName.name, "text");
  assert.equal(byName.active, "boolean");
  assert.equal(byName.meta, "jsonb"); // nested object stays in jsonb
  assert.ok(!("tags" in byName)); // array was pulled out into a child table
  assert.ok(root.jsonbCols.includes("meta"));

  const child = plan.tables.find((t) => t.role === "child");
  assert.ok(child, "tags child table exists");
  assert.equal(child!.parentField, "tags");
  assert.equal(child!.table, "rec__tags");
  // scalar array → single `value` column, with FK + order columns
  assert.equal(child!.columns[0].name, "value");
  assert.equal(child!.rows.length, 2);
  assert.equal(child!.rows[0][PARENT], 1);
  assert.equal(child!.rows[0][IDX], 0);
  assert.equal(child!.rows[1][IDX], 1);

  // nested object coerced to a JSON string for the jsonb column
  assert.equal(root.rows[0].meta, JSON.stringify({ deep: { n: 1 } }));
});

test("array of objects: union of keys, _idx preserves order", () => {
  const plan = planNormalization([{ a: 1 }, { a: 2, b: "x" }], "rows");
  const root = plan.tables[0];
  const names = root.columns.map((c) => c.name).sort();
  assert.deepEqual(names, ["a", "b"]);
  assert.equal(root.hasIdx, true);
  assert.equal(root.rows[0][IDX], 0);
  assert.equal(root.rows[1][IDX], 1);
  assert.equal(root.rows[1].b, "x");
});

test("array of objects with a nested array of objects → child table", () => {
  const plan = planNormalization(
    [{ id: 1, items: [{ sku: "a" }, { sku: "b" }] }],
    "orders",
  );
  const child = plan.tables.find((t) => t.parentField === "items");
  assert.ok(child, "items child table exists");
  assert.equal(child!.columns.find((c) => c.name === "sku")?.type, "text");
  assert.equal(child!.rows.length, 2);
  // child elements' own deeper structure would be jsonb (no grandchild tables)
});

test("mixed scalar types in a field fall back to jsonb (lossless)", () => {
  const plan = planNormalization([{ v: 1 }, { v: "two" }], "mix");
  const col = plan.tables[0].columns.find((c) => c.name === "v")!;
  assert.equal(col.type, "jsonb");
});
