import assert from "node:assert/strict";
import test from "node:test";
import { applySort, applyWhere, coerce, isComputed, validateWrite } from "../src/schema";
import type { Column, Page } from "../src/model";

const schema: Record<string, Column> = {
  Name: { type: "title" },
  Status: { type: "status", options: ["To do", "In progress", "Done"] },
  Tags: { type: "multiSelect", options: ["infra", "urgent"] },
  Due: { type: "date" },
  Owner: { type: "people" },
  Estimate: { type: "number" },
  Link: { type: "url" },
  Ref: { type: "relation" },
  Shipped: { type: "checkbox" },
  Files: { type: "files" },
  Key: { type: "uniqueId" },
  Mood: { type: "vibe" },
};

test("plain values pass through, normalized", () => {
  const out = validateWrite(schema, {
    Name: "Ship it",
    Status: "Done",
    Tags: ["infra"],
    Due: "2026-09-30",
    Estimate: 3,
    Shipped: true,
    Ref: ["page-1", { id: "page-2" }],
    Owner: "user-1",
  });
  assert.equal(out.Name, "Ship it");
  assert.equal(out.Status, "Done");
  assert.deepEqual(out.Tags, ["infra"]);
  assert.deepEqual(out.Due, { start: "2026-09-30" });
  assert.equal(out.Estimate, 3);
  assert.equal(out.Shipped, true);
  assert.deepEqual(out.Ref, ["page-1", "page-2"]);
  // A single value where the column takes many is what a caller writes, and
  // it is unambiguous.
  assert.deepEqual(out.Owner, ["user-1"]);
});

test("a Date and a range both reach a date column", () => {
  assert.deepEqual(coerce("Due", schema.Due, new Date("2026-09-30T00:00:00.000Z")), {
    start: "2026-09-30T00:00:00.000Z",
  });
  assert.deepEqual(coerce("Due", schema.Due, { start: "2026-09-01", end: "2026-09-05", timeZone: "UTC" }), {
    start: "2026-09-01",
    end: "2026-09-05",
    timeZone: "UTC",
  });
});

test("clearing a column is different from omitting it", () => {
  assert.equal(coerce("Estimate", schema.Estimate, null), null);
  assert.equal(coerce("Status", schema.Status, ""), null);
  assert.equal(coerce("Link", schema.Link, null), null);
  assert.deepEqual(coerce("Tags", schema.Tags, null), []);
});

test("a column that does not exist fails naming the ones that do", () => {
  assert.throws(
    () => validateWrite(schema, { Statuss: "Done" }),
    /no column named "Statuss".*has Name, Status/s,
  );
});

test("an option outside the defined set is refused, with the set", () => {
  // A typo silently creating a fourteenth status is worse than a refusal.
  assert.throws(() => validateWrite(schema, { Status: "in progress" }), /expected one of "To do", "In progress", "Done"/);
  assert.throws(() => validateWrite(schema, { Tags: ["infr"] }), /expected one of "infra", "urgent"/);
});

test("a value of the wrong shape fails naming the column", () => {
  assert.throws(() => validateWrite(schema, { Estimate: "three" }), /"Estimate" is a number column/);
  assert.throws(() => validateWrite(schema, { Files: [{ name: "x" }] }), /"Files" is a files column/);
});

test("a number that arrived as a string still lands", () => {
  // It came out of a CSV, a form, or a template literal. Refusing it teaches
  // nothing the caller can act on.
  assert.equal(validateWrite(schema, { Estimate: "42" }).Estimate, 42);
});

test("a computed column is refused with the reason", () => {
  assert.throws(() => validateWrite(schema, { Key: "BUG-9" }), /the backend computes it and refuses writes/);
  for (const type of ["rollup", "formula", "createdAt", "updatedBy", "button", "verification"]) {
    assert.equal(isComputed({ type }), true, type);
  }
  assert.equal(isComputed({ type: "text" }), false);
  // A provider that knows better wins over the default either way.
  assert.equal(isComputed({ type: "text", computed: true }), true);
  assert.equal(isComputed({ type: "formula", computed: false }), false);
});

test("a column type the model does not name passes through untouched", () => {
  // The enum is open. Refusing a whole write over one unrecognized type would
  // make base the thing standing between a provider and its own backend.
  assert.deepEqual(validateWrite(schema, { Mood: { unexpected: true } }).Mood, { unexpected: true });
});

const rows: Page[] = [
  { id: "a", title: "Alpha", properties: { Status: "Done", Estimate: 3, Tags: ["infra"], Due: { start: "2026-09-10" } } },
  { id: "b", title: "Beta", properties: { Status: "In progress", Estimate: 8, Tags: [], Due: { start: "2026-09-01" } } },
  { id: "c", title: "Gamma", properties: { Status: "In progress", Estimate: 1, Tags: ["urgent"] } },
];

test("the in-memory filter covers what a backend could not push down", () => {
  const open = applyWhere(rows, [{ property: "Status", op: "isNot", value: "Done" }]);
  assert.deepEqual(open.map((r) => r.id), ["b", "c"]);

  assert.deepEqual(applyWhere(rows, [{ property: "Estimate", op: "gte", value: 3 }]).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(applyWhere(rows, [{ property: "Tags", op: "contains", value: "urgent" }]).map((r) => r.id), ["c"]);
  assert.deepEqual(applyWhere(rows, [{ property: "Due", op: "isEmpty" }]).map((r) => r.id), ["c"]);
  assert.deepEqual(applyWhere(rows, [{ property: "title", op: "startsWith", value: "ga" }]).map((r) => r.id), ["c"]);
});

test("a date compares by its start, so a caller can pass a string", () => {
  assert.deepEqual(applyWhere(rows, [{ property: "Due", op: "lte", value: "2026-09-05" }]).map((r) => r.id), ["b"]);
  assert.deepEqual(applyWhere(rows, [{ property: "Due", op: "is", value: "2026-09-10" }]).map((r) => r.id), ["a"]);
});

test("conditions combine, either way", () => {
  const and = applyWhere(
    rows,
    [{ property: "Status", op: "is", value: "In progress" }, { property: "Estimate", op: "lt", value: 5 }],
    "and",
  );
  assert.deepEqual(and.map((r) => r.id), ["c"]);

  const or = applyWhere(
    rows,
    [{ property: "Status", op: "is", value: "Done" }, { property: "Estimate", op: "lt", value: 2 }],
    "or",
  );
  assert.deepEqual(or.map((r) => r.id), ["a", "c"]);
});

test("sorting is multi-key and stable", () => {
  assert.deepEqual(applySort(rows, [{ property: "Estimate" }]).map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(
    applySort(rows, [{ property: "Estimate", direction: "desc" }]).map((r) => r.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    applySort(rows, [{ property: "Status" }, { property: "Estimate" }]).map((r) => r.id),
    ["a", "c", "b"],
  );
  // Equal keys keep their original order rather than whatever the sort felt like.
  assert.deepEqual(applySort(rows, [{ property: "Missing" }]).map((r) => r.id), ["a", "b", "c"]);
});
