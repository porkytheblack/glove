import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { PgliteBackend } from "../src/backends/pglite";

// Backend-swappability (§6.1): the SAME Scratchpad code path runs unchanged on
// PGlite (real WASM Postgres) and on the default MemoryBackend. This mirrors the
// core scenarios in scratchpad.test.ts / snapshot.test.ts against PGlite so the
// "the dialect is the standard, the backend is an implementation detail" claim
// stays honest as the engines evolve.

const DOC = {
  id: 7,
  title: "Quarterly report",
  authors: [
    { name: "Ada", role: "lead" },
    { name: "Linus", role: "review" },
  ],
  meta: { source: "cms", revision: 3 },
};

test("PGlite: ingest → query (jsonb) → store → materialize", async () => {
  const sp = await Scratchpad.create(await PgliteBackend.create());
  const stub = await sp.ingest(DOC, { name: "doc" });
  assert.equal(stub.descriptor.rowCount, 1);
  assert.equal(stub.descriptor.tables.find((t) => t.role === "child")?.rowCount, 2);

  const read = (await sp.query(`SELECT title, meta->>'source' AS src FROM doc`)) as {
    rows: Record<string, unknown>[];
  };
  assert.equal(read.rows[0].src, "cms");

  const stored = await sp.query(`SELECT name FROM doc__authors WHERE role = 'lead'`, { store: "leads" });
  assert.ok("ref" in stored && stored.ref === "leads");

  const mat = await sp.materialize({ sql: `SELECT name FROM doc__authors ORDER BY _idx` });
  assert.deepEqual(mat.rows.map((r) => r.name), ["Ada", "Linus"]);
  await sp.close();
});

test("PGlite: snapshot → restore round-trips", async () => {
  const sp1 = await Scratchpad.create(await PgliteBackend.create());
  await sp1.ingest(DOC, { name: "doc", provenance: { actor: "ingestor" } });
  const bytes = await sp1.snapshot();
  await sp1.close();

  const sp2 = await Scratchpad.create(await PgliteBackend.create({ load: bytes }));
  const d = await sp2.describe("doc");
  assert.equal(d.provenance.actor, "ingestor");
  assert.equal(d.tables.find((t) => t.role === "child")?.rowCount, 2);
  await sp2.close();
});
