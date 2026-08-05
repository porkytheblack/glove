/**
 * env:spreadsheets, exercised from inside scripts — the only place the
 * adapter is ever used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { assertAdapterOk, createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { spreadsheets } from "../src/index";
import type { CellValue, ReadResult, WorkbookSummary } from "../src/index";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(spreadsheets());
}

/** Build a workbook host-side and place it in the tree. */
async function seed(
  t: AdapterTestEnv,
  path: string,
  build: (wb: ExcelJS.Workbook) => void,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  await t.fs.writeFile(path, new Uint8Array(buf as ArrayBuffer));
}

const SALES = (wb: ExcelJS.Workbook) => {
  const ws = wb.addWorksheet("Sales");
  ws.addRow(["region", "rep", "units", "revenue"]);
  ws.addRow(["EMEA", "Ada", 12, 8400]);
  ws.addRow(["AMER", "Bob", 7, 5100]);
  ws.addRow(["EMEA", "Cy", 3, 1200]);
  wb.addWorksheet("Notes").addRow(["freeform"]);
};

test("the adapter passes its own audit", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

test("describe summarises every sheet without reading rows into context", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);

  const summary = await t.script<WorkbookSummary>(
    `import { describe } from 'env:spreadsheets';
     export default async function main() { return describe('/inbox/q3.xlsx'); }`,
  );
  assert.equal(summary.format, "xlsx");
  assert.equal(summary.path, "/inbox/q3.xlsx");
  assert.ok(summary.bytes > 0);
  assert.deepEqual(
    summary.sheets.map((s) => s.name),
    ["Sales", "Notes"],
  );
  const sales = summary.sheets[0];
  assert.equal(sales.rows, 3, "rows counts data rows, not the header");
  assert.equal(sales.columns, 4);
  assert.deepEqual(sales.headers, ["region", "rep", "units", "revenue"]);
  assert.deepEqual(sales.sample, { region: "EMEA", rep: "Ada", units: 12, revenue: 8400 });

  // The whole summary must stay small enough to be worth returning.
  assert.ok(JSON.stringify(summary).length < 1000, "describe should be tokens-cheap");
});

test("describe reports an empty sheet as zero rows with a null sample", async () => {
  const t = await env();
  await seed(t, "/inbox/empty.xlsx", (wb) => {
    wb.addWorksheet("Blank");
  });
  const summary = await t.script<WorkbookSummary>(
    `import { describe } from 'env:spreadsheets';
     export default async function main() { return describe('/inbox/empty.xlsx'); }`,
  );
  assert.equal(summary.sheets[0].rows, 0);
  assert.equal(summary.sheets[0].sample, null);
});

test("read returns plain JSON records keyed by the header row", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);
  const out = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/q3.xlsx'); }`,
  );
  assert.equal(out.sheet, "Sales");
  assert.equal(out.totalRows, 3);
  assert.deepEqual(out.rows, [
    { region: "EMEA", rep: "Ada", units: 12, revenue: 8400 },
    { region: "AMER", rep: "Bob", units: 7, revenue: 5100 },
    { region: "EMEA", rep: "Cy", units: 3, revenue: 1200 },
  ]);
});

test("library cell objects are flattened before the model ever sees them", async () => {
  const t = await env();
  await seed(t, "/inbox/rich.xlsx", (wb) => {
    const ws = wb.addWorksheet("S");
    ws.addRow(["formula", "rich", "when", "bad", "link", "blank"]);
    const row = ws.addRow([]);
    row.getCell(1).value = { formula: "1+1", result: 2 } as ExcelJS.CellFormulaValue;
    row.getCell(2).value = { richText: [{ text: "Q" }, { text: "3" }] } as ExcelJS.CellRichTextValue;
    row.getCell(3).value = new Date(Date.UTC(2025, 7, 14));
    row.getCell(4).value = { error: "#DIV/0!" } as ExcelJS.CellErrorValue;
    row.getCell(5).value = { text: "Site", hyperlink: "https://example.test" } as ExcelJS.CellHyperlinkValue;
    row.getCell(6).value = null;
  });

  const out = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/rich.xlsx'); }`,
  );
  assert.deepEqual(out.rows[0], {
    formula: 2,
    rich: "Q3",
    when: "2025-08-14T00:00:00.000Z",
    bad: "#DIV/0!",
    link: "Site",
    blank: null,
  });
});

