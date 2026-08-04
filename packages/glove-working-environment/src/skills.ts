/**
 * `/skills` — worked recipes, read before writing code.
 *
 * `/std` is reference: what a module exports and with what signature. That is
 * the right thing to have, and it is not what a model reaching for a familiar
 * shape actually consults. The measured friction says so plainly — the most
 * frequent errors across 36 agent runs were all the same mistake:
 *
 *     no module named "csv" — but "csv" is exported by env:std          ×5
 *     module "env:documents" has no export "extractText"                ×4
 *     no such export "parseRows" on env:std.csv                         ×4
 *     module "env:documents" has no export "documents"                  ×4
 *     module "env:slides" has no export "slides"                        ×3
 *     writeFile is not defined — did you mean to import it?             ×3
 *
 * Every one is an import guessed from memory. The environment answers each
 * correctly and names the fix, and models kept guessing anyway — which is
 * issue #64's finding again: a good message helps a model that is reasoning
 * about the error, and does nothing for one that has already committed to a
 * shape. The fix for that is not a better error. It is a correct example in
 * front of them before they write the line.
 *
 * So these are task-shaped, not API-shaped, and every one of them is
 * copy-pasteable. A skill that has to be adapted is a skill that gets
 * guessed at.
 */

export interface Skill {
  /** File name under /skills, without the extension. */
  name: string;
  /** One line for the index — what task this is for. */
  summary: string;
  /** Markdown body. Lead with runnable code. */
  body: string;
}

const IMPORTS: Skill = {
  name: "imports",
  summary: "The exact import line for every module. Read this before writing any script.",
  body: `# Imports

Getting this line wrong is the single most common failure in this
environment. The rules are short:

- Every module is \`env:<name>\`. There is no \`env:env:x\`, no bare \`'fs'\`,
  no npm package.
- You import the **bindings**, not the module name. \`env:slides\` does not
  export \`slides\`; \`env:documents\` does not export \`documents\`.
- Nothing is global. \`readFile\`, \`writeFile\`, \`csv\` — all must be imported.

\`\`\`js
import { readFile, writeFile, readdir, glob, exists, mkdir, rm, mv, cp } from 'env:fs';
import { json, csv, text, bytes } from 'env:std';
import { equal, deepEqual, ok, match, throws } from 'env:assert';
\`\`\`

\`env:std\` groups its helpers, so reach through the group:

\`\`\`js
import { csv, json } from 'env:std';

const records = csv.parse(raw);      // NOT csv.parseRows, NOT a bare parse()
const rows    = csv.rows(raw);       // headerless
const out     = json.stringify(x, 2);
\`\`\`

A wrapped library's own classes are exported by their real names, so code
written against that library's documentation works as written:

\`\`\`js
import { Workbook } from 'env:spreadsheets';                    // exceljs
import { PptxGenJS } from 'env:slides';                         // pptxgenjs
import { Document, Packer, Paragraph, TextRun } from 'env:documents';   // docx
\`\`\`

Use those when the one-call verbs cannot express what you need — styling,
formats, layout. \`/skills/spreadsheets-styling.md\`,
\`/skills/slides-custom.md\` and \`/skills/documents-styling.md\` each have a
worked example.

To find what a module exports, read its types — one directory per module,
named **without** the \`env:\` prefix:

\`\`\`
read_file /std/README.md              # every module, one line each
read_file /std/documents/index.d.ts   # exact signatures for env:documents
\`\`\`

If an import is wrong, the error names the real exports. Read it and use
one of those names rather than trying another guess.
`,
};

const LARGE_DOCUMENTS: Skill = {
  name: "large-documents",
  summary: "Work with a document too big to read — extract to a file, then search it.",
  body: `# A document you cannot read

An 80-page PDF is well over 100,000 characters. A tool response is capped
at a few thousand, so there is no version of "read it and summarise" that
works. Get the text into the tree, then search it.

Three calls, about two seconds:

\`\`\`js
import { pdf } from 'env:documents';
import { writeFile } from 'env:fs';

/** Flatten a PDF to text with page markers so hits can be cited. */
export default async function main() {
  const extracted = await pdf.extractText('/inbox/report.pdf');
  const body = extracted.pages
    .map((p) => '=== page ' + p.page + ' ===\\n' + p.text)
    .join('\\n');
  await writeFile('/tmp/report.txt', body);
  return { pages: extracted.pages.length, characters: extracted.characters };
}
\`\`\`

Then search the file with \`grep\` — one tool call per question, and the
answer comes back with a line number:

\`\`\`
grep pattern="Kestrel" path="/tmp/report.txt"
grep pattern="leverage ratio" path="/tmp/report.txt"
\`\`\`

**Keep the page markers.** Writing \`extracted.text\` instead of the
per-page join loses the page boundaries, and any page number you report
afterwards is reconstructed — which is how briefings end up with every
citation off by one.

\`describe(path)\` first if you do not know what you are holding. It
returns page count and metadata without extracting anything.

The same shape works for decks (\`outline()\` from \`env:slides\`) and
spreadsheets (\`env:spreadsheets\`): flatten to a text file, then grep.
`,
};

