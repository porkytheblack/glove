/**
 * Context-reduction benchmark for the Scratchpad Computer — NO API KEY, $0.
 *
 * The headline claim of the architecture — how much model context the scratchpad
 * saves — is DETERMINISTIC: it's a property of the data shapes and the workflow,
 * not of any model. This harness measures it directly. For each configuration it
 * runs the *actual* scratchpad operations (contain → narrow in SQL → join →
 * materialize a small answer) over seeded data and measures, via the real
 * consumption tracker, the bytes that cross the model boundary:
 *
 *   naive       = the raw payloads a tool-calling agent would ingest in-context
 *   scratchpad  = stubs + narrowing/join query reads + the last-mile materialize
 *   reduction   = naive / scratchpad   (a dimensionless ratio — exact in bytes)
 *
 * It sweeps two dimensions and prints paper-ready tables + writes a CSV:
 *   1. payload size (rows per provider) — reduction grows ~linearly with payload
 *   2. provider count (cross-source joins) — reduction is preserved as breadth
 *      grows (naive and scratchpad both scale linearly, so the ratio holds)
 *
 * What this measures: the reduction the architecture ENABLES when the workflow
 * follows the narrow→materialize discipline the priming induces. The live model
 * runs (see scratchpad-mcp-fleet) confirm a real model realizes it (32–46×).
 *
 * Run (from the repo root): `pnpm scratchpad:bench`
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Scratchpad,
  MemoryBackend,
  createConsumptionTracker,
  defaultTokensForBytes,
} from "glove-scratchpad";

// ─── seeded data ─────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const LABELS = ["bug", "regression", "perf", "ui", "infra", "security", "docs", "flaky"];
const REGIONS = ["NA", "EU", "APAC", "LATAM"];

/** A realistic ~150-byte business record keyed by account_id (the join key). */
function generateProvider(rows: number, accounts: number, seed: number): unknown[] {
  const rng = mulberry32(seed);
  return Array.from({ length: rows }, (_, i) => ({
    id: `REC-${pad(i, 7)}`,
    account_id: `ACC-${pad(Math.floor(rng() * accounts), 4)}`,
    value: Math.floor(rng() * 500_000),
    state: rng() < 0.35 ? "open" : "closed",
    priority: rng() < 0.1 ? "P0" : rng() < 0.4 ? "P1" : "P2",
    label: LABELS[Math.floor(rng() * LABELS.length)],
    region: REGIONS[Math.floor(rng() * REGIONS.length)],
    flag: rng() < 0.2,
    created_at: `2026-0${1 + Math.floor(rng() * 6)}-${pad(1 + Math.floor(rng() * 28), 2)}`,
  }));
}

interface Result {
  rows: number;
  providers: number;
  naiveBytes: number;
  scratchpadBytes: number;
  reduction: number;
  naiveTok: number;
  scratchpadTok: number;
}

/**
 * Run the canonical workflow for one config and measure context bytes.
 * Per provider: ingest the full payload (contained → stub) and narrow it in SQL
 * to a per-account aggregate (a new reference). Then JOIN the narrowed references
 * across providers and materialize the top-10 of the result.
 */
async function runConfig(rows: number, providers: number, accounts: number): Promise<Result> {
  const sp = await Scratchpad.create(await MemoryBackend.create());
  const consumption = createConsumptionTracker();
  sp.subscribe(consumption.subscriber);

  const narrowed: string[] = [];
  for (let p = 0; p < providers; p++) {
    const data = generateProvider(rows, accounts, 0x1000 + p);
    const stub = await sp.ingest(data, { name: `provider_${p}`, provenance: { source: `tool:provider_${p}` } });
    // Narrow in SQL to one row per account (the "code execution" step).
    const narrowStub = (await sp.query(
      `SELECT account_id,
              COUNT(*) AS n,
              SUM(value) AS total,
              COUNT(*) FILTER (WHERE state = 'open' AND priority = 'P0') AS open_p0
         FROM ${stub.ref}
        GROUP BY account_id`,
      { store: `narrow_${p}` },
    )) as { ref: string };
    narrowed.push(narrowStub.ref);
  }

  // JOIN the narrowed references across providers on account_id → a board.
  let boardRef = narrowed[0];
  if (providers > 1) {
    const sel = [`n0.account_id`, ...narrowed.map((_, i) => `n${i}.total AS total_${i}`)].join(", ");
    const joins = narrowed
      .slice(1)
      .map((ref, i) => `JOIN ${ref} n${i + 1} ON n${i + 1}.account_id = n0.account_id`)
      .join(" ");
    const joinStub = (await sp.query(
      `SELECT ${sel} FROM ${narrowed[0]} n0 ${joins}`,
      { store: "board" },
    )) as { ref: string };
    boardRef = joinStub.ref;
  }

  // Last-mile materialize: the small final answer (top 10).
  await sp.materialize({ sql: `SELECT * FROM ${boardRef} ORDER BY total_0 DESC LIMIT 10` });

  const r = consumption.report();
  await sp.close();
  return {
    rows,
    providers,
    naiveBytes: r.bytesContained,
    scratchpadBytes: r.bytesIntoContext,
    reduction: r.bytesContained / r.bytesIntoContext,
    naiveTok: defaultTokensForBytes(r.bytesContained),
    scratchpadTok: defaultTokensForBytes(r.bytesIntoContext),
  };
}