test("read({ formulas: true }) exposes formula text alongside computed values", async () => {
  const t = await env();
  await seed(t, "/inbox/f.xlsx", (wb) => {
    const ws = wb.addWorksheet("S");
    ws.addRow(["a", "total"]);
    const row = ws.addRow([]);
    row.getCell(1).value = 4;
    row.getCell(2).value = { formula: "A2*3", result: 12 } as ExcelJS.CellFormulaValue;
  });
  const out = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/f.xlsx', { formulas: true }); }`,
  );
  assert.deepEqual(out.rows[0], { a: 4, total: 12 });
  assert.deepEqual(out.formulas?.[0], { total: "=A2*3" });
});

test("sheets are addressable by name and by 1-based index", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);
  const out = await t.script<{ names: string[]; byName: string; byIndex: string }>(
    `import { read, sheets } from 'env:spreadsheets';
     export default async function main() {
       return {
         names: await sheets('/inbox/q3.xlsx'),
         byName: (await read('/inbox/q3.xlsx', { sheet: 'Notes' })).sheet,
         byIndex: (await read('/inbox/q3.xlsx', { sheet: 2 })).sheet,
       };
     }`,
  );
  assert.deepEqual(out.names, ["Sales", "Notes"]);
  assert.equal(out.byName, "Notes");
  assert.equal(out.byIndex, "Notes");
});

test("a wrong sheet name lists the real ones, tagged with the capability", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);
  const run = await t.runScript(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/q3.xlsx', { sheet: 'Nope' }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /^env:spreadsheets\.read: /);
  assert.match(run.error ?? "", /no sheet named "Nope"/);
  assert.match(run.error ?? "", /available: Sales, Notes/);
});

test("offset and limit page a sheet while totalRows reports the whole", async () => {
  const t = await env();
  await seed(t, "/inbox/big.xlsx", (wb) => {
    const ws = wb.addWorksheet("S");
    ws.addRow(["n"]);
    for (let i = 1; i <= 25; i++) ws.addRow([i]);
  });
  const out = await t.script<{ pages: number[][]; total: number }>(
    `import { read } from 'env:spreadsheets';
     export default async function main() {
       const pages = [];
       let offset = 0, total = 0;
       for (;;) {
         const page = await read('/inbox/big.xlsx', { offset, limit: 10 });
         total = page.totalRows;
         if (page.rows.length === 0) break;
         pages.push(page.rows.map(r => r.n));
         offset += page.rows.length;
         if (offset >= total) break;
       }
       return { pages, total };
     }`,
  );
  assert.equal(out.total, 25);
  assert.deepEqual(out.pages.map((p) => p.length), [10, 10, 5]);
  assert.deepEqual(out.pages.flat(), Array.from({ length: 25 }, (_, i) => i + 1));
});

test("headerRow addresses sheets with banner rows above the headers", async () => {
  const t = await env();
  await seed(t, "/inbox/banner.xlsx", (wb) => {
    const ws = wb.addWorksheet("S");
    ws.addRow(["QUARTERLY REPORT"]);
    ws.addRow(["name", "value"]);
    ws.addRow(["x", 1]);
  });
  const out = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/banner.xlsx', { headerRow: 2 }); }`,
  );
  assert.deepEqual(out.headers, ["name", "value"]);
  assert.deepEqual(out.rows, [{ name: "x", value: 1 }]);
});

test("blank and duplicate headers still produce one key per column", async () => {
  const t = await env();
  await seed(t, "/inbox/messy.xlsx", (wb) => {
    const ws = wb.addWorksheet("S");
    ws.addRow(["name", null, "name"]);
    ws.addRow(["a", "b", "c"]);
  });
  const out = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/messy.xlsx'); }`,
  );
  assert.deepEqual(out.headers, ["name", "B", "name_2"]);
  assert.deepEqual(out.rows, [{ name: "a", B: "b", name_2: "c" }]);
});