const MESSY_DATA: Skill = {
  name: "messy-data",
  summary: "Parse a real-world CSV: quoted fields, stray whitespace, duplicate rows.",
  body: `# Messy tabular data

Real exports are not clean. Use the parser, not \`split(',')\` — a quoted
field containing a comma (\`"$2,435"\`) silently shifts every column after
it, and you get a plausible wrong number rather than an error.

\`\`\`js
import { readFile } from 'env:fs';
import { csv } from 'env:std';

export default async function main() {
  const raw = await readFile('/inbox/transactions.csv');

  // Drop comment lines before parsing; they are not records.
  const body = raw.split('\\n').filter((l) => !l.trim().startsWith('#')).join('\\n');
  const records = csv.parse(body);        // returns objects keyed by header

  const seen = new Set();
  const totals = {};
  for (const r of records) {
    const id = String(r.id ?? '').trim();
    if (!id || seen.has(id)) continue;    // a repeated id is a duplicated row
    seen.add(id);

    const region = String(r.region ?? '').trim();          // stray whitespace
    const amount = Number(String(r.amount ?? '').replace(/[$,\\s]/g, ''));
    if (!Number.isFinite(amount)) continue;

    totals[region] = (totals[region] ?? 0) + amount;
  }
  return totals;
}
\`\`\`

Worth doing every time:

- **Trim every field you group by.** \` EMEA \` and \`EMEA\` are different keys,
  and the bug shows up as a region that appears twice.
- **Strip currency symbols and separators before \`Number()\`.** \`Number('$1,200')\`
  is \`NaN\`, and \`NaN\` propagates silently through a sum.
- **Group, do not transcribe.** If the task asks for a total per region,
  compute it from every row. Copying the first few rows produces a number
  that looks reasonable and is wrong.
- **Check your work**: \`return totals\` and look at it before writing the
  final artifact.
`,
};

const PRODUCING_FILES: Skill = {
  name: "producing-files",
  summary: "Where deliverables go, and how to check what you produced.",
  body: `# Producing a deliverable

\`/out\` is what the host collects. Intermediates belong in \`/tmp\`.

\`\`\`js
import { pdf } from 'env:documents';

export default async function main() {
  return pdf.create('/out/report.pdf', {          // path FIRST, then the spec
    title: 'Q3 Revenue',
    content: [
      { heading: 'By region' },
      { table: { headers: ['Region', 'Revenue'], rows: [['EMEA', '$2,435,210']] } },
      { text: 'Largest region: EMEA' },
    ],
  });
}
\`\`\`

**Then look at what you made.** \`describe()\` on your own output is one
call and catches the failures that are invisible otherwise — a PDF with
one page when you meant three, a deck whose table ran off the slide, a
spreadsheet with an empty sheet:

\`\`\`js
import { describe } from 'env:documents';
const summary = await describe('/out/report.pdf');   // { pages: 1, title: ... }
\`\`\`

For anything with text in it, read it back and check a figure you know:

\`\`\`js
import { pdf } from 'env:documents';
const back = await pdf.extractText('/out/report.pdf');
if (!back.text.includes('2,435,210')) throw new Error('the total did not render');
\`\`\`

That check costs one call and is the difference between delivering a
report and delivering a report with the wrong number in it.
`,
};

const SCRIPTS: Skill = {
  name: "scripts",
  summary: "The script contract, and how to build a library instead of one-off code.",
  body: `# Scripts

Everything executable lives under \`/scripts\` and is run with
\`run_script\`. Every script must default-export an async function:

\`\`\`js
import { readFile } from 'env:fs';

/** One line saying what this does — it becomes the description in ls. */
export default async function main(args) {
  return readFile(args.path);
}
\`\`\`

Validation happens at **write** time, not run time, so a bad import or a
missing default export is reported when you save the file — read that
message rather than running it to see what happens.

Shared code goes in \`/scripts/lib\` and is imported by relative path:

\`\`\`js
import { loadRows } from './lib/transactions.js';    // note the .js
\`\`\`

Write the library module **before** the script that imports it; validation
resolves the import at write time.

This is the point of the environment: scripts persist. Before writing new
code, check whether you already have it —

\`\`\`
ls /scripts                 # the catalogue, with one-line descriptions
grep pattern="csv" path="/scripts"
\`\`\`

— and prefer extending a module over pasting a fourth variant of the same
parser.
`,
};

/** Skills the environment always ships, independent of registered adapters. */
export const BUILTIN_SKILLS: Skill[] = [IMPORTS, LARGE_DOCUMENTS, MESSY_DATA, PRODUCING_FILES, SCRIPTS];

/** The index a model reads first. */
export function skillsIndex(skills: Skill[]): string {
  const lines = [
    "# /skills — read this before writing code",
    "",
    "Worked, copy-pasteable recipes for the tasks this environment is for.",
    "`/std` tells you what a module exports; these tell you how to use it.",
    "",
    "**Start with `imports.md`.** Guessing an import is the most common way a",
    "run is wasted here, and it is entirely avoidable.",
    "",
    "| Skill | For |",
    "|---|---|",
  ];
  for (const s of skills) {
    lines.push(`| \`/skills/${s.name}.md\` | ${s.summary.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "This directory is read-only and regenerated on startup.");
  return lines.join("\n");
}
