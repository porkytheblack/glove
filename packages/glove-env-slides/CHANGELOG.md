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

- [#131](https://github.com/porkytheblack/glove/pull/131) [`2e2810c`](https://github.com/porkytheblack/glove/commit/2e2810c9fd9f6d3bf0a14742e1c52d0678eb540e) Thanks [@claude](https://github.com/apps/claude)! - "Change the client name in this contract" rebuilt the contract instead of changing it

  Both of the make-a-document adapters were regenerate-only, and the way they failed was quiet. `docx` is a write-only library and pptxgenjs cannot open a deck, so the only route to an edit was to extract the text and render a new file from it — which rebuilds the document out of the small vocabulary our own spec can express, and drops everything else on the floor while reporting success.

  Measured, not assumed. A contract with a header, a bold red client name and a logo went through that cycle and came back missing `word/header1.xml`, its relationships and `word/media/*.png`, with the client name returned as plain text. A deck with a chart and a footer lost `ppt/media/image-3-1.png` and the footer's slide layout. Neither loss shows up in a text round-trip, which is exactly why it was worth fixing.

  **`docx.replaceText(path, replacements, options?)` and `slides.replaceText(path, replacements, options?)` edit the package instead.** The one part carrying the matched text is inflated, spliced and re-deflated; every other entry is copied across _still compressed_, with its recorded CRC and method. That is the guarantee, and it is a property of the bytes rather than of a model of the document: code that never decoded `word/styles.xml` cannot change it. The DOCX edit rewrote 2 of 28 parts and left 26 byte-identical; the slide edit rewrote 1 of 50 and left 49. The tests hash every part before and after and assert on the exact set that moved.

  The interesting half is the splicing. Neither format stores "Northwind Traders" anywhere — Word and PowerPoint start a new run wherever anything changes, including a spell-check marker or a revision id, so a name a person reads as one word is routinely two or three `<w:t>` elements and a per-element replace finds nothing. Runs are therefore reassembled per paragraph, matched there, and written back onto the runs they came from: the replacement goes wholly into the run where the match _started_, so a bold client name stays bold and a red one stays red, and the runs around it are re-emitted unchanged.

  Three decisions worth naming, because each has a wrong answer that produces a plausible file:

  - **Paragraphs are found with a stack, not a regex.** They nest — a text box lives inside a run and carries paragraphs of its own, and so does a table cell. A non-greedy `<w:p>…</w:p>` ends the outer paragraph at the inner `</w:p>`, which would splice the opening of one sentence onto the text of an unrelated box and could match a phrase that is nowhere in the document.
  - **Rules are applied in one pass.** `{ Acme: 'Globex', Globex: 'Initech' }` run in sequence carries the original Acme all the way to Initech. One pass with first-rule-wins makes the outcome a function of the rules rather than of their execution order.
  - **A search that matches nothing throws.** Writing a byte-identical file and returning success is the failure that costs a run: the model believes the rename happened. When several rules are given and only some hit, `unmatched` names the misses.

  Scope is text, and it says so. `slides.replaceText` takes `{ slides: 4 }` or `{ slides: [2, 4] }`, numbered exactly as `describe` and `extract` number them, and leaves speaker notes alone unless asked. `docx.replaceText` edits headers, footers, footnotes and endnotes by default — a client name is usually in a header too — with `{ parts: 'body' }` to narrow it. Matching is literal, case-sensitive, and never crosses a paragraph boundary, because two paragraphs are two lines on the page and joining them would let a replacement swallow the break.

  Both edit paths read through the same guarded VFS handle and the same inflation cap as the readers, with tests that point a zip bomb and an encrypted archive at `replaceText` specifically. A new read path is exactly where a closed hole gets reopened, and nothing about a find/replace looks like a place to check for a decompression bomb.

  One correctness fix fell out of the work: **a slide's speaker notes are now resolved through the slide's relationships rather than by matching numbers.** `slide7.xml` ↔ `notesSlide7.xml` holds for decks this package writes and for very little else — PowerPoint numbers notes parts in creation order, so a deck where slide 2 got notes first has `notesSlide1.xml` hanging off slide 2. Reading and editing consult the same resolver, so an edit scoped to a slide cannot land on a different slide's notes.

  36 tests added across the two packages.

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

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fe2fd69`](https://github.com/porkytheblack/glove/commit/fe2fd6907dcaaea277859bb8ed4a06ddea3c459b), [`104478e`](https://github.com/porkytheblack/glove/commit/104478eb35b0fc2f43396b2b04afcc181fb81900), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`4774ff3`](https://github.com/porkytheblack/glove/commit/4774ff3573167e5779e09e0d17238398546caaf5), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`4099b67`](https://github.com/porkytheblack/glove/commit/4099b671ca1ca9489cb12934859ea5d7c002e24d), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182), [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`37d84f6`](https://github.com/porkytheblack/glove/commit/37d84f6289689e333a3cce4f5d9c8530c8640eb1), [`2d3e974`](https://github.com/porkytheblack/glove/commit/2d3e9741254c00d3561a32118a34d59fd97dfa10), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`701f4d9`](https://github.com/porkytheblack/glove/commit/701f4d9a7cd37aef314d0521793bd960cf985fe8), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad), [`d72834d`](https://github.com/porkytheblack/glove/commit/d72834d8819d37b95c16809bf7e0e646073f6948), [`8df9ee3`](https://github.com/porkytheblack/glove/commit/8df9ee3ef41bd2f1b7c1234ef379ef0704d5a765), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860), [`78ffe34`](https://github.com/porkytheblack/glove/commit/78ffe34bd8ccb304239a65f931635053b93d4e50)]:
  - glove-working-environment@0.6.0
