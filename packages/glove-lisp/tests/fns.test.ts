/** Function mode — register ToolFns as native Lisp functions (no ResourceTable). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineFn, type ToolFn } from "glove-scratchpad";
import { defineResource } from "glove-scratchpad";
import { z } from "zod";
import { LispSession } from "../src/session";

interface Fixture {
  session: LispSession;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fixture(): Fixture {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = LispSession.create();
  const prs = defineFn({
    name: "github__list_pull_requests",
    description: "List pull requests",
    input: z.object({ state: z.enum(["open", "merged", "closed"]).optional() }),
    readOnlyHint: true,
    handler: (args) => {
      calls.push({ name: "github__list_pull_requests", args });
      const rows = [
        { number: 1, state: "open", title: "Fix login" },
        { number: 2, state: "merged", title: "Add SSO" },
        { number: 3, state: "open", title: "Bump deps" },
      ];
      return args.state ? rows.filter((r) => r.state === args.state) : rows;
    },
  });
  const send = defineFn({
    name: "email__send",
    description: "Send an email",
    input: z.object({ to: z.string(), subject: z.string() }),
    readOnlyHint: false,
    handler: (args) => {
      calls.push({ name: "email__send", args });
      return { sent: true, to: args.to };
    },
  });
  session.registerFns([prs, send]);
  return { session, calls };
}

test("calling a function passes the argument map as tool input (keyword→string)", async () => {
  const { session, calls } = fixture();
  const r = await session.execute(`(github__list_pull_requests {:state "open"})`);
  assert.deepEqual(calls[0], { name: "github__list_pull_requests", args: { state: "open" } });
  assert.equal((r.value as unknown[]).length, 2);
});

test("a keyword VALUE is deep-converted to its name", async () => {
  const calls: Record<string, unknown>[] = [];
  const session = LispSession.create();
  session.registerFn(
    defineFn({
      name: "tag",
      input: z.object({ kind: z.string(), meta: z.record(z.string(), z.any()).optional() }),
      handler: (args) => {
        calls.push(args);
        return args;
      },
    }),
  );
  await session.execute(`(tag {:kind :urgent :meta {:nested :deep}})`);
  assert.deepEqual(calls[0], { kind: "urgent", meta: { nested: "deep" } });
});

test("compute over function results, return only the final value", async () => {
  const { session } = fixture();
  const r = await session.execute(
    `(count (filter #(= (:state %) "open") (github__list_pull_requests)))`,
  );
  assert.equal(r.value, 2);
});

test("def of a function result persists across execute calls", async () => {
  const { session, calls } = fixture();
  const first = await session.execute(`(def prs (github__list_pull_requests))`);
  assert.deepEqual(first.defined, ["prs"]);
  assert.ok(first.defs?.prs);
  const second = await session.execute(`(count prs)`);
  assert.equal(second.value, 3);
  // The def call fired the tool once; reusing `prs` does not re-fire it.
  assert.equal(calls.filter((c) => c.name === "github__list_pull_requests").length, 1);
});

test("effectful function fires immediately and returns its result", async () => {
  const { session, calls } = fixture();
  const r = await session.execute(`(email__send {:to "a@b.io" :subject "hi"})`);
  assert.deepEqual(r.value, { sent: true, to: "a@b.io" });
  assert.equal(calls.filter((c) => c.name === "email__send").length, 1);
});

test("branch decides which effect fires — decide-and-act in one call", async () => {
  const { session, calls } = fixture();
  await session.execute(
    `(if (empty? (github__list_pull_requests {:state "closed"}))
       (email__send {:to "ops@b.io" :subject "none open"})
       (email__send {:to "ops@b.io" :subject "some open"}))`,
  );
  assert.equal(calls.filter((c) => c.name === "email__send").length, 1);
  assert.equal(calls.find((c) => c.name === "email__send")!.args.subject, "none open");
});

test("missing required argument errors, naming the key", async () => {
  const { session } = fixture();
  await assert.rejects(() => session.execute(`(email__send {:to "a@b.io"})`), /requires :subject/);
});

test("unknown argument key errors with did-you-mean", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute(`(github__list_pull_requests {:stat "open"})`),
    /no parameter :stat — did you mean :state/,
  );
});

test("more than one argument is rejected", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute(`(github__list_pull_requests {:state "open"} {:x 1})`),
    /takes at most one argument map/,
  );
});

test("a thrown tool error surfaces with the function name prefix", async () => {
  const session = LispSession.create();
  session.registerFn(
    defineFn({
      name: "boom",
      handler: () => {
        throw new Error("upstream down");
      },
    }),
  );
  await assert.rejects(() => session.execute(`(boom)`), /function "boom": upstream down/);
});

test("(fns) lists registered functions; (describe :name) shows parameters", async () => {
  const { session } = fixture();
  const fns = (await session.execute(`(map :name (fns))`)).value as string[];
  assert.deepEqual(fns.sort(), ["email__send", "github__list_pull_requests"]);
  const desc = (await session.execute(`(describe :email__send)`)).value as {
    kind: string;
    params: Array<{ name: string; required?: boolean }>;
  };
  assert.equal(desc.kind, "function");
  assert.ok(desc.params.find((p) => p.name === "to" && p.required));
});

test("(describe …) on an unknown name suggests the closest and points at (tables)/(fns)", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute(`(describe :email__sen)`),
    /did you mean :email__send.*\(tables\) or \(fns\)/s,
  );
});

test("registering a function whose name collides errors, naming the fix", () => {
  const session = LispSession.create();
  // collides with a stdlib primitive
  assert.throws(
    () => session.registerFn(defineFn({ name: "count", handler: () => 1 })),
    /already a library primitive.*Rename it/,
  );
  session.registerFn(defineFn({ name: "dup", handler: () => 1 }));
  assert.throws(
    () => session.registerFn(defineFn({ name: "dup", handler: () => 2 })),
    /already another function/,
  );
});

test("functions and resources coexist in one session", async () => {
  const calls: string[] = [];
  const session = LispSession.create();
  session.register(
    defineResource({
      name: "time",
      volatility: "stable",
      columns: [{ name: "now", type: "text" }],
      select: async () => {
        calls.push("time");
        return [{ now: "2026-07-09" }];
      },
    }),
  );
  session.registerFn(
    defineFn({
      name: "weather__today",
      input: z.object({ city: z.string() }),
      handler: (args) => {
        calls.push("weather");
        return { city: args.city, temp: 21 };
      },
    }),
  );
  const r = await session.execute(
    `[(:now (first (time))) (:temp (weather__today {:city "NYC"}))]`,
  );
  assert.deepEqual(r.value, ["2026-07-09", 21]);
  // (tables) sees the resource, (fns) sees the function.
  assert.deepEqual((await session.execute(`(map :name (tables))`)).value, ["time"]);
  assert.deepEqual((await session.execute(`(map :name (fns))`)).value, ["weather__today"]);
});

test("__ in a function name round-trips through the reader", async () => {
  const session = LispSession.create();
  session.registerFn(defineFn({ name: "a__b__c", handler: () => 42 }));
  assert.equal((await session.execute(`(a__b__c)`)).value, 42);
});

test("touched reports function calls with op=call", async () => {
  const { session } = fixture();
  const r = await session.execute(`(github__list_pull_requests)`);
  assert.deepEqual(r.touched, [{ name: "github__list_pull_requests", op: "call", calls: 1 }]);
});

test("empty function result gets a re-check-your-arguments note", async () => {
  const { session } = fixture();
  const r = await session.execute(`(github__list_pull_requests {:state "closed"})`);
  assert.deepEqual(r.value, []);
  assert.match(r.note ?? "", /describe :github__list_pull_requests/);
});

test("a fn with no readOnlyHint plain ToolFn still works", async () => {
  const session = LispSession.create();
  const fn: ToolFn = {
    name: "ping",
    async call() {
      return "pong";
    },
  };
  session.registerFn(fn);
  assert.equal((await session.execute(`(ping)`)).value, "pong");
});
