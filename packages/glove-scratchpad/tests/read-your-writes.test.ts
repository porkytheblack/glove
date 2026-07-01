import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database";
import { defineResource } from "../src/db/resource";
import type { Bindings } from "../src/db/provider";

// Read-your-writes: the upstream is a LIVE VIEW that hasn't caught up, but the
// actor should see what it just wrote in a later SELECT of the same table. This
// is what agents ("droids") instinctively do — read back their own writes.

/** A resource backed by a fixed live snapshot that never reflects writes (like a
 *  send-email outbox that isn't in the inbox list) — writes go to `sent`. */
function outbox() {
  const live = [
    { id: "m1", to_addr: "a@x.io", subject: "hi", body: "one" },
    { id: "m2", to_addr: "b@x.io", subject: "yo", body: "two" },
  ];
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    resource: defineResource({
      name: "emails",
      volatility: "volatile",
      columns: [
        { name: "id", type: "text" },
        { name: "to_addr", type: "text" },
        { name: "subject", type: "text" },
        { name: "body", type: "text" },
      ],
      select: async () => live, // never includes `sent`
      insert: async (rows: Record<string, unknown>[]) => {
        sent.push(...rows);
      },
    }),
  };
}

test("a row you INSERT appears in a later SELECT (read-your-writes)", async () => {
  const { resource, sent } = outbox();
  const db = await Database.create({ policy: { writes: true } });
  db.register(resource);

  await db.execute(`INSERT INTO emails (to_addr, subject, body) VALUES ('c@x.io', 'Top error', 'boom')`);
  assert.equal(sent.length, 1); // the real side effect fired

  const seen = await db.execute(`SELECT to_addr, subject FROM emails WHERE subject = 'Top error'`);
  assert.deepEqual(seen.rows, [{ to_addr: "c@x.io", subject: "Top error" }]); // read back
  const all = await db.execute(`SELECT COUNT(*) AS n FROM emails`);
  assert.equal(Number(all.rows[0].n), 3); // 2 live + 1 written
});

test("readYourWrites:false keeps the strict live-view semantics", async () => {
  const { resource } = outbox();
  const db = await Database.create({ policy: { writes: true, readYourWrites: false } });
  db.register(resource);
  await db.execute(`INSERT INTO emails (to_addr, subject, body) VALUES ('c@x.io', 'Top error', 'boom')`);
  const seen = await db.execute(`SELECT subject FROM emails WHERE subject = 'Top error'`);
  assert.equal(seen.rows.length, 0); // write not reflected — the old behavior
});

test("UPDATE and DELETE are reflected in later reads", async () => {
  const live = [
    { id: "ENG-1", state: "todo", assignee: "ann" },
    { id: "ENG-2", state: "todo", assignee: "bob" },
  ];
  const db = await Database.create({ policy: { writes: true } });
  db.register(
    defineResource({
      name: "issues",
      volatility: "volatile",
      columns: [
        { name: "id", type: "text" },
        { name: "state", type: "text" },
        { name: "assignee", type: "text" },
      ],
      select: async () => live,
      update: async () => {},
      delete: async () => {},
    }),
  );

  await db.execute(`UPDATE issues SET state = 'done' WHERE id = 'ENG-1'`);
  const one = await db.execute(`SELECT state FROM issues WHERE id = 'ENG-1'`);
  assert.deepEqual(one.rows, [{ state: "done" }]);
  const other = await db.execute(`SELECT state FROM issues WHERE id = 'ENG-2'`);
  assert.deepEqual(other.rows, [{ state: "todo" }]); // untouched

  await db.execute(`DELETE FROM issues WHERE id = 'ENG-2'`);
  const left = await db.execute(`SELECT id FROM issues ORDER BY id`);
  assert.deepEqual(left.rows, [{ id: "ENG-1" }]); // ENG-2 gone
});

test("ROLLBACK discards staged writes — they are NOT read back", async () => {
  const { resource, sent } = outbox();
  const db = await Database.create({ policy: { writes: true } });
  db.register(resource);
  await db.execute(
    `BEGIN; INSERT INTO emails (to_addr, subject, body) VALUES ('c@x.io', 'Nope', 'x'); ROLLBACK`,
  );
  assert.equal(sent.length, 0);
  const seen = await db.execute(`SELECT subject FROM emails WHERE subject = 'Nope'`);
  assert.equal(seen.rows.length, 0); // discarded, not overlaid
});

test("COMMIT fires staged writes and they become readable", async () => {
  const { resource, sent } = outbox();
  const db = await Database.create({ policy: { writes: true } });
  db.register(resource);
  await db.execute(
    `BEGIN; INSERT INTO emails (to_addr, subject, body) VALUES ('c@x.io', 'Yes', 'x'); COMMIT`,
  );
  assert.equal(sent.length, 1);
  const seen = await db.execute(`SELECT subject FROM emails WHERE subject = 'Yes'`);
  assert.equal(seen.rows.length, 1); // overlaid after commit
});

test("INSERT with a required key that already exists replaces, not doubles", async () => {
  const live = [{ id: "ENG-1", title: "old" }];
  const db = await Database.create({ policy: { writes: true } });
  db.register(
    defineResource({
      name: "issues",
      volatility: "volatile",
      columns: [
        { name: "id", type: "text", requiredKey: true },
        { name: "title", type: "text" },
      ],
      // required key ⇒ resolver is invoked per-id; echo the live row when asked.
      select: async (b: Bindings) => (b.has("id") ? live.filter((r) => b.all("id").includes(r.id)) : live),
      insert: async () => {},
    }),
  );
  await db.execute(`INSERT INTO issues (id, title) VALUES ('ENG-1', 'new')`);
  const seen = await db.execute(`SELECT title FROM issues WHERE id = 'ENG-1'`);
  assert.deepEqual(seen.rows, [{ title: "new" }]); // one row, the written value wins
});

test("clearWrites() forgets the overlay", async () => {
  const { resource } = outbox();
  const db = await Database.create({ policy: { writes: true } });
  db.register(resource);
  await db.execute(`INSERT INTO emails (to_addr, subject, body) VALUES ('c@x.io', 'Top error', 'boom')`);
  db.clearWrites();
  const seen = await db.execute(`SELECT subject FROM emails WHERE subject = 'Top error'`);
  assert.equal(seen.rows.length, 0);
});
