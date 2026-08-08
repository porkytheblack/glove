# glove-env-spreadsheets

## 1.0.0

### Minor Changes

- [#47](https://github.com/porkytheblack/glove/pull/47) [`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Three stdlib adapter packages for `glove-working-environment`, each carrying its own heavy dependency so the core stays zero-dependency.

  `glove-env-spreadsheets` (`env:spreadsheets`, exceljs) makes `.xlsx` workbooks readable as plain JSON. exceljs returns rich objects — `{ richText: [...] }`, `{ formula, result }`, `{ error: '#DIV/0!' }`, `Date`s, hyperlink pairs — and handing those to a model spends tokens saying nothing while teaching it to write defensive unwrapping; everything is flattened at the boundary, with `read({ formulas: true })` for when the formula text is the point. `describe(path)` summarises sheets, sizes, headers and one sample row at a cost independent of file size, and `read` reports `totalRows` so `offset`/`limit` paging has an obvious loop condition. Blank headers become their column letter and duplicates get a `_2` suffix so no column is silently dropped, and `append` follows the sheet's existing header order rather than the incoming record's key order.

  `glove-env-documents` (`env:documents`, pdf-lib + docx) renders one document spec — headings, text, bullets, tables, images, page breaks — to both PDF and DOCX, wrapping and paginating on its own. `describe(path)` sniffs the format from the bytes rather than the extension. PDF text extraction is delegated to an optional `pdfjs-dist` peer and refuses cleanly when it is absent: decoding glyphs back to characters is a font/CMap problem, and a naive content-stream scan returns plausible nonsense on any subsetted font, which a model cannot tell from the real thing. DOCX extraction needs no extra dependency — a `.docx` is a ZIP of XML, read here with `node:zlib`. pdf-lib's standard fonts are WinAnsi-only and throw on an em dash, so non-Latin-1 characters are transliterated where there is an obvious equivalent rather than failing an entire render; the docs point at DOCX for full Unicode.

  `glove-env-images` (`env:images`, sharp) keeps image bytes out of the context window entirely: `describe(path)` answers what a file is without decoding pixels, `stats(path)` adds channel spread and dominant colour (enough to tell a blank scan from a real one, ignoring alpha so transparent PNGs do not read as dark), and everything else turns one path into another. The output extension picks the encoder unless `{ format }` overrides it. EXIF orientation is surfaced rather than silently applied, because cropping a sideways image without normalising first gives coordinates on the wrong axis and nothing else would say so.

  All three follow the §4.4 convention — paths in, paths out, structured data in between — expose `describe(path)`, validate arguments before reaching the underlying library so failures are sentences rather than library stack traces, and are tested from inside real scripts via `glove-working-environment/testing`.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3) Thanks [@porkytheblack](https://github.com/porkytheblack)! - The wrapped libraries are now reachable in full — exceljs and docx as well as pptxgenjs — and the recording protocol grew what those two needed.

  ```js
  import { Workbook } from "env:spreadsheets";

  const wb = new Workbook();
  const ws = wb.addWorksheet("Revenue");
  ws.columns = [
    { header: "Region", key: "region", width: 24 },
    { header: "Revenue", key: "revenue", width: 18 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.getColumn("revenue").numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile("/out/revenue.xlsx");
  ```

  ```js
  import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
  } from "env:documents";
  import { writeFile } from "env:fs";

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Q3 Review", heading: HeadingLevel.TITLE }),
          new Paragraph({
            children: [
              new TextRun({ text: "Revenue rose " }),
              new TextRun({ text: "18%", bold: true, color: "C00000" }),
            ],
          }),
        ],
      },
    ],
  });
  await writeFile("/out/review.docx", await Packer.toBuffer(doc));
  ```

  Both are the libraries' own code, unchanged from their documentation. The curated `write(path, rows)` and `docx.create(path, spec)` stay and are still the shorter path; they were simply the only path, and everything they did not name — a bold header, a number format, a merged title, a coloured run, a bordered table, a landscape section — was unreachable.

  **Three additions to the recording protocol**, each one a library making a demand:

  - **Property reads.** `workbook.xlsx.writeFile(...)` is a read followed by a call, and at `wb.xlsx` the recorder cannot yet know which it is — `ws.addRow(...)` is a call at exactly the same syntactic position. A property now records lazily: calling it records a call, reading through it records the access first.
  - **Constructed values as arguments.** `new Document({ children: [new Paragraph(...)] })` needs the paragraph to be nameable inside the document's arguments. This was also a latent correctness bug: a recorder node passed as an argument deep-copied to `{}` on its way to the host, so the argument silently vanished. Nodes are now substituted as refs and resolved at replay, at any depth inside objects and arrays.
  - **Builder families.** `docx` has no root object to call methods on — a document is _assembled_ out of constructed values and written with a static, `Packer.toBuffer(doc)`. Constructors declared in one family record into one op list, so a value built by one can be handed to another, and `Packer` is a member used without `new`.

  `defineBuilders` is the general form; `defineBuilder` is now the single-constructor case of it. `methodsOf` reads descriptors instead of invoking getters — building an allowlist by reading every property runs library code for its side effects, which is how exceljs's deprecated `tabColor` came to print a stack trace on every adapter construction.

  **Adapters can ship skills.** `StdlibAdapter.skills` was declared and unused; `defineAdapter` now accepts it, and slides, documents and spreadsheets each ship two — one for the one-call path, one for the library. `/std/<name>/index.d.ts` says what a module exports; a skill says how to get a deliverable out of it, and the measured failure was never a misused signature.

  **Two fixes found by running the eval against this, both regressions the feature itself introduced:**

  - Exporting docx's vocabulary made `env:documents` answer a wrong import with forty names, burying the verb the model was reaching for. The correction now leads with the module's own verbs in full and counts the library's classes, pointing at `/skills/imports.md` for the rest. Applied on both paths that answer a bad name.
  - Interpolating a builder into a string threw `Cannot convert object to primitive value` — a recorder had no `toString`, no `valueOf` and no `Symbol.toPrimitive`, so an ordinary debug string was fatal. Both now render as `[PptxGenJS (recording; nothing is built until you await a terminal call)]`. It is answered inside the sandbox and records nothing, so `constructor`, `valueOf` and `__defineGetter__` are still refused.

  Measured on the analyst-desk eval: the scenario that _requires_ the library path — styling unreachable through the curated `write()` — is the highest-delivering in the suite at 15/18, across three models that had never seen this API.

### Patch Changes

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860)]:
  - glove-working-environment@0.2.0
