# glove-env-spreadsheets

Spreadsheet stdlib adapter for [`glove-working-environment`](../glove-working-environment). Registers `env:spreadsheets`, giving an agent's scripts `.xlsx` workbooks that live in the virtual filesystem.

```bash
pnpm add glove-env-spreadsheets
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { spreadsheets } from "glove-env-spreadsheets";

const env = await createWorkingEnvironment({ stdlib: [spreadsheets()] });
await env.mount("./q3.xlsx", "/inbox/q3.xlsx");
```

The model then writes scripts against it, with types at `/std/spreadsheets/index.d.ts` and worked examples at `/std/spreadsheets/README.md`:

```js
import { read, write } from 'env:spreadsheets';

export default async function main(args) {
  const { rows, totalRows } = await read(args.input, { sheet: 'Sales' });
  const byRegion = new Map();
  for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + Number(r.revenue));
  const summary = [...byRegion].map(([region, revenue]) => ({ region, revenue }));
  await write('/out/by-region.xlsx', summary, { sheet: 'Summary' });
  return { output: '/out/by-region.xlsx', regions: summary.length, rowsRead: totalRows };
}
```

## What it gives the model

| Function | Notes |
|---|---|
| `describe(path)` | Sheet names, sizes, headers, one sample row — costs the same for a 3-row and a 200k-row workbook |
| `sheets(path)` | Sheet names in workbook order |
| `read(path, opts?)` | Records keyed by the header row, plus `totalRows` for paging |
| `readRows(path, opts?)` | Raw rows, header included, for headerless data |
| `write(path, rows, opts?)` | Records or raw rows → a new single-sheet workbook |
| `writeSheets(path, sheets, opts?)` | Several named sheets in one workbook |
| `append(path, rows, opts?)` | Appends following the sheet's existing header order |
| `toCsv` / `fromCsv` | Bridge one sheet to and from a CSV file |
| `Workbook` | exceljs's own class, for everything the verbs above cannot express |

## When the verbs are not enough

`write(path, rows)` gets data into a file. Everything that makes a workbook a
deliverable — a bold header, thousands separators, column widths, a merged
title, a frozen pane, a formula — lives on exceljs's `Workbook`, which is
exported as-is:

```js
import { Workbook } from 'env:spreadsheets';

const wb = new Workbook();
const ws = wb.addWorksheet('Revenue');
ws.columns = [
  { header: 'Region',  key: 'region',  width: 24 },
  { header: 'Revenue', key: 'revenue', width: 18 },
];
ws.addRows(rows);
ws.getRow(1).font = { bold: true };
ws.getColumn('revenue').numFmt = '#,##0';
ws.views = [{ state: 'frozen', ySplit: 1 }];
await wb.xlsx.writeFile('/out/revenue.xlsx');
```

That is exceljs, verbatim from its own documentation — which is the point.
Models have read thousands of examples of exactly this shape, and an API that
differs makes them translate.

Everything is synchronous until the write. `wb.xlsx.writeFile(path)`,
`wb.csv.writeFile(path)` and `wb.xlsx.writeBuffer()` are the terminals: one of
them must be awaited, or the workbook is built and nothing is produced. The
library's own `writeFile` is *replaced*, not wrapped — bytes are produced in
memory and land in the VFS through the guarded handle, so zones, limits and
versioning apply exactly as they do to any other write.

## Design notes

**Cell values are plain JSON, always.** exceljs returns rich objects — `{ richText: [...] }`, `{ formula, result }`, `{ error: '#DIV/0!' }`, `Date` instances, `{ text, hyperlink }`. Handing those to a model spends tokens saying nothing and teaches it to write defensive unwrapping. Everything is flattened: formulas to their computed result, rich text to a string, dates to ISO strings, error cells to their marker. `read({ formulas: true })` returns the formula text in a parallel map when you actually want it.

**No silently dropped columns.** A blank header cell becomes its column letter (`A`, `B`, …); duplicates get a `_2` suffix. Records with ragged keys contribute every key they have as a column.

**`append` follows the sheet, not the record.** Appending `{ b: 20, a: 10 }` to a sheet whose headers are `a, b` writes `10, 20`. Key order in the record is irrelevant.

**Sheets are 1-based by index**, addressable by name, and a wrong name lists the real ones in the error.

Only `.xlsx` is supported — legacy `.xls`, Numbers and ODS are not, and the error says so rather than failing deep inside a zip parser.

## License

MIT
