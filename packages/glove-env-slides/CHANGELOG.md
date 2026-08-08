# glove-env-slides

## 1.0.0

### Minor Changes

- [#66](https://github.com/porkytheblack/glove/pull/66) [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Scripts can use a wrapped library's real API, not a spec invented for it.

  ```js
  import { PptxGenJS } from "env:slides";

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const slide = pptx.addSlide();
  slide.addText("Revenue", { x: 0.5, y: 0.4, fontSize: 32, bold: true });
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.1, w: 1.4, h: 0.07 });
  slide.addTable(rows, { x: 0.5, y: 1.4, align: pptx.AlignH.left });
  await pptx.writeFile({ fileName: "/out/deck.pptx" });
  ```

  That is pptxgenjs, verbatim from its own documentation. Models have read thousands of examples of exactly this, so an API that differs makes them translate — and translation is where they burn turns. The analyst-desk eval caught it directly: a model reached for `import { slides } from 'env:slides'` because the real library has a class, not a bag of verbs.

  **How it works.** A live object cannot cross a thread boundary, so nothing does. The worker records `new`/call/set into a flat op list — synchronously, so the API chains exactly like the real one — and the whole list crosses once, on the terminal call. One round trip per document rather than one per call, and no `Atomics` shim.

  The recorder is built _inside_ the vm context, alongside the capability closures. It has to be: every value crossing that boundary is deep-copied, and a Proxy whose behaviour lives entirely in traps has no own keys, so a copy of one is `{}`.

  **`defineBuilder` for adapter authors**, with three things that are not optional:

  - **The allowlist is read off the library** (`methodsOf`), not typed out. A hand-written list is wrong the day the dependency adds a method, and wrong invisibly — the symptom is a model writing correct code from the real docs and being told the method does not exist.
  - **Prototype members are refused.** Replaying a script-chosen name against a live host object would make `constructor` callable, and `constructor.constructor` is the classic route to the host realm.
  - **A `rewrite` hook for path arguments.** This closed a real hole found while testing something else: `addImage({ path })` made pptxgenjs open the file _itself_, off the host filesystem, so a script could name any host file the process could read and have its bytes embedded in a deck it then exports. Paths are now resolved through the guarded VFS handle and passed on as inline bytes. Any wrapped library that takes a filename has the same hole — the hook is how an adapter closes it.

  Errors name the call that caused them (`call [#7](https://github.com/porkytheblack/glove/issues/7) addText(): …`), because the document is assembled at write time and a bare flush failure says nothing about which line was wrong. Resolving paths at replay also moves a missing-file failure onto the `addImage()` that named it rather than the `writeFile()` that tripped over it later.

  The curated `create(spec, path)` is unchanged and still the shorter path for "just make me a deck". It is simply no longer the only one.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New adapter: `glove-env-slides` — build PowerPoint decks and read them back.

  A deck is the one artifact an agent is routinely asked to _produce_ rather than consume, and the environment had no way to make one: `env:documents` writes PDF and DOCX, which are the wrong shape for something meant to be presented.

  ```js
  import { create } from "env:slides";

  await create(
    {
      title: "Q3 Review",
      footer: "Confidential",
      slides: [
        {
          title: "Headline",
          metric: { value: "$4.2M", caption: "revenue, up 12% QoQ" },
        },
        {
          title: "By region",
          table: [
            ["Region", "Revenue"],
            ["EMEA", "$1.8M"],
          ],
        },
        {
          title: "Risks",
          bullets: ["Covenant headroom is thin"],
          notes: "Expect a question here.",
        },
      ],
    },
    "/out/q3.pptx"
  );
  ```

  `describe()` returns the outline — slide count and every title — for a few dozen tokens, because no deck is small enough to read blind. `extract()` returns each slide's text and speaker notes, and `outline()` flattens the deck to markdown you can write to a file and `grep`, which costs a fraction of pulling thirty slides through the response cap.

  **Writing goes through pptxgenjs; reading does not.** Verifying a writer with its own library proves only that it is self-consistent — a title written into the wrong placeholder round-trips perfectly through the library that made the mistake. Reading goes through this package's own ZIP + OOXML reader, which is also the only way to open a deck the environment did not write, and that is most of the review work an agent is actually asked to do. One test skips both readers and runs the system `unzip` to CRC-check the archive and assert every OOXML part the spec requires is present, so a deck only our own code can open still fails.

  Two things that reader gets right and a naive one does not, both found by the tests rather than by reasoning:

  - **Runs are joined within a paragraph.** PowerPoint splits one visual line into several `<a:t>` runs wherever formatting changes, so "Revenue **grew** 12%" is three runs and a naive reader reports three bullets where there is one.
  - **Footers live on the slide master.** Stamped into each slide's own XML, a footer comes back as a body line on every slide — thirty copies of "Confidential" in a thirty-slide deck, inherited by any summary built from the text. Chrome is not content.

  Claims `.pptx` by extension only, deliberately: a pptx is a ZIP and so are `.docx` and `.xlsx`, so claiming the `PK` signature would steal every Office file from the adapter that owns it. `describe()` verifies by looking for `ppt/slides/` inside.

  Also in `glove-working-environment`: the heap-ceiling warning is now reported once per process rather than once per environment. The condition it describes is a property of the process — one flag affecting every worker it will ever start — so a host creating an environment per conversation, or a test suite creating thirty, was getting the same unchanging sentence repeated until it read as log noise. A host that passes its own `execution.onWarning` still gets every occurrence, since that is the caller asking to be told.

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
