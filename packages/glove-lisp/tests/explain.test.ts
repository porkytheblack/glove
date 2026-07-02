/** explain_lisp — static preview without evaluation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineResource } from "glove-scratchpad";
import { explainProgram } from "../src/explain";
import type { ResourceTable } from "glove-scratchpad";

const KNOWN = new Set(["count", "filter", "map", "if", "empty?", "str", "join", "first", "->>", "select-keys"]);

function catalog(): Map<string, ResourceTable> {
  const prs = defineResource({
    name: "github_pull_requests",
    volatility: "stable",
    columns: [
      { name: "number", type: "bigint" },
      { name: "state", type: "text" },
    ],
    select: async () => [],
  });
  const messages = defineResource({
    name: "slack_messages",
    volatility: "stable",
    columns: [
      { name: "channel", type: "text", requiredKey: true },
      { name: "text", type: "text" },
    ],
    select: async () => [],
  });
  const emails = defineResource({
    name: "emails",
    volatility: "volatile",
    columns: [{ name: "to_addr", type: "text" }],
    insert: async () => ({}),
  });
  return new Map([prs, messages, emails].map((r) => [r.name, r]));
}

test("reports reads with literal args, without running anything", () => {
  const r = explainProgram('(count (github_pull_requests {:state "open"}))', catalog(), KNOWN);
  assert.equal(r.ok, true);
  assert.deepEqual(r.touches, [
    { resource: "github_pull_requests", op: "read", volatility: "stable", args: ["state"] },
  ]);
});

test("flags missing required keys statically", () => {
  const r = explainProgram("(count (slack_messages))", catalog(), KNOWN);
  assert.deepEqual(r.touches[0].missingRequired, ["channel"]);
});

test("reports writes and staging", () => {
  const r = explainProgram(
    '(stage (insert! :emails {:to_addr "a@b.c"})) (commit!)',
    catalog(),
    KNOWN,
  );
  assert.equal(r.staged, true);
  assert.deepEqual(r.touches, [
    { resource: "emails", op: "insert", volatility: "volatile", args: ["to_addr"] },
  ]);
});

test("catches unknown names with suggestions, and unsupported verbs", () => {
  const r = explainProgram("(github_pul_requests)", catalog(), KNOWN);
  assert.equal(r.ok, false);
  assert.match((r.unknown ?? []).join(" "), /github_pul_requests \(did you mean github_pull_requests\?\)/);

  const w = explainProgram('(insert! :github_pull_requests {:state "x"})', catalog(), KNOWN);
  assert.equal(w.ok, false);
  assert.match((w.notes ?? []).join(" "), /does not support insert!/);
});

test("sees through branches — both arms are reported", () => {
  const r = explainProgram(
    `(if (empty? (github_pull_requests {:state "open"}))
       (insert! :emails {:to_addr "a@b.c"})
       (count (slack_messages {:channel "dev"})))`,
    catalog(),
    KNOWN,
  );
  const ops = r.touches.map((t) => `${t.resource}:${t.op}`).sort();
  assert.deepEqual(ops, ["emails:insert", "github_pull_requests:read", "slack_messages:read"]);
});

test("quoted forms run nothing and report nothing", () => {
  const r = explainProgram("'(insert! :emails {:to_addr \"a@b.c\"})", catalog(), KNOWN);
  assert.deepEqual(r.touches, []);
});
