/**
 * What the model reads. `types` is materialized at
 * `/std/spreadsheets/index.d.ts` and `docs` at
 * `/std/spreadsheets/README.md`; between them they are the entire API
 * documentation the agent ever sees, so they have to be exact — a function
 * declared here that `create()` does not return is a crash waiting to happen
 * (the adapter audit checks both directions).
 */

export const SPREADSHEETS_TYPES = `/** env:spreadsheets — .xlsx workbooks in the virtual filesystem. */

export type CellValue = string | number | boolean | null;

export interface SheetSummary {
  name: string;
  /** Data rows, excluding the header row. */
  rows: number;
  columns: number;
  headers: string[];
  /** The first data row as a record, or null for an empty sheet. */
  sample: Record<string, CellValue> | null;
}

export interface WorkbookSummary {
  path: string;
  format: "xlsx";
  bytes: number;
  sheets: SheetSummary[];
}

export interface ReadOptions {
  /** Sheet name, or 1-based index. Default: the first sheet. */
  sheet?: string | number;
  /** 1-based row holding the headers. Default 1. */
  headerRow?: number;
  /** Skip this many data rows. Default 0. */
  offset?: number;
  /** Return at most this many data rows. Use it — sheets get large. */
  limit?: number;
  /** Also return the formula behind each cell that has one. */
  formulas?: boolean;
}

export interface ReadResult {
  sheet: string;
  headers: string[];
  rows: Array<Record<string, CellValue>>;
  /** Data rows in the sheet, ignoring offset/limit — page with this. */
  totalRows: number;
  formulas?: Array<Record<string, string>>;
}

export interface WriteOptions {
  /** Sheet name to create. Default "Sheet1". */
  sheet?: string;
  /** Column order and header text for record input. Default: keys of the records. */
  headers?: string[];
  /** Omit the header row (raw-row input only). */
  noHeader?: boolean;
}

/** Summarise a workbook — sheets, sizes, headers, one sample row. Start here. */
export function describe(path: string): Promise<WorkbookSummary>;

/** Sheet names, in workbook order. */
export function sheets(path: string): Promise<string[]>;

/** Read a sheet as records keyed by its header row. */
export function read(path: string, opts?: ReadOptions): Promise<ReadResult>;

/** Read a sheet as raw rows, header row included. */
export function readRows(path: string, opts?: ReadOptions): Promise<CellValue[][]>;

/** Write records (or raw rows) to a new single-sheet workbook. Returns the path. */
export function write(path: string, rows: Array<Record<string, unknown>> | unknown[][], opts?: WriteOptions): Promise<string>;

/** Write several named sheets to one workbook. Returns the path. */
export function writeSheets(path: string, sheets: Record<string, Array<Record<string, unknown>> | unknown[][]>, opts?: Omit<WriteOptions, "sheet">): Promise<string>;

/** Append rows to an existing sheet, following its header order. Creates the file if absent. */
export function append(path: string, rows: Array<Record<string, unknown>> | unknown[][], opts?: WriteOptions): Promise<string>;

/** Export one sheet to a CSV file. Returns the output path. */
export function toCsv(input: string, output: string, opts?: ReadOptions & { delimiter?: string }): Promise<string>;

/** Import a CSV file as a single-sheet workbook. Returns the output path. */
export function fromCsv(input: string, output: string, opts?: WriteOptions & { delimiter?: string }): Promise<string>;

/**
 * exceljs's \`Workbook\`, with exceljs's own API — for everything \`write()\`
 * cannot express: bold headers, number formats, column widths, merged cells,
 * formulas, frozen panes.
 *
 * Everything is synchronous until you write. Only \`xlsx.writeFile\`,
 * \`csv.writeFile\` and \`writeBuffer\` are async, and one of them must be
 * awaited or nothing is produced. Paths are virtual, as everywhere else.
 *
 * \`\`\`js
 * import { Workbook } from 'env:spreadsheets';
 * const wb = new Workbook();
 * const ws = wb.addWorksheet('Revenue');
 * ws.columns = [
 *   { header: 'Region', key: 'region', width: 24 },
 *   { header: 'Revenue', key: 'revenue', width: 18 },
 * ];
 * ws.addRow({ region: 'EMEA', revenue: 9600 });
 * ws.getRow(1).font = { bold: true };
 * ws.getColumn(2).numFmt = '#,##0.00';
 * await wb.xlsx.writeFile('/out/report.xlsx');
 * \`\`\`
 */
export const Workbook: typeof import('exceljs').Workbook;
`;

