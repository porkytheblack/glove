import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { PgliteBackend } from "../src/backends/pglite";

async function fresh(): Promise<Scratchpad> {
  return Scratchpad.create(await PgliteBackend.create());
}

const DOC = {
  id: 7,
  title: "Quarterly report",
  published: true,
  authors: [
    { name: "Ada", role: "lead" },
    { name: "Linus", role: "review" },
  ],
  meta: { source: "cms", revision: 3 },
};

test("ingest normalizes into root + child tables and returns a descriptor stub", async () => {
  const sp = await fresh();
  const stub = await sp.ingest(DOC, { name: "doc" });

  assert.equal(stub.ref, "doc");
  assert.equal(stub.descriptor.kind, "table");
  assert.equal(stub.descriptor.rowCount, 1);
  assert.ok((stub.descriptor.rawBytes ?? 0) > 0);

  const cols = Object.fromEntries(stub.descriptor.columns.map((c) => [c.name, c.type]));
  assert.equal(cols.id, "bigint");
  assert.equal(cols.title, "text");
  assert.equal(cols.published, "boolean");
  assert.equal(cols.meta, "jsonb");
  assert.ok(!("authors" in cols));

  const child = stub.descriptor.tables.find((t) => t.role === "child");
  assert.ok(child, "authors child table present");
  assert.equal(child!.table, "doc__authors");
  assert.equal(child!.rowCount, 2);

  assert.equal(stub.descriptor.preview.length, 1);
  await sp.close();
});

test("query (read mode) returns bounded rows; jsonb reachable in place", async () => {
  const sp = await fresh();
  await sp.ingest(DOC, { name: "doc" });

  const res = (await sp.query(`SELECT title, meta->>'source' AS src FROM doc`)) as {
    rows: Record<string, unknown>[];
    truncated: boolean;
  };
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].title, "Quarterly report");
  assert.equal(res.rows[0].src, "cms");
  assert.equal(res.truncated, false);
  await sp.close();
});

test("query (store mode) persists a derived record and returns a new stub", async () => {
  const sp = await fresh();
  await sp.ingest(DOC, { name: "doc" });

  const stub = await sp.query(
    `SELECT name FROM doc__authors WHERE role = 'lead'`,
    { store: "leads" },
  );
  assert.ok("ref" in stub);
  if ("ref" in stub) {
    assert.equal(stub.ref, "leads");
    assert.equal(stub.descriptor.rowCount, 1);
    assert.equal(stub.descriptor.provenance.source, "query");
  }

  const refs = await sp.refs();
  assert.ok(refs.includes("leads"));
  await sp.close();
});

test("materialize is the only path that returns full values; bounded + paged", async () => {
  const sp = await fresh();
  await sp.ingest(
    Array.from({ length: 10 }, (_, i) => ({ i, label: `row-${i}` })),
    { name: "rows" },
  );

  const page1 = await sp.materialize({ ref: "rows", limit: 3 });
  assert.equal(page1.returned, 3);
  assert.equal(page1.truncated, true);

  const page2 = await sp.materialize({ ref: "rows", limit: 3, offset: 9 });
  assert.equal(page2.returned, 1);
  assert.equal(page2.truncated, false);

  const viaSql = await sp.materialize({ sql: `SELECT label FROM rows WHERE i = 4` });
  assert.equal(viaSql.rows[0].label, "row-4");
  await sp.close();
});

test("collision-free references and drop lifecycle", async () => {
  const sp = await fresh();
  const a = await sp.ingest({ x: 1 }, { name: "rec" });
  const b = await sp.ingest({ x: 2 }, { name: "rec" });
  assert.equal(a.ref, "rec");
  assert.equal(b.ref, "rec_2");

  await sp.drop("rec");
  const refs = await sp.refs();
  assert.ok(!refs.includes("rec"));
  assert.ok(refs.includes("rec_2"));
  await sp.close();
});

test("read mode rejects non-SELECT statements", async () => {
  const sp = await fresh();
  await sp.ingest({ x: 1 }, { name: "rec" });
  await assert.rejects(() => sp.query(`DROP TABLE rec`));
  await assert.rejects(() => sp.query(`SELECT 1; SELECT 2`));
  await sp.close();
});
