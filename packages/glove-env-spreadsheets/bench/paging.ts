/**
 * Paging cost, measured — the evidence behind #116.
 *
 * The claim under test is a shape, not a constant: if every `read({ offset,
 * limit })` re-parses the whole workbook, then paging a sheet costs
 * O(rows²/limit) and doubling the sheet quadruples the loop. So this measures
 * two things and neither is a single number:
 *
 *   1. **Per-page cost across one loop.** Quadratic paging is visible without
 *      any baseline to compare against: page 20 costs the same as page 1 even
 *      though it does the same work on the same file, so the *total* grows
 *      with the page count rather than with the rows.
 *   2. **Scaling across sheet sizes.** 25k → 50k → 100k rows at a fixed page
 *      size. Linear paging tracks the row count (2×, 4×); quadratic paging
 *      tracks its square (4×, 16×).
 *
 * Run: `pnpm --filter glove-env-spreadsheets bench`
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { spreadsheets } from "../src/index";
import type { ReadResult } from "../src/index";

const SIZES = (process.env.BENCH_ROWS ?? "25000,50000,100000").split(",").map((n) => Number(n.trim()));
const PAGE = Number(process.env.BENCH_PAGE ?? 5000);

/**
 * Build the fixture with exceljs's *streaming writer*.
 *
 * The ordinary `Workbook` holds a live cell object per cell, and 100k × 6 is
 * enough of them to dominate the benchmark's own runtime and skew the heap the
 * measurement then runs in.
 */
async function fixture(dir: string, rows: number): Promise<Uint8Array> {
  const file = join(dir, `rows-${rows}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Data");
  ws.addRow(["id", "region", "rep", "units", "revenue", "note"]).commit();
  const regions = ["EMEA", "AMER", "APAC", "LATAM"];
  for (let i = 1; i <= rows; i++) {
    ws.addRow([i, regions[i % 4], `rep-${i % 997}`, i % 50, (i * 37) % 100000, `note ${i}`]).commit();
  }
  ws.commit();
  await wb.commit();
  return readFile(file);
}

function ms(n: number): string {
  return `${n.toFixed(0)}ms`;
}

async function pageThrough(
  read: (path: string, opts: Record<string, unknown>) => Promise<ReadResult>,
  path: string,
): Promise<{ totalMs: number; pages: number[]; rows: number }> {
  const pages: number[] = [];
  let offset = 0;
  let total = 0;
  let seen = 0;
  const started = performance.now();
  for (;;) {
    const t0 = performance.now();
    const page = await read(path, { offset, limit: PAGE });
    pages.push(performance.now() - t0);
    total = page.totalRows;
    if (page.rows.length === 0) break;
    seen += page.rows.length;
    offset += page.rows.length;
    if (offset >= total) break;
  }
  if (seen !== total) throw new Error(`bench read ${seen} of ${total} rows — the loop is wrong, not the adapter`);
  return { totalMs: performance.now() - started, pages, rows: total };
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "glove-sheets-bench-"));
  const results: Array<{ rows: number; totalMs: number; first: number; rest: number; last: number; count: number }> = [];

  try {
    for (const rows of SIZES) {
      const bytes = await fixture(dir, rows);
      // maxFileBytes/maxVfsBytes default to 32/128 MiB; a 100k-row sheet is a
      // couple of MB, but say so explicitly rather than depend on it.
      const t = await createAdapterTestEnv(spreadsheets(), {
        limits: { maxFileBytes: 256 * 1024 * 1024, maxVfsBytes: 512 * 1024 * 1024 },
      });
      try {
        const path = "/inbox/big.xlsx";
        await t.fs.writeFile(path, bytes);

        const api = spreadsheets().create(t.fs) as {
          read(path: string, opts: Record<string, unknown>): Promise<ReadResult>;
        };

        // Warm V8 on a DIFFERENT workbook. Touching the one under test would
        // move its first parse outside the measurement, which is exactly the
        // cost the whole comparison is about.
        await t.fs.writeFile("/inbox/warm.xlsx", await fixture(dir, 50));
        await api.read("/inbox/warm.xlsx", {});

        // Everything below is timed, page 1's full parse included — the
        // baseline paid that on every page, so hiding it on either side would
        // make the two numbers incomparable.
        const run = await pageThrough((p, o) => api.read(p, o), path);
        const first = run.pages[0];
        const last = run.pages[run.pages.length - 1];
        const rest = run.pages.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, run.pages.length - 1);
        results.push({ rows, totalMs: run.totalMs, first, rest, last, count: run.pages.length });

        console.log(
          `${String(rows).padStart(7)} rows  ${String(run.pages.length).padStart(3)} pages of ${PAGE}` +
            `   total ${ms(run.totalMs).padStart(9)}` +
            `   page1 ${ms(first).padStart(8)}` +
            `   mean(page2..n) ${ms(rest).padStart(8)}` +
            `   last ${ms(last).padStart(8)}`,
        );
      } finally {
        await t.env.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log("");
  console.log("Scaling (total paging time vs the smallest sheet):");
  const base = results[0];
  for (const r of results) {
    const rowFactor = r.rows / base.rows;
    const timeFactor = r.totalMs / base.totalMs;
    console.log(
      `  ${String(r.rows).padStart(7)} rows: ${rowFactor.toFixed(1)}× the rows, ${timeFactor.toFixed(1)}× the time` +
        `   (linear would be ~${rowFactor.toFixed(1)}×, quadratic ~${(rowFactor * rowFactor).toFixed(1)}×)`,
    );
  }

  console.log("");
  console.log("Per-page flatness (mean of pages 2..n ÷ page 1) — 1.0 means every page re-parses:");
  for (const r of results) {
    console.log(`  ${String(r.rows).padStart(7)} rows: ${(r.rest / r.first).toFixed(3)}`);
  }
}

await main();