export const SPREADSHEETS_DOCS = `# env:spreadsheets

Read and write \`.xlsx\` workbooks that live in the tree. Cell values arrive as
plain JSON — formulas come through as their computed result, rich text as a
string, dates as ISO strings, error cells as \`"#DIV/0!"\` and friends. You
never have to unwrap a library object.

## Look before you read

\`describe\` costs a few hundred tokens regardless of file size. A 200k-row
workbook and a 3-row one summarise identically.

\`\`\`js
import { describe } from 'env:spreadsheets';

export default async function main() {
  return describe('/inbox/q3.xlsx');
  // → { path, format: 'xlsx', bytes: 48210, sheets: [
  //     { name: 'Sales', rows: 1204, columns: 5,
  //       headers: ['region','rep','units','revenue','closed'],
  //       sample: { region: 'EMEA', rep: 'Ada', units: 12, revenue: 8400, closed: '2025-08-14T00:00:00.000Z' } }
  //   ] }
}
\`\`\`

## Read, transform, write

Paths in, paths out. Keep the data in the script; return a path and a small
summary, not the rows.

\`\`\`js
import { read, write } from 'env:spreadsheets';

export default async function main(args) {
  const { rows, totalRows } = await read(args.input, { sheet: 'Sales' });

  const byRegion = new Map();
  for (const r of rows) {
    const revenue = Number(r.revenue) || 0;
    byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + revenue);
  }

  const summary = [...byRegion]
    .map(([region, revenue]) => ({ region, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  await write('/out/by-region.xlsx', summary, { sheet: 'Summary' });
  return { output: '/out/by-region.xlsx', regions: summary.length, rowsRead: totalRows };
}
\`\`\`

## Large sheets

\`read\` pulls the whole window into memory. For a big sheet, page with
\`offset\`/\`limit\` and accumulate as you go — \`totalRows\` always reports the
full count, so the loop condition is easy:

\`\`\`js
import { read } from 'env:spreadsheets';

export default async function main() {
  let offset = 0, total = 0, sum = 0;
  do {
    const page = await read('/inbox/big.xlsx', { offset, limit: 5000 });
    total = page.totalRows;
    for (const r of page.rows) sum += Number(r.amount) || 0;
    offset += page.rows.length;
    if (page.rows.length === 0) break;
  } while (offset < total);
  return { rows: total, sum };
}
\`\`\`

## Multiple sheets, appending, CSV

\`\`\`js
import { writeSheets, append, toCsv, fromCsv } from 'env:spreadsheets';

await writeSheets('/out/report.xlsx', {
  Summary: [{ metric: 'revenue', value: 91_000 }],
  Detail:  rows,
});

// append follows the sheet's existing header order, whatever order your
// record keys happen to be in
await append('/out/report.xlsx', [{ metric: 'units', value: 4_100 }], { sheet: 'Summary' });

await toCsv('/out/report.xlsx', '/out/summary.csv', { sheet: 'Summary' });
await fromCsv('/inbox/raw.csv', '/tmp/raw.xlsx');
\`\`\`

## Notes

- Sheets are addressed by name or by **1-based** index; a wrong name lists the
  real ones in the error.
- Blank header cells become their column letter (\`A\`, \`B\`, …); duplicate
  headers get a \`_2\` suffix, so no column is ever silently dropped.
- Only \`.xlsx\` is supported. Legacy \`.xls\`, Numbers and ODS are not.
- \`read({ formulas: true })\` adds a parallel \`formulas\` array holding the
  formula text for cells that have one — the \`rows\` values stay computed.
`;
