import { test } from "node:test";
import assert from "node:assert/strict";
import { Scratchpad } from "../src/core/scratchpad";
import { MemoryBackend } from "../src/backends/memory";

// §10 — "computation as a value": a live scratchpad snapshots to bytes and is
// brought back to life later, intact.
test("snapshot → restore round-trips records, tables, and values", async () => {
  const sp1 = await Scratchpad.create(await MemoryBackend.create());
  await sp1.ingest(
    {
      id: 7,
      title: "Quarterly report",
      authors: [
        { name: "Ada", role: "lead" },
        { name: "Linus", role: "review" },
      ],
    },
    { name: "doc", provenance: { actor: "ingestor" } },
  );
  const bytes = await sp1.snapshot();
  assert.ok(bytes.byteLength > 0);
  await sp1.close();

  const sp2 = await Scratchpad.create(await MemoryBackend.create({ load: bytes }));

  const refs = await sp2.refs();
  assert.ok(refs.includes("doc"));

  const d = await sp2.describe("doc");
  assert.equal(d.rowCount, 1);
  assert.equal(d.provenance.actor, "ingestor");
  const child = d.tables.find((t) => t.role === "child");
  assert.equal(child?.rowCount, 2);

  const authors = await sp2.materialize({ sql: `SELECT name FROM doc__authors ORDER BY _idx` });
  assert.deepEqual(
    authors.rows.map((r) => r.name),
    ["Ada", "Linus"],
  );
  await sp2.close();
});
