import assert from "node:assert/strict";
import test from "node:test";
import {
  pageTitle,
  plainText,
  readParent,
  readProperties,
  readProperty,
  richText,
  toProperties,
  toPropertyValue,
} from "../src/model";
import { sampleRow, ROW_ID, PAGE_ID, DS_ID } from "./fake";

test("every property type flattens to something a script can use", () => {
  const row = sampleRow(ROW_ID, "Ship it", "In progress", "2026-09-30");
  const props = readProperties(row.properties as never);

  assert.equal(props.Name, "Ship it");
  assert.equal(props.Status, "In progress");
  assert.deepEqual(props.Tags, ["infra", "urgent"]);
  assert.deepEqual(props.Due, { start: "2026-09-30" });
  assert.deepEqual(props.Owner, [{ id: "user-1", name: "Ada" }]);
  assert.equal(props.Done, false);
  assert.equal(props.Estimate, 3);
  assert.equal(props.Link, "https://example.com");
  assert.deepEqual(props.Ref, [PAGE_ID]);
  assert.equal(props.Key, "BUG-42");
  assert.equal(props.Total, 12);
  assert.equal(props.Slug, "ship it");
  assert.deepEqual(props.Attach, [
    { name: "spec.pdf", url: "https://file.notion.so/f/spec.pdf?sig=abc", expires: "2026-09-01T11:00:00.000Z" },
  ]);
  assert.equal(props.Never, null);
});

test("a date range keeps its end; a bare date does not invent one", () => {
  assert.deepEqual(
    readProperty({ type: "date", date: { start: "2026-09-01", end: "2026-09-05", time_zone: "UTC" } } as never),
    { start: "2026-09-01", end: "2026-09-05", timeZone: "UTC" },
  );
  assert.deepEqual(readProperty({ type: "date", date: null } as never), null);
});

test("a unique id with no prefix stays a number", () => {
  assert.equal(readProperty({ type: "unique_id", unique_id: { prefix: null, number: 7 } } as never), 7);
});

test("a rollup of values reduces one level down", () => {
  const rollup = {
    type: "rollup",
    rollup: {
      type: "array",
      array: [
        { type: "date", date: { start: "2026-01-01" } },
        { type: "number", number: 4 },
      ],
    },
  };
  assert.deepEqual(readProperty(rollup as never), [{ start: "2026-01-01" }, 4]);
});

test("a property type nobody has modelled yet returns null instead of throwing", () => {
  // The enum grows. One unknown column must not break a script reading nine
  // others beside it.
  assert.equal(readProperty({ type: "place", place: { latitude: 1 } } as never), null);
  assert.equal(readProperty(undefined), null);
});

test("both parent shapes of the data source migration read the same way", () => {
  assert.deepEqual(readParent({ type: "data_source_id", data_source_id: DS_ID }), {
    type: "data_source",
    id: DS_ID,
  });
  assert.deepEqual(readParent({ type: "database_id", database_id: "db" }), { type: "database", id: "db" });
  assert.deepEqual(readParent({ type: "workspace", workspace: true }), { type: "workspace" });
  assert.deepEqual(readParent(undefined), { type: "unknown" });
});

test("plain values go back as the payloads the API wants", () => {
  const schema = {
    Name: { type: "title" },
    Status: { type: "status" },
    Tags: { type: "multi_select" },
    Due: { type: "date" },
    Done: { type: "checkbox" },
    Estimate: { type: "number" },
    Ref: { type: "relation" },
  };
  const payload = toProperties(
    { Name: "Ship it", Status: "Done", Tags: ["infra"], Due: "2026-09-30", Done: true, Estimate: 3, Ref: ["page-id"] },
    schema,
  );

  assert.equal((payload.Name.title as Array<{ text: { content: string } }>)[0].text.content, "Ship it");
  assert.deepEqual(payload.Status, { status: { name: "Done" } });
  assert.deepEqual(payload.Tags, { multi_select: [{ name: "infra" }] });
  assert.deepEqual(payload.Due, { date: { start: "2026-09-30" } });
  assert.deepEqual(payload.Done, { checkbox: true });
  assert.deepEqual(payload.Estimate, { number: 3 });
  assert.deepEqual(payload.Ref, { relation: [{ id: "page-id" }] });
});

test("clearing a property is different from omitting it", () => {
  assert.deepEqual(toPropertyValue("select", null), { select: null });
  assert.deepEqual(toPropertyValue("number", null), { number: null });
  assert.deepEqual(toPropertyValue("url", ""), { url: null });
});

test("a column Notion computes is refused with the reason", () => {
  for (const type of ["formula", "rollup", "unique_id", "created_time", "button", "last_edited_by"]) {
    assert.throws(() => toPropertyValue(type, "x", "Key"), /Notion computes it/);
  }
});

test("a wrong-shaped value fails naming the column, not a JSON path", () => {
  assert.throws(() => toPropertyValue("number", "three", '"Estimate"'), /"Estimate" is a number property/);
  assert.throws(() => toPropertyValue("multi_select", "infra", '"Tags"'), /array of option names/);
  assert.throws(() => toProperties({ Nope: 1 }, { Name: { type: "title" } }), /no property named "Nope".*has Name/s);
});

test("text past the API's span cap is split, not truncated", () => {
  const spans = richText("x".repeat(4500));
  assert.equal(spans.length, 3);
  assert.equal(plainText(spans.map((s) => ({ ...s, plain_text: s.text?.content }))), "x".repeat(4500));
  assert.deepEqual(richText(""), []);
});

test("a title is found wherever the schema put it", () => {
  assert.equal(pageTitle(sampleRow(ROW_ID, "Named", "Done") as never), "Named");
  assert.equal(pageTitle({ id: "x", properties: {} } as never), "");
});
