/**
 * Compile-time guarantees of the Zod resource path. This file asserts, via
 * `@ts-expect-error`, that the schema genuinely flows end to end — a typo in a
 * column name, key, or write payload is a TYPE error, not a silent runtime bug.
 * `pnpm typecheck` fails if any of these stop being errors. There is one runtime
 * test so the node runner counts the file.
 */
import { test } from "node:test";
import { z } from "zod";
import { defineResource } from "../src/index";

const schema = z.object({ number: z.number().int(), title: z.string(), merged: z.boolean() });

// Never called — the compiler still checks the bodies, so these are pure
// compile-time assertions. (Some are invalid at runtime by design.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeAssertions() {
// `bindings.one(col)` autocompletes the schema's columns and rejects unknowns.
defineResource({
  name: "a",
  volatility: "stable",
  schema,
  keys: ["number"],
  select: async (b) => {
    // @ts-expect-error — "nope" is not a column of the schema
    b.one("nope");
    return [{ title: "x", merged: true }];
  },
});

// `keys` must name real schema properties.
// @ts-expect-error — "not_a_col" is not a property of the schema
defineResource({
  name: "b",
  volatility: "stable",
  schema,
  keys: ["not_a_col"],
  select: async () => [],
});

// `insert` rows are typed to the schema.
defineResource({
  name: "c",
  volatility: "stable",
  schema,
  insert: async (rows) => {
    // @ts-expect-error — { nope } is not a row of the schema
    rows.push({ nope: 1 });
    return rows.length;
  },
});

// `update`'s `set` is a partial of the schema row.
defineResource({
  name: "d",
  volatility: "stable",
  schema,
  keys: ["number"],
  update: async (set, b) => {
    // @ts-expect-error — "nope" is not a settable column
    set.nope = 1;
    return { set, key: b.one("number") };
  },
});
}

void _typeAssertions; // reference it so it isn't flagged unused

test("zod resource types (compile-time only)", () => {});