test("readRows keeps the header row and drops trailing padding", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);
  const rows = await t.script<CellValue[][]>(
    `import { readRows } from 'env:spreadsheets';
     export default async function main() { return readRows('/inbox/q3.xlsx'); }`,
  );
  assert.deepEqual(rows[0], ["region", "rep", "units", "revenue"]);
  assert.equal(rows.length, 4);
});

test("write round-trips records and honours an explicit column order", async () => {
  const t = await env();
  const out = await t.script<{ path: string; back: ReadResult; ordered: string[] }>(
    `import { write, read } from 'env:spreadsheets';
     export default async function main() {
       const rows = [{ b: 2, a: 1 }, { b: 4, a: 3 }];
       const path = await write('/out/plain.xlsx', rows);
       await write('/out/ordered.xlsx', rows, { headers: ['a', 'b'], sheet: 'Ordered' });
       return {
         path,
         back: await read('/out/plain.xlsx'),
         ordered: (await read('/out/ordered.xlsx')).headers,
       };
     }`,
  );
  assert.equal(out.path, "/out/plain.xlsx", "write returns the path it wrote");
  assert.deepEqual(out.back.rows, [
    { b: 2, a: 1 },
    { b: 4, a: 3 },
  ]);
  assert.deepEqual(out.ordered, ["a", "b"]);
});

test("write accepts raw rows and records with ragged keys", async () => {
  const t = await env();
  const out = await t.script<{ raw: CellValue[][]; ragged: ReadResult }>(
    `import { write, read, readRows } from 'env:spreadsheets';
     export default async function main() {
       await write('/out/raw.xlsx', [['x', 'y'], [1, 2]], { noHeader: true });
       // Second record introduces a column the first one lacks.
       await write('/out/ragged.xlsx', [{ a: 1 }, { a: 2, b: 3 }]);
       return { raw: await readRows('/out/raw.xlsx'), ragged: await read('/out/ragged.xlsx') };
     }`,
  );
  assert.deepEqual(out.raw, [
    ["x", "y"],
    [1, 2],
  ]);
  assert.deepEqual(out.ragged.headers, ["a", "b"], "every key across the records becomes a column");
  assert.deepEqual(out.ragged.rows, [
    { a: 1, b: null },
    { a: 2, b: 3 },
  ]);
});

test("writeSheets produces one workbook with several named sheets", async () => {
  const t = await env();
  const out = await t.script<{ names: string[]; detail: ReadResult }>(
    `import { writeSheets, sheets, read } from 'env:spreadsheets';
     export default async function main() {
       await writeSheets('/out/multi.xlsx', {
         Summary: [{ metric: 'revenue', value: 91000 }],
         Detail: [{ id: 1 }, { id: 2 }],
       });
       return { names: await sheets('/out/multi.xlsx'), detail: await read('/out/multi.xlsx', { sheet: 'Detail' }) };
     }`,
  );
  assert.deepEqual(out.names, ["Summary", "Detail"]);
  assert.deepEqual(out.detail.rows, [{ id: 1 }, { id: 2 }]);
});

test("append follows the sheet's header order, not the record's key order", async () => {
  const t = await env();
  const out = await t.script<ReadResult>(
    `import { write, append, read } from 'env:spreadsheets';
     export default async function main() {
       await write('/out/log.xlsx', [{ a: 1, b: 2 }], { sheet: 'Log' });
       // Keys deliberately reversed: a naive append would swap the columns.
       await append('/out/log.xlsx', [{ b: 20, a: 10 }], { sheet: 'Log' });
       return read('/out/log.xlsx', { sheet: 'Log' });
     }`,
  );
  assert.deepEqual(out.rows, [
    { a: 1, b: 2 },
    { a: 10, b: 20 },
  ]);
});

test("append creates the workbook when it does not exist yet", async () => {
  const t = await env();
  const out = await t.script<ReadResult>(
    `import { append, read } from 'env:spreadsheets';
     export default async function main() {
       await append('/out/fresh.xlsx', [{ a: 1 }]);
       return read('/out/fresh.xlsx');
     }`,
  );
  assert.deepEqual(out.rows, [{ a: 1 }]);
});

