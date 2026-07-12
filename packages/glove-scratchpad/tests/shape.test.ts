/** Result-shape discovery — deriveShape + sampleResultShapes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveShape, sampleResultShapes, defineFn, fnSignature, describeFn } from "../src/fns";

test("deriveShape renders a TS-like type for an array of objects", () => {
  const shape = deriveShape([
    { id: "a", count: 3, open: true },
    { id: "b", count: 5, open: false },
  ]);
  assert.equal(shape, "{ id: string, count: number, open: boolean }[]");
});

test("deriveShape folds a low-cardinality string column to an enum", () => {
  const shape = deriveShape([
    { status: "open" },
    { status: "closed" },
    { status: "open" },
  ]);
  assert.equal(shape, `{ status: "open"|"closed" }[]`);
});

test("deriveShape keeps a high-cardinality string column as string", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}` }));
  assert.equal(deriveShape(rows), "{ title: string }[]");
});

test("deriveShape handles scalars, empty arrays, and objects", () => {
  assert.equal(deriveShape(42), "number");
  assert.equal(deriveShape([]), "unknown[]");
  assert.equal(deriveShape({ a: 1, b: "x" }), `{ a: number, b: string }`);
});

test("sampleResultShapes populates readOnly fns callable with no required args", async () => {
  const calls = { list: 0, get: 0, send: 0 };
  const list = defineFn({
    name: "list_things",
    readOnlyHint: true,
    handler: () => {
      calls.list++;
      return [{ id: "x", state: "open" }, { id: "y", state: "done" }, { id: "z", state: "open" }];
    },
  });
  // required arg → not sampled by default
  const get = defineFn({
    name: "get_thing",
    readOnlyHint: true,
    input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: () => {
      calls.get++;
      return { id: "x" };
    },
  });
  // not read-only → never sampled (no effects fired)
  const send = defineFn({
    name: "send_thing",
    readOnlyHint: false,
    handler: () => {
      calls.send++;
      return { ok: true };
    },
  });

  await sampleResultShapes([list, get, send]);

  assert.equal(list.resultShape, `{ id: string, state: "open"|"done" }[]`);
  assert.equal(get.resultShape, undefined); // required arg → skipped
  assert.equal(send.resultShape, undefined); // effectful → never called
  assert.equal(calls.list, 1);
  assert.equal(calls.get, 0);
  assert.equal(calls.send, 0);
});

test("a sampled shape surfaces in fnSignature and describeFn", async () => {
  const fn = defineFn({
    name: "list_prs",
    description: "List PRs",
    readOnlyHint: true,
    handler: () => [{ number: 1, state: "open" }, { number: 2, state: "open" }],
  });
  await sampleResultShapes([fn]);
  assert.match(fnSignature(fn), /→ \{ number: number, state: "open" \}\[\]/);
  assert.equal(describeFn(fn).returns, `{ number: number, state: "open" }[]`);
});

test("a sampling error leaves the shape unset (no throw)", async () => {
  const fn = defineFn({
    name: "boom",
    readOnlyHint: true,
    handler: () => {
      throw new Error("upstream down");
    },
  });
  await sampleResultShapes([fn]);
  assert.equal(fn.resultShape, undefined);
});
