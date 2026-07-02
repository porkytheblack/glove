/** The resource surface — reads, pushdown, writes, staging, overlay, volatility. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineResource } from "glove-scratchpad";
import type { ResourceTable } from "glove-scratchpad";
import { LispSession } from "../src/session";

interface Fixture {
  session: LispSession;
  outbox: Array<Record<string, unknown>>;
  calls: Record<string, number>;
}

function fixture(opts: { writes?: boolean } = {}): Fixture {
  const outbox: Array<Record<string, unknown>> = [];
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);

  const prs = defineResource({
    name: "github_pull_requests",
    description: "Pull requests across all repos",
    volatility: "stable",
    columns: [
      { name: "number", type: "bigint" },
      { name: "state", type: "text", description: "open | merged | closed" },
      { name: "title", type: "text" },
      { name: "closes_linear", type: "text" },
    ],
    select: async () => {
      bump("prs.select");
      return [
        { number: 1, state: "open", title: "Fix login", closes_linear: null },
        { number: 2, state: "merged", title: "Add SSO", closes_linear: "LIN-1" },
        { number: 3, state: "open", title: "Bump deps", closes_linear: null },
        { number: 4, state: "merged", title: "Refactor auth", closes_linear: "LIN-2" },
      ];
    },
  });

  const issues = defineResource({
    name: "linear_issues",
    description: "Linear issues",
    volatility: "stable",
    columns: [
      { name: "id", type: "text" },
      { name: "state", type: "text", description: "todo | in_progress | done" },
      { name: "assignee", type: "text" },
    ],
    select: async () => {
      bump("issues.select");
      return [
        { id: "LIN-1", state: "done", assignee: "ada" },
        { id: "LIN-2", state: "in_progress", assignee: "linus" },
      ];
    },
  });

  // A get-by-key resource: `channel` is a required argument; resolver honors it.
  const messages = defineResource({
    name: "slack_messages",
    description: "Messages in a channel",
    volatility: "stable",
    columns: [
      { name: "channel", type: "text", requiredKey: true },
      { name: "text", type: "text" },
    ],
    select: async (b) => {
      bump("messages.select");
      const out: Array<Record<string, unknown>> = [];
      for (const ch of b.all("channel")) out.push({ channel: ch, text: `hello from ${ch}` });
      return out;
    },
  });

  const emails = defineResource({
    name: "emails",
    description: "Send email (insert) / read the sent log (select)",
    volatility: "volatile",
    columns: [
      { name: "to_addr", type: "text" },
      { name: "subject", type: "text" },
      { name: "body", type: "text" },
    ],
    select: async () => {
      bump("emails.select");
      return []; // upstream is a live view that hasn't caught up
    },
    insert: async (rows) => {
      bump("emails.insert");
      outbox.push(...rows);
      return { sent: rows.length };
    },
  });

  const counter = defineResource({
    name: "counter",
    description: "A volatile read — must be invoked exactly once per call site",
    volatility: "volatile",
    columns: [{ name: "n", type: "bigint" }],
    select: async () => {
      bump("counter.select");
      return [{ n: calls["counter.select"] }];
    },
  });

  const constants = defineResource({
    name: "constants",
    description: "An immutable lookup",
    volatility: "immutable",
    columns: [{ name: "pi", type: "double precision" }],
    select: async () => {
      bump("constants.select");
      return [{ pi: 3.14159 }];
    },
  }) as ResourceTable;

  const session = LispSession.create({ policy: { writes: opts.writes ?? true } });
  session.registerAll([prs, issues, messages, emails, counter, constants]);
  return { session, outbox, calls };
}

test("read all rows / read with pushdown / residual filter", async () => {
  const { session } = fixture();
  const all = await session.execute("(count (github_pull_requests))");
  assert.equal(all.value, 4);
  // `state` is pushed down; the resolver ignores it, so the residual filter must hold.
  const open = await session.execute('(map :number (github_pull_requests {:state "open"}))');
  assert.deepEqual(open.value, [1, 3]);
});

test("keyword argument values coerce to strings", async () => {
  const { session } = fixture();
  const open = await session.execute("(count (github_pull_requests {:state :open}))");
  assert.equal(open.value, 2);
});

test("required key: missing errors with the fix; vector fans out like IN", async () => {
  const { session, calls } = fixture();
  await assert.rejects(() => session.execute("(slack_messages)"), /requires :channel/);
  const r = await session.execute('(map :text (slack_messages {:channel ["dev" "ops"]}))');
  assert.deepEqual(r.value, ["hello from dev", "hello from ops"]);
  assert.equal(calls["messages.select"], 1);
});

test("unknown argument column errors with suggestion + column list", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('(github_pull_requests {:stat "open"})'),
    /no column :stat.*did you mean :state.*:number/s,
  );
});

test("cross-resource join in one program", async () => {
  const { session } = fixture();
  const r = await session.execute(`
    (let [issues (group-by :id (linear_issues))]
      (->> (github_pull_requests {:state "merged"})
           (filter #(and (:closes_linear %)
                         (not= "done" (:state (first (get issues (:closes_linear %) []))))))
           (map #(select-keys % [:number :closes_linear]))))`);
  assert.deepEqual(r.value, [{ number: 4, closes_linear: "LIN-2" }]);
});

test("volatility: stable caches within one execute, not across; immutable caches across", async () => {
  const { session, calls } = fixture();
  await session.execute("[(count (github_pull_requests)) (count (github_pull_requests))]");
  assert.equal(calls["prs.select"], 1); // stable: one resolver call within the program
  await session.execute("(count (github_pull_requests))");
  assert.equal(calls["prs.select"], 2); // stable: re-resolved next call
  await session.execute("[(constants) (constants)]");
  await session.execute("(constants)");
  assert.equal(calls["constants.select"], 1); // immutable: cached for the session
});

test("volatile read is invoked exactly once per call site, never cached", async () => {
  const { session, calls } = fixture();
  const r = await session.execute("[(first (counter)) (first (counter))]");
  assert.equal(calls["counter.select"], 2);
  assert.deepEqual(r.value, [{ n: 1 }, { n: 2 }]);
});

test("insert! fires immediately, returns count, carries a command tag", async () => {
  const { session, outbox } = fixture();
  const r = await session.execute(
    '(insert! :emails {:to_addr "oncall@acme.io" :subject "Top error" :body "boom"})',
    { allowWrites: true },
  );
  assert.deepEqual(outbox, [{ to_addr: "oncall@acme.io", subject: "Top error", body: "boom" }]);
  assert.match(r.message ?? "", /insert! on "emails" fired — 1 row/);
  const v = r.value as Record<string, unknown>;
  assert.equal(v.fired, true);
  assert.equal(v.count, 1);
});

test("bulk insert of a computed vector — fan-out with row count", async () => {
  const { session, outbox } = fixture();
  const r = await session.execute(
    `(insert! :emails
       (->> (github_pull_requests {:state "merged"})
            (map #(assoc {} :to_addr "log@acme.io" :subject (str "Verify: " (:title %)) :body "check"))))`,
    { allowWrites: true },
  );
  assert.equal(outbox.length, 2);
  assert.equal(outbox[0].subject, "Verify: Add SSO");
  assert.match(r.message ?? "", /2 row/);
});

test("writes are gated: session policy AND per-call allowWrites", async () => {
  const denied = fixture({ writes: false });
  await assert.rejects(
    () => denied.session.execute('(insert! :emails {:to_addr "a@b.c" :subject "s" :body "b"})', { allowWrites: true }),
    /writes are disabled/,
  );
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('(insert! :emails {:to_addr "a@b.c" :subject "s" :body "b"})'),
    /writes are disabled/,
  );
});

test("capability gate: writing a read-only resource names what it CAN do", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('(insert! :github_pull_requests {:title "x"})', { allowWrites: true }),
    /does not support insert!.*supports: read/,
  );
});

test("unknown resource in insert! suggests the closest name", async () => {
  const { session } = fixture();
  await assert.rejects(
    () => session.execute('(insert! :email {:to_addr "a@b.c"})', { allowWrites: true }),
    /unknown resource "email".*did you mean :emails/,
  );
});

test("read-your-writes: an inserted row shows up in a later read", async () => {
  const { session } = fixture();
  await session.execute('(insert! :emails {:to_addr "a@b.c" :subject "hi" :body "x"})', { allowWrites: true });
  const r = await session.execute('(map :subject (emails))');
  assert.deepEqual(r.value, ["hi"]);
});

test("stage → preview → commit! fires in order; rollback! discards", async () => {
  const { session, outbox } = fixture();
  const staged = await session.execute(
    `(stage (insert! :emails {:to_addr "a@b.c" :subject "one" :body "1"})
            (insert! :emails {:to_addr "a@b.c" :subject "two" :body "2"}))`,
    { allowWrites: true },
  );
  assert.equal(outbox.length, 0); // nothing fired
  assert.equal(staged.staged?.length, 2);
  assert.match(staged.message ?? "", /staged 2 write/);

  // A write outside the stage while pending is refused with the fix named.
  await assert.rejects(
    () => session.execute('(insert! :emails {:to_addr "x@y.z" :subject "n" :body "n"})', { allowWrites: true }),
    /commit!.*rollback!/,
  );

  const committed = await session.execute("(commit!)", { allowWrites: true });
  assert.deepEqual(outbox.map((o) => o.subject), ["one", "two"]);
  assert.match(committed.message ?? "", /COMMIT — insert! on "emails" fired — 1 row\(s\); insert! on "emails" fired — 1 row/);

  const staged2 = await session.execute(
    '(stage (insert! :emails {:to_addr "a@b.c" :subject "three" :body "3"}))',
    { allowWrites: true },
  );
  assert.equal(staged2.staged?.length, 1);
  await session.execute("(rollback!)", { allowWrites: true });
  assert.equal(outbox.length, 2); // still just one+two
  const r = await session.execute("(commit!)", { allowWrites: true }).catch((e) => e as Error);
  assert.match((r as Error).message, /nothing is staged/);
});

test("branching + acting in ONE program (the thing SQL cannot do)", async () => {
  const { session, outbox } = fixture();
  const r = await session.execute(
    `(let [stuck (filter #(not= "done" (:state %)) (linear_issues))]
       (if (empty? stuck)
         "all clear — nothing sent"
         (insert! :emails {:to_addr "oncall@acme.io"
                           :subject (str (count stuck) " issues not done")
                           :body (join ", " (map :id stuck))})))`,
    { allowWrites: true },
  );
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].subject, "1 issues not done");
  assert.equal(outbox[0].body, "LIN-2");
  assert.match(r.message ?? "", /fired/);
});

test("0-row read carries the re-check nudge", async () => {
  const { session } = fixture();
  const r = await session.execute('(github_pull_requests {:state "OPEN"})');
  assert.deepEqual(r.value, []);
  assert.match(r.note ?? "", /re-check your argument values/);
  assert.match(r.note ?? "", /describe :github_pull_requests/);
});

test("(tables) and (describe …) are in-band discovery", async () => {
  const { session } = fixture();
  const tables = await session.execute("(map :name (tables))");
  assert.deepEqual(tables.value, [
    "github_pull_requests",
    "linear_issues",
    "slack_messages",
    "emails",
    "counter",
    "constants",
  ]);
  const desc = (await session.execute("(describe :slack_messages)")).value as {
    columns: Array<{ name: string; required?: boolean }>;
    ops: string[];
  };
  assert.equal(desc.columns.find((c) => c.name === "channel")?.required, true);
  assert.deepEqual(desc.ops, ["read"]);
  await assert.rejects(() => session.execute("(describe :slack_message)"), /did you mean :slack_messages/);
});

test("touched reports resources hit and resolver call counts", async () => {
  const { session } = fixture();
  const r = await session.execute("[(count (github_pull_requests)) (count (linear_issues))]");
  const names = r.touched.map((t) => `${t.name}:${t.op}:${t.calls}`).sort();
  assert.deepEqual(names, ["github_pull_requests:select:1", "linear_issues:select:1"]);
});