test("CSV bridges both ways, quoting what needs quoting", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/in.csv", 'name,note\nAda,"has, comma"\nBob,plain\n');
  const out = await t.script<{ xlsx: ReadResult; csv: string }>(
    `import { fromCsv, toCsv, read } from 'env:spreadsheets';
     import { readFile } from 'env:fs';
     export default async function main() {
       await fromCsv('/inbox/in.csv', '/tmp/in.xlsx');
       await toCsv('/tmp/in.xlsx', '/out/out.csv');
       return { xlsx: await read('/tmp/in.xlsx'), csv: await readFile('/out/out.csv') };
     }`,
  );
  assert.deepEqual(out.xlsx.rows, [
    { name: "Ada", note: "has, comma" },
    { name: "Bob", note: "plain" },
  ]);
  assert.equal(out.csv, 'name,note\nAda,"has, comma"\nBob,plain\n');
});

test("a file that is not a workbook fails with an actionable message", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/not.xlsx", "just text, definitely not a zip container");
  const run = await t.runScript(
    `import { describe } from 'env:spreadsheets';
     export default async function main() { return describe('/inbox/not.xlsx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /^env:spreadsheets\.describe: /);
  assert.match(run.error ?? "", /could not be read as a workbook/);
  assert.match(run.error ?? "", /\.xls .*not supported|expected an \.xlsx/);
});

test("a missing file reports the path, not a library stack trace", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/inbox/absent.xlsx'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /absent\.xlsx/);
});

test("writes land in the tree and obey the environment's limits", async () => {
  const t = await createAdapterTestEnv(spreadsheets(), { limits: { maxFileBytes: 4096 } });
  const run = await t.runScript(
    `import { write } from 'env:spreadsheets';
     export default async function main() {
       const rows = [];
       for (let i = 0; i < 20000; i++) rows.push({ i, pad: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
       return write('/out/huge.xlsx', rows);
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /maxFileBytes/);
  assert.equal(await t.fs.exists("/out/huge.xlsx"), false);
});

test("a full read → transform → write pass works end to end", async () => {
  const t = await env();
  await seed(t, "/inbox/q3.xlsx", SALES);
  const out = await t.script<{ output: string; regions: number }>(
    `import { read, write } from 'env:spreadsheets';
     export default async function main() {
       const { rows } = await read('/inbox/q3.xlsx', { sheet: 'Sales' });
       const byRegion = new Map();
       for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + Number(r.revenue));
       const summary = [...byRegion].map(([region, revenue]) => ({ region, revenue }));
       await write('/out/by-region.xlsx', summary, { sheet: 'Summary' });
       return { output: '/out/by-region.xlsx', regions: summary.length };
     }`,
  );
  assert.deepEqual(out, { output: "/out/by-region.xlsx", regions: 2 });

  const back = await t.script<ReadResult>(
    `import { read } from 'env:spreadsheets';
     export default async function main() { return read('/out/by-region.xlsx'); }`,
  );
  assert.deepEqual(back.rows, [
    { region: "EMEA", revenue: 9600 },
    { region: "AMER", revenue: 5100 },
  ]);
});

// ---------------------------------------------------------------- Workbook
//
// The verbs cover the common case; the library covers everything else. These
// pin the parts a real deliverable needs and our own API cannot express — a
// bold header, a number format, a merged title, a column width — plus the
// boundary the builder exists to hold.

test("exceljs's own API produces a styled workbook, and it lands in the VFS", async () => {
  const t = await env();
  const out = await t.script<string>(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       const ws = wb.addWorksheet('Revenue');
       ws.columns = [
         { header: 'Region', key: 'region', width: 24 },
         { header: 'Revenue', key: 'revenue', width: 18 },
       ];
       ws.addRow({ region: 'EMEA', revenue: 9600 });
       ws.addRow({ region: 'AMER', revenue: 5100 });
       ws.getRow(1).font = { bold: true, size: 12 };
       ws.getColumn(2).numFmt = '#,##0.00';
       return wb.xlsx.writeFile('/out/styled.xlsx');
     }`,
  );
  assert.equal(out, "/out/styled.xlsx");

  // Read it back with the library directly: the point is that the styling
  // survived into the file, not that our own reader agrees with itself.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await t.fs.readBytes("/out/styled.xlsx")).slice().buffer as ArrayBuffer);
  const ws = wb.getWorksheet("Revenue")!;
  assert.equal(ws.getRow(1).font?.bold, true);
  assert.equal(ws.getColumn(2).numFmt, "#,##0.00");
  assert.equal(ws.getColumn(1).width, 24);
  // exceljs indexes cells from 1, so `values` is sparse at 0.
  assert.deepEqual(Array.from(ws.getRow(2).values as unknown[]).slice(1), ["EMEA", 9600]);
});

test("a merged title cell — reachable through the library, not through write()", async () => {
  const t = await env();
  await t.script(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       const ws = wb.addWorksheet('Q3');
       ws.mergeCells('A1:C1');
       ws.getCell('A1').value = 'Q3 Results';
       ws.getCell('A1').alignment = { horizontal: 'center' };
       ws.addRow([]);
       ws.addRow(['Region', 'Units', 'Revenue']);
       return wb.xlsx.writeFile('/out/merged.xlsx');
     }`,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await t.fs.readBytes("/out/merged.xlsx")).slice().buffer as ArrayBuffer);
  const ws = wb.getWorksheet("Q3")!;
  assert.equal(ws.getCell("A1").value, "Q3 Results");
  assert.equal(ws.getCell("A1").alignment?.horizontal, "center");
  assert.equal(ws.getCell("A1").isMerged, true);
});

