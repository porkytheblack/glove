/**
 * Worked recipes for env:spreadsheets, materialized under /skills.
 *
 * `/std/spreadsheets/index.d.ts` says what the module exports; this says how
 * to get a workbook out of it. Models reach for a remembered shape before
 * they read a signature, so the fix is a correct example in front of them.
 */
import type { StdlibAdapter } from "glove-working-environment";

type Skill = NonNullable<StdlibAdapter["skills"]>[number];

const QUICK: Skill = {
  name: "spreadsheets-quick",
  summary: "Read a sheet as records, write results back — describe first.",
  body: `# Reading and writing a workbook

\`describe\` costs a few hundred tokens no matter how big the file is. Start
there; never read a workbook you have not looked at.

\`\`\`js
import { describe, read, write } from 'env:spreadsheets';

export default async function main() {
  const info = await describe('/inbox/q3.xlsx');   // sheets, headers, one sample row
  const { rows } = await read('/inbox/q3.xlsx', { sheet: info.sheets[0].name });

  const byRegion = new Map();
  for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + Number(r.revenue));

  await write('/out/by-region.xlsx', [...byRegion].map(([region, revenue]) => ({ region, revenue })));
  return '/out/by-region.xlsx';
}
\`\`\`

Cell values arrive as plain JSON — formulas as their computed result, dates
as ISO strings. You never unwrap a library object.

Big sheet? \`read\` takes \`{ offset, limit }\` and returns \`totalRows\`, so
page through it rather than pulling 200k rows into one response.
`,
};

const STYLING: Skill = {
  name: "spreadsheets-styling",
  summary: "Bold headers, number formats, widths, merged cells: the exceljs Workbook.",
  body: `# A workbook that looks like a deliverable

\`write()\` gets rows into a file. Everything that makes it readable — a bold
header row, thousands separators, column widths, a merged title, a frozen
pane — is on exceljs's \`Workbook\`, which is exported as-is. Code written
against exceljs's documentation works here as written.

Everything is synchronous until the write, which is the only await.

\`\`\`js
import { Workbook } from 'env:spreadsheets';

export default async function main() {
  const wb = new Workbook();
  const ws = wb.addWorksheet('Revenue');

  ws.columns = [
    { header: 'Region',  key: 'region',  width: 24 },
    { header: 'Revenue', key: 'revenue', width: 18 },
    { header: 'Share',   key: 'share',   width: 12 },
  ];

  ws.addRows([
    { region: 'EMEA', revenue: 2435210, share: 0.41 },
    { region: 'AMER', revenue: 1980430, share: 0.33 },
  ]);

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FF' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];        // header stays put when scrolling
  ws.getColumn('revenue').numFmt = '#,##0';
  ws.getColumn('share').numFmt = '0.0%';

  const total = ws.addRow({ region: 'TOTAL', revenue: 4415640, share: 1 });
  total.font = { bold: true };
  total.border = { top: { style: 'thin' } };

  await wb.xlsx.writeFile('/out/revenue.xlsx');
  return '/out/revenue.xlsx';
}
\`\`\`

Things worth knowing:

- **Only the write is async.** \`wb.xlsx.writeFile(path)\`, \`wb.csv.writeFile(path)\`
  and \`wb.xlsx.writeBuffer()\` — one of them must be awaited, or the workbook
  is built and nothing is produced.
- **Rows and columns are 1-indexed.** \`getRow(1)\` is the header you just added.
- **A formula is \`{ formula: 'SUM(B2:B3)' }\`** as a cell value.
- **Merged title:** \`ws.mergeCells('A1:C1')\` then set \`ws.getCell('A1').value\`.
- Read it back with \`describe('/out/revenue.xlsx')\` and check the row count.
`,
};

export const SPREADSHEETS_SKILLS: Skill[] = [QUICK, STYLING];
