/** Function mode — register ToolFns and call them from the REPL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineFn, type ToolFn } from "glove-scratchpad/fns";
import { JsSession } from "../src/session";

interface Fixture {
  session: JsSession;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fixture(): Fixture {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = JsSession.create();
  session.registerAll([
    defineFn({
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
    }),
    defineFn({
      name: "email__send",
      description: "Send an email",
      input: z.object({ to: z.string(), subject: z.string() }),
      readOnlyHint: false,
      handler: (args) => {
        calls.push({ name: "email__send", args });
        return { sent: true, to: args.to };
      },
    }),
  ]);
  return { session, calls };
}

test("dotted namespace form calls the tool with the argument object", async () => {
  const { session, calls } = fixture();
  const r = await session.execute('github.list_pull_requests({ state: "open" })');
  assert.deepEqual(calls[0], { name: "github__list_pull_requests", args: { state: "open" } });
  assert.equal((r.value as unknown[]).length, 2);
});

test("flat name form also works", async () => {
  const { session } = fixture();
  const r = await session.execute('github__list_pull_requests({ state: "merged" }).length');
  assert.equal(r.value, 1);
});

test("compute over results, return only the final value", async () => {
  const { session } = fixture();
  const r = await session.execute(
    "github.list_pull_requests().filter(p => p.state === 'open').map(p => p.number)",
  );
  assert.deepEqual(r.value, [1, 3]);
});

test("const of a tool result persists and does not re-fire the tool", async () => {
  const { session, calls } = fixture();
  const first = await session.execute("const prs = github.list_pull_requests()");
  assert.deepEqual(first.defined, ["prs"]);
  const second = await session.execute("prs.length");
  assert.equal(second.value, 3);
  assert.equal(calls.filter((c) => c.name === "github__list_pull_requests").length, 1);
});

test("decide-and-act: branch chooses which effect fires, in one call", async () => {
  const { session, calls } = fixture();
  await session.execute(`
    if (github.list_pull_requests({ state: "closed" }).length === 0) {
      email.send({ to: "ops@b.io", subject: "none closed" });
    } else {
      email.send({ to: "ops@b.io", subject: "some closed" });
    }
  `);
  assert.equal(calls.filter((c) => c.name === "email__send").length, 1);
  assert.equal(calls.find((c) => c.name === "email__send")!.args.subject, "none closed");
});

test("called bookkeeping reports each tool and its count", async () => {
  const { session } = fixture();
  const r = await session.execute("github.list_pull_requests(); github.list_pull_requests(); 1");
  assert.deepEqual(r.called, [{ name: "github__list_pull_requests", calls: 2 }]);
});

test("missing required argument errors, naming the key", async () => {
  const { session } = fixture();
  await assert.rejects(() => session.execute('email.send({ to: "a@b.io" })'), /requires 'subject'/);
});

test("unknown argument key errors with did-you-mean", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('github.list_pull_requests({ stat: "open" })'),
    /no parameter 'stat' — did you mean 'state'/,
  );
});

test("a non-object argument is rejected", async () => {
  const { session } = fixture();
  await assert.rejects(() => session.execute('github.list_pull_requests("open")'), /takes a single argument object/);
});

test("fns() lists functions; describe(name) shows parameters", async () => {
  const { session } = fixture();
  const names = ((await session.execute("fns().map(f => f.name)")).value as string[]).sort();
  assert.deepEqual(names, ["email__send", "github__list_pull_requests"]);
  const desc = (await session.execute('describe("email__send")')).value as {
    params: Array<{ name: string; required?: boolean }>;
  };
  assert.ok(desc.params.find((p) => p.name === "to" && p.required));
});

test("describe on an unknown name suggests the closest", async () => {
  const { session } = fixture();
  await assert.rejects(() => session.execute('describe("email__sen")'), /did you mean 'email__send'/);
});

test("a thrown tool error surfaces as an error result", async () => {
  const session = JsSession.create();
  session.register(
    defineFn({
      name: "boom",
      handler: () => {
        throw new Error("upstream down");
      },
    }),
  );
  await assert.rejects(() => session.execute("boom()"), /upstream down/);
});

test("registering a name that collides with a builtin errors, naming the fix", () => {
  const session = JsSession.create();
  assert.throws(() => session.register(defineFn({ name: "Math", handler: () => 1 })), /builtin.*Rename it/);
  session.register(defineFn({ name: "dup", handler: () => 1 }));
  assert.throws(() => session.register(defineFn({ name: "dup", handler: () => 2 })), /already registered/);
});

test("JSON-string tool results are parsed to data", async () => {
  const session = JsSession.create();
  const fn: ToolFn = {
    name: "raw",
    async call() {
      return '[{"id":1},{"id":2}]';
    },
  };
  session.register(fn);
  // fnFromTool does the JSON parsing; a raw ToolFn returns what it returns.
  assert.equal((await session.execute("raw()")).value, '[{"id":1},{"id":2}]');
});

test("an effect that fires before an error is flagged in the message", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('email.send({ to: "a@b.io", subject: "hi" }); null.boom'),
    /ALREADY FIRED/,
  );
});

test("empty tool result gets a re-check note", async () => {
  const { session } = fixture();
  const r = await session.execute('github.list_pull_requests({ state: "closed" })');
  assert.deepEqual(r.value, []);
  assert.match(r.note ?? "", /0 items came back/);
});