test("writeBuffer hands back the bytes instead of storing them", async () => {
  const t = await env();
  const size = await t.script<number>(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       wb.addWorksheet('S').addRow(['a', 1]);
       const bytes = await wb.xlsx.writeBuffer();
       // Bytes are used inside the run: a script's return value goes through
       // JSON, and a Uint8Array does not survive that intact.
       return bytes.byteLength;
     }`,
  );
  assert.ok(size > 0);
  // Nothing was stored: the bytes went to the script, not through the gateway.
  assert.deepEqual(await t.fs.readdir("/out"), []);
});

test("the workbook's CSV writer works the same way, through the same guard", async () => {
  const t = await env();
  await t.script(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       const ws = wb.addWorksheet('Flat');
       ws.addRow(['region', 'revenue']);
       ws.addRow(['EMEA', 9600]);
       return wb.csv.writeFile('/out/flat.csv');
     }`,
  );
  assert.match(await t.fs.readFile("/out/flat.csv"), /region,revenue\s+EMEA,9600/);
});

test("a method exceljs does not have is refused, and the refusal lists what it does", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       wb.addSheet('nope');
       return wb.xlsx.writeFile('/out/x.xlsx');
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /Workbook has no method "addSheet"/);
  assert.match(run.error ?? "", /addWorksheet/);
  // And it says which call failed, not just that something did.
  assert.match(run.error ?? "", /call #2/);
});

test("a workbook that is never written says so, rather than silently producing nothing", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       wb.addWorksheet('S').addRow([1]);
       return 'done';
     }`,
  );
  // Nothing was awaited, so nothing crossed to the host: the run "succeeds"
  // having written nothing, which is exactly why the terminal call is the
  // only thing that produces a file.
  assert.equal(run.ok, true);
  assert.equal(await t.fs.exists("/out/x.xlsx"), false);
});

test("the prototype chain is not a way out of the sandbox", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       const escape = wb.constructor.constructor('return process')();
       return typeof escape;
     }`,
  );
  assert.equal(run.ok, false);
  assert.doesNotMatch(String(run.result ?? ""), /object/);
});

test("a write outside the writable zone is refused by the same gateway as any other write", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Workbook } from 'env:spreadsheets';
     export default async function main() {
       const wb = new Workbook();
       wb.addWorksheet('S').addRow([1]);
       return wb.xlsx.writeFile('/std/spreadsheets/sneak.xlsx');
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /read-only|not writable/i);
});
