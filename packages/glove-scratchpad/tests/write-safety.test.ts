import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

// Write-path safety: capability errors that explain themselves, no silent
// over-broad UPDATE/DELETE, and a transaction that aborts (not strands) on error.

function issues(caps: { update?: boolean; delete?: boolean }) {
  const fired: string[] = [];
  const r = defineResource({
    name: "issues",
    volatility: "volatile",
    columns: [
      { name: "id", type: "text", requiredKey: false },
      { name: "state", type: "text" },
      { name: "created_at", type: "text" },
    ],
    select: async () => [{ id: "ENG-1", state: "todo", created_at: "2026-01-01" }],
    insert: async () => {
      fired.push("insert");
    },
    ...(caps.update ? { update: async () => void fired.push("update") } : {}),
    ...(caps.delete ? { delete: async () => void fired.push("delete") } : {}),
  });
  return { r, fired };
}

test("a missing capability errors with what the table DOES support", async () => {
  const { r } = issues({});
  const db = await Database.create({ policy: { writes: true } });
  db.register(r);
  await assert.rejects(
    () => db.execute(`DELETE FROM issues WHERE id = 'ENG-1'`),
    /does not support DELETE .*supports: SELECT, INSERT/,
  );
});

test("an over-broad UPDATE/DELETE (range/OR) is rejected, not silently widened", async () => {
  const { r } = issues({ update: true, delete: true });
  const db = await Database.create({ policy: { writes: true } });
  db.register(r);
  await assert.rejects(
    () => db.execute(`DELETE FROM issues WHERE created_at > '2020-01-01'`),
    /can't be pushed to the tool/,
  );
  await assert.rejects(
    () => db.execute(`UPDATE issues SET state='done' WHERE id='ENG-1' OR id='ENG-2'`),
    /can't be pushed to the tool/,
  );
});

test("equality and IN writes are allowed (pushable)", async () => {
  const { r, fired } = issues({ update: true, delete: true });
  const db = await Database.create({ policy: { writes: true } });
  db.register(r);
  await db.execute(`UPDATE issues SET state='done' WHERE id = 'ENG-1'`);
  await db.execute(`DELETE FROM issues WHERE id IN ('ENG-1','ENG-2')`);
  assert.deepEqual(fired, ["update", "delete"]);
});

test("an error inside an open transaction aborts it (no cross-turn strand)", async () => {
  const { r } = issues({ update: true });
  const db = await Database.create({ policy: { writes: true } });
  db.register(r);
  await db.execute(`BEGIN`);
  await assert.rejects(() => db.execute(`SELECT nope FROM issues`)); // error while txn open
  // The transaction is gone — a following write fires immediately, not staged.
  const res = await db.execute(`UPDATE issues SET state='x' WHERE id='ENG-1'`);
  assert.match(res.message ?? "", /fired/);
  assert.equal(res.staged, undefined);
});
