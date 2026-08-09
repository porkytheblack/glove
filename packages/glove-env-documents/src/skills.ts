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

const EDITING: Skill = {
  name: "documents-editing",
  summary: "Change a .docx you were given without rebuilding it: docx.replaceText.",
  body: `# Editing a document instead of regenerating it

'Change the client name in this contract' is an **edit**. Do not extract the
text and call \`docx.create\` — that rebuilds the file out of the only things a
document spec can say, and everything else is gone. Measured on a contract with
a header, a coloured client name and a logo, the rebuild dropped the header,
the logo and the colour, and the model reported success.

\`\`\`js
import { docx } from 'env:documents';

export default async function main() {
  const edit = await docx.replaceText('/inbox/contract.docx', {
    'Northwind Traders': 'Contoso Ltd',
  }, { output: '/out/contract.docx' });

  // → { path: '/out/contract.docx', replacements: 3,
  //     parts: [{ part: 'word/document.xml', replacements: 2 },
  //             { part: 'word/header1.xml', replacements: 1 }],
  //     unmatched: [] }
  if (edit.unmatched.length > 0) throw new Error('never found: ' + edit.unmatched.join(', '));
  return edit;
}
\`\`\`

Only the parts holding the matched text are rewritten. Styles, numbering,
themes, images, the relationship graph and every header you did not match are
copied across byte for byte.

## Getting the search string right

Matching is **literal and case-sensitive**. Read the document first and copy
the text out of it rather than typing what you expect it to say:

\`\`\`js
const { paragraphs } = await docx.extractText('/inbox/contract.docx');
const line = paragraphs.find(p => p.includes('Traders'));   // see how it is really written
\`\`\`

If nothing matches, \`replaceText\` throws rather than writing an identical file
— so a rename that did not happen cannot be reported as one. When several rules
are given and only some hit, \`unmatched\` names the misses; check it.

## What it will and will not do

- **Will** find text split across formatting runs — a bold client name inside a
  plain sentence is three runs in the file and one string here.
- **Will** put the replacement in the run the match started in, so bold stays
  bold and red stays red.
- **Will** edit headers, footers, footnotes and endnotes. \`{ parts: 'body' }\`
  narrows it to the body.
- **Will not** match across a paragraph break.
- **Will not** restyle, reflow or insert content — it replaces strings. To add
  a section, build a new document (see \`documents-styling\`).

## The same move for PDFs

There is no equivalent for PDF text: a PDF stores positioned glyphs, not
editable words, so 'replace' would mean re-typesetting the page. For a PDF, the
edits available are structural — \`merge\`, \`extractPages\`, \`split\`, \`stamp\`,
\`setMetadata\` — plus \`fillForm\` when it is a form.
`,
};

const INTERNATIONAL: Skill = {
  name: "documents-fonts-and-forms",
  summary: "Non-Latin PDF text needs an embedded font; filling a PDF form starts with readForm.",
  body: `# Writing a PDF in a script Helvetica cannot draw

A PDF draws with the font it carries. \`pdf.create\` uses Helvetica unless you
say otherwise, and Helvetica stops at Latin-1 — so Japanese, Chinese, Korean,
Cyrillic, Greek, Arabic, Hebrew, Thai and Devanagari all come out as \`?\`.

Give it a font file that lives in the tree:

\`\`\`js
import { pdf } from 'env:documents';

export default async function main() {
  await pdf.create('/out/keiyaku.pdf', {
    title: '契約書',                                  // metadata needs no font
    font: '/fonts/NotoSansJP-Regular.ttf',           // or { regular: '…', bold: '…' }
    content: [{ heading: '契約書' }, { text: '本契約は…' }],
  });

  // Prove it, don't assume it: read the glyphs back as characters.
  const back = await pdf.extractText('/out/keiyaku.pdf');
  if (back.text.includes('?')) throw new Error('the font did not cover the text');
  return back.text;
}
\`\`\`

- Only the glyphs used are embedded, so a multi-megabyte CJK face costs a few
  kilobytes of PDF.
- A font with **no glyph** for a character in the document is refused, and the
  message lists the characters. That is deliberate: an unmapped glyph is drawn
  as a blank box, which looks correct to the code and broken to the reader.
- A Latin font with a few extra symbols is not a CJK font. Use one built for
  the script.
- \`stamp\` takes \`font\` too. DOCX needs none — Word resolves font names on the
  machine that opens the file.

# Filling a PDF form

Read the form before you fill it. Field names are whatever the form's author
typed — \`topmostSubform[0].Page1[0].f1_04[0]\` is a real one — and they are not
the labels printed next to the boxes.

\`\`\`js
import { pdf } from 'env:documents';

export default async function main() {
  const form = await pdf.readForm('/inbox/application.pdf');
  if (form.note) return { blocked: form.note };      // no fields, or an XFA form
  // form.fields → [{ name, type, value, options?, readOnly, required }]

  return pdf.fillForm('/inbox/application.pdf', {
    'applicant.name': 'Ada Lovelace',                // text
    'applicant.agree': true,                         // checkbox
    'applicant.plan': 'Pro',                         // one of its options
  }, { output: '/out/application.pdf', flatten: true });
}
\`\`\`

- An unknown field name is an **error** that lists the real names — never a
  silent no-op, because a nearly-right name is the way form filling fails.
- A value of the wrong kind is refused, and a choice outside \`options\` is
  refused with the options listed.
- \`flatten: true\` bakes the answers into the page so they cannot be edited.
- Non-Latin values need \`{ font }\`, exactly as \`create\` does.
- An **XFA** form is refused by default: its AcroForm layer is a shadow Acrobat
  ignores, so filling it produces a file that looks filled here and blank
  there. \`{ allowXfa: true }\` overrides once you have checked.
`,
};

export const DOCUMENTS_SKILLS: Skill[] = [QUICK, STYLING, EDITING, INTERNATIONAL];
