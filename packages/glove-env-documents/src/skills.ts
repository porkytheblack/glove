/**
 * Worked recipes for env:documents, materialized under /skills.
 *
 * `/std/documents/index.d.ts` says what the module exports; this says how to
 * get a document out of it. The measured failure in the analyst-desk eval was
 * never a misused signature — it was a remembered shape, written from memory,
 * that the module did not have. A correct example in front of the model is
 * the fix; a better error afterwards is not.
 */
import type { StdlibAdapter } from "glove-working-environment";

type Skill = NonNullable<StdlibAdapter["skills"]>[number];

const QUICK: Skill = {
  name: "documents-quick",
  summary: "One call for a PDF or Word file: pdf.create / docx.create.",
  body: `# A document in one call

Path FIRST, then the spec. The same spec makes either format.

\`\`\`js
import { pdf, docx } from 'env:documents';

export default async function main() {
  const spec = {
    title: 'Q3 Revenue Review',
    author: 'analysis agent',
    content: [
      { heading: 'Summary', level: 1 },
      { text: 'Revenue rose 18% against plan.' },
      { bullets: ['EMEA led at $2.4M', 'AMER flat', 'APAC down 4%'] },
      { table: { headers: ['Region', 'Revenue'], rows: [['EMEA', '$2,435,210']] } },
      { pageBreak: true },
      { image: '/tmp/chart.png', width: 420, height: 260 },
    ],
  };
  await pdf.create('/out/review.pdf', spec);
  await docx.create('/out/review.docx', spec);
  return '/out/review.pdf';
}
\`\`\`

Block kinds: \`heading\`, \`text\`, \`bullets\`, \`table\`, \`image\`, \`pageBreak\`.
Nothing else is understood, and anything else is silently not rendered — so
if you need a coloured run, a bordered table or a footer, use the library
instead (see \`documents-styling\`).

Check what you made before you finish:

\`\`\`js
const summary = await describe('/out/review.pdf');   // { pages, title, ... }
const back = await pdf.extractText('/out/review.pdf');
if (!back.text.includes('2,435,210')) throw new Error('the total did not render');
\`\`\`
`,
};

const STYLING: Skill = {
  name: "documents-styling",
  summary: "Full control over a Word file: the docx library's own API, unchanged.",
  body: `# A Word document with real formatting

\`docx.create\` covers the common document. For anything it does not name —
coloured runs, bordered tables, column widths, footers, landscape pages,
spacing — use the \`docx\` library directly. It is the real library, so code
written against docx's documentation works here as written.

Everything is synchronous until \`Packer\`, which is the only await. Nothing
is produced until you call it, and you write the bytes yourself.

\`\`\`js
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, PageOrientation,
} from 'env:documents';
import { writeFile } from 'env:fs';

export default async function main() {
  const cell = (text, bold) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } },
      children: [
        new Paragraph({ text: 'Q3 Revenue Review', heading: HeadingLevel.TITLE }),
        new Paragraph({
          spacing: { after: 240 },                       // twips: 1 inch = 1440
          children: [
            new TextRun({ text: 'Revenue rose ' }),
            new TextRun({ text: '18%', bold: true, color: 'C00000' }),
            new TextRun({ text: ' against plan.' }),
          ],
        }),
        new Paragraph({ text: 'By region', heading: HeadingLevel.HEADING_1 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top:    { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            left:   { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' },
            insideVertical:   { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({ children: [cell('Region', true), cell('Revenue', true)] }),
            new TableRow({ children: [cell('EMEA', false), cell('$2,435,210', false)] }),
          ],
        }),
        new Paragraph({ text: 'Source: transactions.csv', alignment: AlignmentType.RIGHT }),
      ],
    }],
  });

  await writeFile('/out/review.docx', await Packer.toBuffer(doc));
  return '/out/review.docx';
}
\`\`\`

Things worth knowing:

- **Sizes are twips.** 1 inch = 1440, 1 point = 20. Font \`size\` is in
  half-points, so \`size: 24\` is 12pt.
- **Colours are hex without \`#\`**: \`'C00000'\`.
- **An image comes from the tree**, as bytes:
  \`new ImageRun({ type: 'png', data: await readBytes('/tmp/chart.png'), transformation: { width: 400, height: 240 } })\`
- **\`Packer.toBuffer\` is the only thing that produces anything.** A document
  you build and never pack writes no file and reports no error.
- **You cannot read values back off what you built.** The whole document is
  recorded and replayed at the pack, so a property read gives you nothing
  useful. Compute what you need from your own data before you start.
- Read it back with \`docx.extractText('/out/review.docx')\` and check a figure
  you know is supposed to be in it.
`,
};

export const DOCUMENTS_SKILLS: Skill[] = [QUICK, STYLING];
