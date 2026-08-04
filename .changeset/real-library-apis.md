---
"glove-working-environment": minor
"glove-env-spreadsheets": minor
"glove-env-documents": minor
"glove-env-slides": patch
---

The wrapped libraries are now reachable in full — exceljs and docx as well as pptxgenjs — and the recording protocol grew what those two needed.

```js
import { Workbook } from 'env:spreadsheets';

const wb = new Workbook();
const ws = wb.addWorksheet('Revenue');
ws.columns = [{ header: 'Region', key: 'region', width: 24 }, { header: 'Revenue', key: 'revenue', width: 18 }];
ws.addRows(rows);
ws.getRow(1).font = { bold: true };
ws.getColumn('revenue').numFmt = '#,##0';
ws.views = [{ state: 'frozen', ySplit: 1 }];
await wb.xlsx.writeFile('/out/revenue.xlsx');
```

```js
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'env:documents';
import { writeFile } from 'env:fs';

const doc = new Document({
  sections: [{ children: [
    new Paragraph({ text: 'Q3 Review', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [
      new TextRun({ text: 'Revenue rose ' }),
      new TextRun({ text: '18%', bold: true, color: 'C00000' }),
    ] }),
  ] }],
});
await writeFile('/out/review.docx', await Packer.toBuffer(doc));
```

Both are the libraries' own code, unchanged from their documentation. The curated `write(path, rows)` and `docx.create(path, spec)` stay and are still the shorter path; they were simply the only path, and everything they did not name — a bold header, a number format, a merged title, a coloured run, a bordered table, a landscape section — was unreachable.

**Three additions to the recording protocol**, each one a library making a demand:

- **Property reads.** `workbook.xlsx.writeFile(...)` is a read followed by a call, and at `wb.xlsx` the recorder cannot yet know which it is — `ws.addRow(...)` is a call at exactly the same syntactic position. A property now records lazily: calling it records a call, reading through it records the access first.
- **Constructed values as arguments.** `new Document({ children: [new Paragraph(...)] })` needs the paragraph to be nameable inside the document's arguments. This was also a latent correctness bug: a recorder node passed as an argument deep-copied to `{}` on its way to the host, so the argument silently vanished. Nodes are now substituted as refs and resolved at replay, at any depth inside objects and arrays.
- **Builder families.** `docx` has no root object to call methods on — a document is *assembled* out of constructed values and written with a static, `Packer.toBuffer(doc)`. Constructors declared in one family record into one op list, so a value built by one can be handed to another, and `Packer` is a member used without `new`.

`defineBuilders` is the general form; `defineBuilder` is now the single-constructor case of it. `methodsOf` reads descriptors instead of invoking getters — building an allowlist by reading every property runs library code for its side effects, which is how exceljs's deprecated `tabColor` came to print a stack trace on every adapter construction.

**Adapters can ship skills.** `StdlibAdapter.skills` was declared and unused; `defineAdapter` now accepts it, and slides, documents and spreadsheets each ship two — one for the one-call path, one for the library. `/std/<name>/index.d.ts` says what a module exports; a skill says how to get a deliverable out of it, and the measured failure was never a misused signature.
