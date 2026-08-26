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

- [#131](https://github.com/porkytheblack/glove/pull/131) [`416d1dd`](https://github.com/porkytheblack/glove/commit/416d1ddb992e6b82119f9eef78c8af7dfe96014e) Thanks [@claude](https://github.com/apps/claude)! - Adapters accept a range of hub versions instead of pinning one exactly

  Every `glove-env-*` declared its `glove-working-environment` peer as `workspace:*`, which pnpm rewrites to an **exact** version at publish time. The published packages had already diverged because of it — `glove-env-documents@0.1.0` required exactly `0.1.0` while `glove-env-motion@0.1.0` required exactly `0.2.0`, so installing both from npm was unsatisfiable, and every future hub release orphaned every adapter already out there.

  The peer is now `workspace:^`, which publishes as a caret range (`^0.2.0`). Verified against a real `pnpm pack` tarball rather than assumed from the source manifest.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`84dc7cd`](https://github.com/porkytheblack/glove/commit/84dc7cdbb24c38b78d10a62d6538582759e99234) Thanks [@claude](https://github.com/apps/claude)! - Close two ways out of the sandbox, and stop three readers inflating without a bound

  **A script could put any host file it could name into a deliverable.** `new Workbook().addImage({ filename: '/etc/…' })` and, on a deck, `addMedia({ path })` or `background: { path }` are all resolved by the library itself — exceljs and pptxgenjs each open the path off the _real_ filesystem at write time, not off the agent's tree. Nothing failed, nothing was logged: the workbook or deck was written, `present`ed, and the file's bytes went out with it. `addImage` on slides was already routed through the guarded VFS handle for exactly this reason; the other three were not. They are now, and a path the tree does not have fails on the call that named it rather than on the write. A slide's background is _assigned_ rather than called, which argument rewriting structurally cannot see, so that one is resolved at write time instead — the same defence one step later, at the point the library would otherwise reach for the disk.

  **A 200 KB upload could take the process down.** The documents, slides and render OOXML readers called `inflateRawSync` with no `maxOutputLength`, so a crafted `.docx` or `.pptx` inflated unbounded on the host heap during an ordinary `describe` or `extractText` — outside VFS accounting, in a process that may be serving other agents. The declared uncompressed size is no help, because it comes out of the same hostile file; the bound has to be on the inflate's output, which is what the archives adapter has always done. All three now cap inflation at the environment's `maxVfsBytes` (the live value where the reader is given a VFS handle, the default where it is handed bytes alone) and refuse the entry by name when it is exceeded.

  **An encrypted Office file was read as a broken one.** Inflating ciphertext yields garbage rather than an error, so a password-protected `.docx` came back as "not a Word document" and a protected `.pptx` as "no ppt/slides/" — both true, neither actionable. The ZIP encryption flag is now checked and named, so the answer is the password rather than the file.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`9eac7d5`](https://github.com/porkytheblack/glove/commit/9eac7d58c6c9a8361d553371d3b7f1e104078f33) Thanks [@claude](https://github.com/apps/claude)! - Page a big sheet in linear time instead of quadratic.

  The docs tell a model to walk a large sheet with `read({ offset, limit })`. Every one of those calls re-read the file and rebuilt the whole workbook, so the loop the docs recommend cost O(rows² / limit): page 20 did exactly as much work as page 1, and doubling the sheet quadrupled the loop. Measured before, paging 5000 rows at a time (`pnpm --filter glove-env-spreadsheets bench`):

  ```
    25000 rows   5 pages   6.2s total   mean page 1.24s
    50000 rows  10 pages  20.3s total   mean page 2.06s
   100000 rows  20 pages  93.6s total   mean page 4.64s
  ```

  4× the rows cost 15.2× the time, against 16× for a perfect quadratic. After:

  ```
    25000 rows   5 pages   0.73s total   page 1 702ms, every page after it 6ms
    50000 rows  10 pages   1.22s total   page 1 1160ms, every page after it 7ms
   100000 rows  20 pages   2.24s total   page 1 2096ms, every page after it 8ms
  ```

  4× the rows now costs 3.1× the time, and the 100k-row loop is **41.8× faster**. Pages after the first cost 0.4% of the first, which is the shape the issue asked for: one parse, then slices.

  Two changes get there, and both are needed. exceljs's streaming `WorkbookReader` replaces `wb.xlsx.load` for anything large — on the 100k-row file that alone is 2.7s and 32 MB against 4.4s and **291 MB**, because the loader keeps a live cell object per cell and the reader hands back one row at a time. And the flattened sheet is kept, so a paged loop parses once instead of once per page.

  Streaming is not free below a certain size: every xlsx written by exceljs or Excel puts `sharedStrings.xml` after the sheets, and the streaming reader answers that by spooling each sheet through a temp file, a fixed ~5ms a workbook that a four-row sheet notices. The two were measured across sizes and cross at about 35 KB, so under 32 KB the full loader is still used. That is also the more faithful of the two readers, which matters for the one thing streaming genuinely loses: a shared-formula follower cell (`<f t="shared" si="0"/>`) carries no formula text at all, where the loader reports its anchor. Values are identical either way; `read({ formulas: true })` on a sheet that uses shared formulas re-reads with the loader so the reported formula text stays exact. Nothing else about the output moved — flattened formulas, stringified rich text, ISO dates, preserved error cells, column-letter fills for blank headers and `_2` suffixes for duplicates are all pinned, and the date case is now pinned against _both_ readers because it is the one that actually diverges (a date is a number plus a number-format, and the streaming reader needs the style table to tell them apart).

  The parsed sheets are held per environment, never per process — a cache keyed by path and shared across environments would hand one tenant's rows to another the moment two agents used the same filename, and there is a test that would fail if that changed. Every write through the adapter drops what it holds for that path, and entries carry a `size:mtime` fingerprint besides, so a read after a write always sees the new file. The budget is `cacheCells` (default 1,000,000, about 55 MB — less than one `xlsx.load` of the file in the benchmark used to allocate transiently); a workbook bigger than the whole budget is simply not held rather than evicting everything to fit.

  The new reader takes bytes, never a path. `WorkbookReader` accepts a filename and would open it off the host filesystem; the only caller reads through the guarded VFS handle.

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fe2fd69`](https://github.com/porkytheblack/glove/commit/fe2fd6907dcaaea277859bb8ed4a06ddea3c459b), [`104478e`](https://github.com/porkytheblack/glove/commit/104478eb35b0fc2f43396b2b04afcc181fb81900), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`4774ff3`](https://github.com/porkytheblack/glove/commit/4774ff3573167e5779e09e0d17238398546caaf5), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`4099b67`](https://github.com/porkytheblack/glove/commit/4099b671ca1ca9489cb12934859ea5d7c002e24d), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182), [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`37d84f6`](https://github.com/porkytheblack/glove/commit/37d84f6289689e333a3cce4f5d9c8530c8640eb1), [`2d3e974`](https://github.com/porkytheblack/glove/commit/2d3e9741254c00d3561a32118a34d59fd97dfa10), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`e696111`](https://github.com/porkytheblack/glove/commit/e6961110574c9ff2117fa47d9f1c36ef9e4c85dc), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`701f4d9`](https://github.com/porkytheblack/glove/commit/701f4d9a7cd37aef314d0521793bd960cf985fe8), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad), [`d72834d`](https://github.com/porkytheblack/glove/commit/d72834d8819d37b95c16809bf7e0e646073f6948), [`8df9ee3`](https://github.com/porkytheblack/glove/commit/8df9ee3ef41bd2f1b7c1234ef379ef0704d5a765), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860), [`78ffe34`](https://github.com/porkytheblack/glove/commit/78ffe34bd8ccb304239a65f931635053b93d4e50)]:
  - glove-working-environment@0.6.0
