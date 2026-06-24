/**
 * The Scratchpad Computer — mechanism walkthrough (no model / no API key).
 *
 * Drives the store + tools directly to show, with real byte counts, what the
 * model's context would carry under the naive approach (full payload) versus
 * the scratchpad approach (stubs + one bounded last-mile read).
 *
 * Run: `pnpm scratchpad:demo` (from the repo root).
 */
import { Scratchpad, storeAndTruncate, stubData } from "glove-scratchpad";
import { PgliteBackend } from "glove-scratchpad/pglite";
import type { GloveFoldArgs } from "glove-core/glove";

const bytes = (v: unknown): number =>
  new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v)).length;
const fmt = (n: number): string => `${n.toLocaleString()} b`;
const rule = () => console.log("─".repeat(72));

// A realistic, chunky tool payload: 500 issues, each with nested labels +
// comments. This is the kind of return that bloats context today.
function fakeIssueSearch(): unknown {
  const labels = ["bug", "p0", "p1", "p2", "ui", "infra", "docs"];
  return Array.from({ length: 500 }, (_, i) => ({
    id: 1000 + i,
    title: `Issue ${i}: something needs attention in module ${i % 17}`,
    state: i % 3 === 0 ? "open" : "closed",
    priority: i % 5 === 0 ? "P0" : i % 2 === 0 ? "P1" : "P2",
    assignee: `dev-${i % 11}`,
    labels: labels.filter((_, k) => (i + k) % 3 === 0),
    comments: Array.from({ length: i % 4 }, (_, c) => ({
      author: `user-${c}`,
      body: `comment ${c} on issue ${i} — lorem ipsum dolor sit amet`,
    })),
  }));
}

async function main() {
  const sp = await Scratchpad.create(await PgliteBackend.create());
  let contextBudget = 0; // bytes the model would actually have ingested

  rule();
  console.log("THE SCRATCHPAD COMPUTER — context accounting demo");
  rule();

  // ── 1. A tool returns a big payload. Naive: it all lands in context. ──────
  const payload = fakeIssueSearch();
  const rawBytes = bytes(payload);
  console.log(`\n1. Tool "issues__search" returns ${fmt(rawBytes)} of JSON.`);
  console.log(`   Naive approach: all ${fmt(rawBytes)} enter the model's context.`);

  // ── 2. store-and-truncate: payload → store, stub → context. ───────────────
  const searchTool: GloveFoldArgs<Record<string, never>> = {
    name: "issues__search",
    description: "search issues",
    async do() {
      return { status: "success", data: JSON.stringify(payload) };
    },
  };
  const wrapped = storeAndTruncate(searchTool, { scratchpad: sp, actor: "fetcher" });
  const toolResult = await wrapped.do({}, undefined as never, undefined as never);
  const stub = toolResult.data;
  const stubBytes = bytes(stub);
  contextBudget += stubBytes;

  console.log(`\n2. store-and-truncate writes the payload to the store and returns a stub:`);
  console.log(
    `   stub = { ref: "${(stub as { ref: string }).ref}", kind, rowCount: ${(stub as { rowCount: number }).rowCount}, columns, child tables, preview, provenance }`,
  );
  console.log(
    `   → only ${fmt(stubBytes)} enter context  (${(100 - (stubBytes / rawBytes) * 100).toFixed(1)}% smaller than the payload)`,
  );

  const ref = (stub as { ref: string }).ref;

  // ── 3. A subdroid narrows deterministically in SQL — no payload moves. ────
  const narrowed = await sp.query(
    `SELECT id, title, priority, assignee
       FROM ${ref}
      WHERE state = 'open' AND priority = 'P0'
      ORDER BY id`,
    { store: "open_p0" },
  );
  const narrowStub = "descriptor" in narrowed ? stubData(narrowed) : narrowed;
  const narrowBytes = bytes(narrowStub);
  contextBudget += narrowBytes;
  const openP0Count =
    "descriptor" in narrowed ? narrowed.descriptor.rowCount : 0;

  console.log(`\n3. Subdroid narrows with SQL (filter to open P0 issues), storing the result:`);
  console.log(`   ${openP0Count} matching rows, persisted as a NEW reference "open_p0".`);
  console.log(`   → only its stub (${fmt(narrowBytes)}) crosses to the next step. Payload stays put.`);

  // ── 4. Last mile: materialize a bounded slice of the narrowed set only. ───
  const finalRead = await sp.materialize({ ref: "open_p0", limit: 10 });
  const finalBytes = bytes(finalRead.rows);
  contextBudget += finalBytes;

  console.log(`\n4. Last mile: materialize the first ${finalRead.rows.length} narrowed rows into context:`);
  console.log(`   sample: ${JSON.stringify(finalRead.rows[0])}`);
  console.log(`   → ${fmt(finalBytes)} of real values — the only payload the model ever reads.`);

  // ── 5. Computation as a value: snapshot → restore. ────────────────────────
  const snap = await sp.snapshot();
  const sp2 = await Scratchpad.create(await PgliteBackend.create({ load: snap }));
  const after = await sp2.materialize({ sql: `SELECT count(*)::int AS n FROM ${ref}` });
  console.log(`\n5. Snapshot the whole scratchpad to ${fmt(snap.byteLength)} and bring it back to life:`);
  console.log(`   restored store still answers: ${ref} has ${after.rows[0].n} rows. (computation as a value)`);

  // ── Accounting ────────────────────────────────────────────────────────────
  rule();
  console.log("CONTEXT ACCOUNTING");
  rule();
  console.log(`  naive (full payload in context):        ${fmt(rawBytes)}`);
  console.log(`  scratchpad (stub + stub + last mile):   ${fmt(contextBudget)}`);
  console.log(
    `  reduction:                              ${(100 - (contextBudget / rawBytes) * 100).toFixed(1)}%  (${(rawBytes / contextBudget).toFixed(1)}× less)`,
  );
  rule();

  await sp.close();
  await sp2.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
