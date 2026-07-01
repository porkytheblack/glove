import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";

function outbox(name: string, log: string[]) {
  return defineResource({
    name,
    volatility: "volatile",
    columns: [{ name: "msg", type: "text" }],
    insert: async (rows) => {
      for (const r of rows) log.push(`${name}:${r.msg}`);
      return { sent: rows.length };
    },
  });
}

test("BEGIN stages writes; COMMIT fires them in order", async () => {
  const log: string[] = [];
  const db = await Database.create({ policy: { writes: true } });
  db.register(outbox("emails", log));
  await db.execute(`BEGIN`);
  const staged = await db.execute(`INSERT INTO emails (msg) VALUES ('first')`);
  assert.equal(log.length, 0, "nothing fires while staged");
  assert.equal(staged.staged?.length, 1);
  assert.equal(db.preview().length, 1);
  await db.execute(`INSERT INTO emails (msg) VALUES ('second')`);
  assert.equal(log.length, 0);
  const committed = await db.execute(`COMMIT`);
  assert.equal(committed.committed, 2);
  assert.deepEqual(log, ["emails:first", "emails:second"]);
  assert.equal(db.inTransaction(), false);
});

test("ROLLBACK discards staged writes without firing", async () => {
  const log: string[] = [];
  const db = await Database.create({ policy: { writes: true } });
  db.register(outbox("emails", log));
  const r = await db.execute(`BEGIN; INSERT INTO emails (msg) VALUES ('dry run'); ROLLBACK`);
  assert.deepEqual(log, [], "ROLLBACK fired no writes");
  assert.match(r.message ?? "", /ROLLBACK/);
});

test("a write outside a transaction fires immediately when writes are enabled", async () => {
  const log: string[] = [];
  const db = await Database.create({ policy: { writes: true } });
  db.register(outbox("emails", log));
  await db.execute(`INSERT INTO emails (msg) VALUES ('now')`);
  assert.deepEqual(log, ["emails:now"]);
});

test("nested BEGIN is rejected", async () => {
  const db = await Database.create({ policy: { writes: true } });
  await db.execute(`BEGIN`);
  await assert.rejects(() => db.execute(`BEGIN`), /already open/);
});

test("COMMIT/ROLLBACK without an open transaction errors", async () => {
  const db = await Database.create({ policy: { writes: true } });
  await assert.rejects(() => db.execute(`COMMIT`), /without an open transaction/);
  await assert.rejects(() => db.execute(`ROLLBACK`), /without an open transaction/);
});