// ─── output formatting ───────────────────────────────────────────────────────
const kb = (b: number) => (b / 1024).toFixed(1);
const tok = (t: number) => (t < 1000 ? `${t}` : `${(t / 1000).toFixed(1)}k`);

function table(title: string, sweepCol: string, sweepVal: (r: Result) => string, results: Result[]): string {
  const head = `| ${sweepCol} | naive (KB) | scratchpad (KB) | **reduction** | naive (est. tok) | scratchpad (est. tok) |`;
  const sep = `|---|---:|---:|:---:|---:|---:|`;
  const body = results
    .map((r) => `| ${sweepVal(r)} | ${kb(r.naiveBytes)} | ${kb(r.scratchpadBytes)} | **${r.reduction.toFixed(1)}×** | ${tok(r.naiveTok)} | ${tok(r.scratchpadTok)} |`)
    .join("\n");
  return `### ${title}\n\n${head}\n${sep}\n${body}\n`;
}

async function main() {
  const ACCOUNTS = 100;
  console.log("\nScratchpad Computer — context-reduction benchmark (deterministic, no API key)\n");
  console.log(`Workflow: contain each provider → narrow per-account in SQL → JOIN → materialize top-10.`);
  console.log(`Reduction = naive payload bytes ÷ bytes that cross into context. Tokens ≈ bytes/4.\n`);

  // Sweep 1: payload size (5 providers, 100 accounts).
  const rowSweep = [100, 500, 1000, 5000, 20000, 50000];
  const byRows: Result[] = [];
  for (const rows of rowSweep) {
    const started = Date.now();
    const r = await runConfig(rows, 5, ACCOUNTS);
    byRows.push(r);
    console.log(`  rows/provider=${String(rows).padStart(6)}  →  ${r.reduction.toFixed(1)}× less context  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }

  // Sweep 2: provider count (1000 rows each, 100 accounts).
  const provSweep = [1, 2, 3, 5, 10];
  const byProviders: Result[] = [];
  for (const providers of provSweep) {
    const r = await runConfig(1000, providers, ACCOUNTS);
    byProviders.push(r);
    console.log(`  providers=${String(providers).padStart(2)} (1000 rows each)  →  ${r.reduction.toFixed(1)}× less context`);
  }

  const md =
    `# Scratchpad Computer — context reduction (deterministic benchmark)\n\n` +
    `Each cell is measured by running the actual scratchpad operations (contain → narrow → JOIN → materialize)\n` +
    `over seeded data and reading the bytes that cross the model boundary. No model, no API key — the reduction\n` +
    `factor is a property of the data + workflow. Tokens are estimated at ~4 bytes/token; the factor is exact.\n\n` +
    table("Reduction vs payload size (5 providers, 100 accounts)", "rows / provider", (r) => String(r.rows), byRows) +
    `\n` +
    table("Reduction vs provider count (1,000 rows each, 100 accounts)", "providers", (r) => String(r.providers), byProviders);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const mdPath = join(__dirname, "results.md");
  const csvPath = join(__dirname, "results.csv");
  writeFileSync(mdPath, md);
  writeFileSync(
    csvPath,
    "sweep,rows,providers,naive_bytes,scratchpad_bytes,reduction,naive_tokens,scratchpad_tokens\n" +
      byRows.map((r) => `payload,${r.rows},${r.providers},${r.naiveBytes},${r.scratchpadBytes},${r.reduction.toFixed(3)},${r.naiveTok},${r.scratchpadTok}`).join("\n") +
      "\n" +
      byProviders.map((r) => `providers,${r.rows},${r.providers},${r.naiveBytes},${r.scratchpadBytes},${r.reduction.toFixed(3)},${r.naiveTok},${r.scratchpadTok}`).join("\n") +
      "\n",
  );

  console.log("\n" + md);
  console.log(`Wrote ${mdPath} and ${csvPath}\n`);
}

main().catch((err) => {
  console.error("\n[bench failed]", err);
  process.exit(1);
});
