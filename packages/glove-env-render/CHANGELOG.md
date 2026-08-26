# glove-env-render

## 1.0.0

### Minor Changes

- [#152](https://github.com/porkytheblack/glove/pull/152) [`e696111`](https://github.com/porkytheblack/glove/commit/e6961110574c9ff2117fa47d9f1c36ef9e4c85dc) Thanks [@porkytheblack](https://github.com/porkytheblack)! - A legacy attachment stops being a dead end

  Two lists inside `env:render` had drifted apart, and one of them was the one dispatch reads.

  `classify()` accepts the legacy `.doc`, `.xls`, `.ppt` and `.rtf` — LibreOffice opens all four — plus `.avif`. `renders.extensions`, which is what `view_image` and the handler registry consult, declared none of them. So the same adapter gave opposite answers about the same file:

  ```
  render('/inbox/old.doc', '/tmp/out')   → runs, reaches LibreOffice
  view_image('/inbox/old.doc', '…')      → "none of env:render claims this format"
  ```

  Nothing failed loudly, which is why it lasted. The declaration now matches what `classify` accepts, and a test pins the two together rather than trusting them to stay in step.

  **`describe` names the way out.** An unclaimed file reported _"no registered module claims this file"_ and stopped there, even when a registered renderer could turn it into something readable — the exact case being a legacy `.doc` off an email, which nothing parses and LibreOffice opens fine. The note now names the renderer, `render`, `view_image` and `env:ocr` as the path from bytes to text. A file with no renderer gets no such advice, because advice on every file is advice nobody reads.

  **A `.rtf` says its preview is markup.** RTF is text, so it fell through to the generic summary and `preview` came back as control words — which reads like content, and a caller quoting it would quote `{\rtf1\ansi …}` at a user as if it were the document.

  **A claimed file that could not be read no longer contradicts itself.** `describe` reported `module: env:images` and a `moduleError` beside a note reading "no registered module claims this file". Those call for opposite next steps. The note now says which module claimed it and points at `moduleError`, which for a truncated download or a mislabelled extension is usually the actual answer.

- [#76](https://github.com/porkytheblack/glove/pull/76) [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Look at the work, not just its text: `view_image` and `env:render`

  Every verification route in this environment read text back, which finds a wrong number and misses everything about how a document LOOKS — a table running off the page, a chart with no bars, a title overlapping its subtitle, a final slide that came out blank. Those are the defects a person notices in the first second, and the eval measured the gap: 92% of runs produced a deliverable, 54% were fully correct.

  **`glove-env-render`** rasterizes to PNG inside the VFS. PDFs and images go through `pdfjs-dist` on `@napi-rs/canvas` with no system dependency; `.pptx`/`.docx`/`.xlsx` go through headless LibreOffice, and the adapter detects the specific case where `libreoffice-core` is installed without its import filters — which fails every conversion while exiting 0 — and names the package to install. Format is decided by magic bytes then extension, so a PDF named `.pptx` never reaches LibreOffice. Renders are capped at 1600px on the long edge, because a vision model charges by pixels and reads an A4 page perfectly well at that size.

  **`view_image`** is a new verb in `glove-working-environment`, present only when the host wires `vision`:

  ```ts
  const env = await createWorkingEnvironment({
    stdlib: [render()],
    vision: {
      async describe({ bytes, mediaType, prompt }) {
        /* your provider */
      },
    },
  });
  ```

  One function, deliberately — not a model adapter — so the package stays free of a `glove-core` dependency. Without it the verb is absent from the tool set entirely: an agent is never shown a capability that would fail on use.

  It takes a path and a **question**, and rasterizes documents on the way, so checking a PDF is one call rather than render-then-look. An empty prompt is refused with an example, because "describe this image" costs the same as a real question and answers far less. Adapters can now declare `renders` alongside `handles`, kept in a separate registry so registering a renderer cannot steal `describe` dispatch from the module that understands the format.

  Verified end to end against a real vision model on a report carrying two deliberate defects — a row pushed off the right edge and a subtitle overlapping the title. It reported both.

  **Scale.** Spawning `soffice` per file costs ~1s of process start, and no tuning removes it — every platform rendering Office documents in volume keeps LibreOffice warm behind a queue (Gotenberg, unoserver, JODConverter, Collabora). So `render({ convertOffice })` hands the conversion to whatever you already run, and `soffice` is never invoked. Without it, conversions lease from a pool of reused profiles instead of building a fresh one each time: measured at 8 conversions per arm, interleaved, medians 1019ms vs 1297ms — about 21%, with a much tighter spread (986–1183 against 1089–2016).

  **One call, any page.** `view_image` takes `page` (1-based, default 1) and pushes it down to the renderer, so checking slide 3 of a deck needs no render step and no script. Driven live through `examples/document-desk`, an agent asked to "verify it looks right" called `view_image` seven times across pages 1, 2 and 5 — and the vision model caught a duplicated heading ("repeated twice with the same text, one larger and one slightly smaller"), which the agent then fixed and re-checked.

  The environment preamble now mentions the verb, but **only when a vision model is wired** — priming a model to reach for a tool that is not in its list buys a wasted call and a confusing failure. `examples/document-desk` wires both `env:render` and an OpenAI-compatible vision endpoint, and omits the verb when no key is present.

  **A deck is verifiable with nothing installed.** `.pptx` no longer fails when LibreOffice is absent — it is drawn from its own OOXML geometry as a **layout schematic**: every shape's real frame and real text, to scale, with no theme, fonts, charts or master-slide inheritance. The result carries `approximate: true` and the image is captioned as a schematic, so nothing downstream can mistake it for a render. It catches the positional defects, which is most of what goes wrong: a box off the slide (drawn outside the white area in red), text overflowing its box, a slide with nothing on it.

  Two details in it exist because a vision model got them wrong first. Drawing "(this slide is empty)" onto an empty slide made the model answer _"yes, this slide has content"_ — it read the notice as content, so the fact moved to the caption and the slide is left genuinely blank. And the caption now says "thin rectangles are shape frames, not visible borders", because without that a model read a frame as a clipping boundary and reported a title cut off that was not. With both, asked to list the text and flag anything outside the slide, it named the on-slide text correctly and flagged only the genuinely off-slide box. `schematicFallback: false` restores the LibreOffice error.

### Patch Changes

- [#131](https://github.com/porkytheblack/glove/pull/131) [`416d1dd`](https://github.com/porkytheblack/glove/commit/416d1ddb992e6b82119f9eef78c8af7dfe96014e) Thanks [@claude](https://github.com/apps/claude)! - Adapters accept a range of hub versions instead of pinning one exactly

  Every `glove-env-*` declared its `glove-working-environment` peer as `workspace:*`, which pnpm rewrites to an **exact** version at publish time. The published packages had already diverged because of it — `glove-env-documents@0.1.0` required exactly `0.1.0` while `glove-env-motion@0.1.0` required exactly `0.2.0`, so installing both from npm was unsatisfiable, and every future hub release orphaned every adapter already out there.

  The peer is now `workspace:^`, which publishes as a caret range (`^0.2.0`). Verified against a real `pnpm pack` tarball rather than assumed from the source manifest.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`a363ba1`](https://github.com/porkytheblack/glove/commit/a363ba1f37b392d1e679f2b97e5bcba7eac73913) Thanks [@claude](https://github.com/apps/claude)! - New adapter: `glove-env-ocr` — a scanned PDF or a photo of a document becomes text, offline.

  The environment could get _close_ to a scan and no further. `documents.extractText` reports `kind: "scanned"` and stops, correctly — there is no text layer to read. `env:render` rasterises the pages, correctly — that is what it is for. A vision model can then **look** at the page. But the agent still could not grep it, quote it, check a figure against a spreadsheet, or put a number from it in a report. A user uploading a scanned contract and asking for the total had no path at all.

  `recognize(path, { pages, lang, scale })` returns the text plus **per-page confidence**; `describe(path)` says whether OCR is even needed and which PDF pages already carry a text layer; `languages()` reports what this host can actually run.

  **Offline is the design, not a nice-to-have.** The stock `tesseract.js` setup downloads `<lang>.traineddata` from a CDN on first use — in a sandboxed runtime with no egress that is not a slow path but a broken one, and it breaks at recognise time on a real document rather than at startup. Both halves are ordinary bundled dependencies read off disk: the WASM core from `tesseract.js-core`, and English training data from `@tesseract.js-data/eng` handed to the worker as a local `langPath`, with `cacheMethod: "none"` so nothing is written into the host's working directory either. Measured with `fetch` and `node:http`/`node:https` disabled in the process: worker ready in 369ms, a page read in 159ms, confidence 96, text exact. Another language works if its data package is installed and otherwise fails **naming the package** — it never silently falls back to a download. A host with its own tessdata passes `ocr({ langPath })`.

  **One rasterizer, not two.** PDF pages go through `glove-env-render/raster`, the same pdfjs + canvas path `env:render` uses for `view_image`. The first question anyone asks about an OCR result is whether it matches what they saw, and two rasterizers with independent scale handling make that unanswerable. A test reads one page both ways and requires identical text. The one difference is the pixel cap — 1600px in `env:render` because a vision model charges by pixel, 3000px here because Tesseract wants roughly 300 dpi.

  **OCR text looks exactly like real text until a digit is wrong**, so every way the result can mislead is said out loud in `note`: mean confidence under 65, a page that produced nothing, a page that already had a text layer (OCR of a born-digital page is a downgrade, and the note points back at `documents.extractText`), and pages dropped at the per-call budget. Confidence is Tesseract's own mean word score, reported per page as well as overall.

  Not registered under `handles`: `env:documents` describes a PDF better than this adapter can and `env:images` owns PNGs, so claiming those extensions would steal `describe` dispatch to say something narrower — the same reasoning `env:render` documents.

  Alongside it, `glove-env-render` gains a `./raster` subpath export (`rasterizePdf`, `rasterizeImage`, `officeToPdf`) so the rasterizer can be reused rather than reimplemented. No behaviour change to `env:render` itself.

- [#144](https://github.com/porkytheblack/glove/pull/144) [`331f612`](https://github.com/porkytheblack/glove/commit/331f612ff352590d6716ce0ae0b0774148d865a6) Thanks [@claude](https://github.com/apps/claude)! - Glovebox can run a working environment.

  `glovebox build` inlined everything except `better-sqlite3`, so an agent that
  mounted `glove-working-environment` built fine and died at its first
  `run_script`: the hub opens its script worker by URL, and a bundled
  `import.meta.url` points at the bundle. `env:motion` and `env:render` failed
  the same way — both resolve their own package directory at run time.

  The build now splits externals two ways. The env family (`glove-working-environment`,
  `glove-env-*`) is **vendored** into `dist/server/vendor/` at the exact build
  it was compiled against and copied into `node_modules` _after_ `npm install`,
  because npm prunes what it did not put there. Packages with a platform binary
  (sharp, `@napi-rs/canvas`, esbuild, playwright-core, the ffmpeg installers)
  are **declared** in the emitted `package.json` so the container installs the
  binary for its own platform.

  Three fixes this needed along the way:

  - **`glovebox build` could not load a multi-file wrap module.** It plain
    `import()`ed the entry, so a TypeScript wrap module importing `./agent`
    failed with `ERR_MODULE_NOT_FOUND` naming a file that is plainly there —
    including in `examples/glovebox-pdf-extractor`, which ships in this repo.
    It now registers tsx for a TypeScript entry, so the graph loads file by
    file with ordinary resolution.
  - **Package resolution missed ESM-only packages.** It resolved through
    `createRequire`, which answers under the `require` condition; an exports map
    with no `require` branch returns `ERR_PACKAGE_PATH_NOT_EXPORTED`. Of the
    four env packages in the new example, exactly one resolved — the rest,
    `glove-working-environment` included, were silently left out of the image.
    Resolution now walks `node_modules` for the directory, which is all it ever
    needed.
  - **Node builtins were treated as npm packages.** `fs`, `path` and `crypto`
    were reported to the user as missing installs, while `buffer`, `events` and
    `https` resolved to userland shims that happened to be installed and got
    written into the server's `package.json` — making the image install
    polyfills that shadow the real builtins.

  `env:render` also gained a runtime preflight: pdf.js v5+ needs
  `ArrayBuffer.prototype.transferToFixedLength` (Node 21+), and without it
  swallows the error per operator and returns a **blank page** while every layer
  above reports success. It now refuses with a message naming the cause.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`84dc7cd`](https://github.com/porkytheblack/glove/commit/84dc7cdbb24c38b78d10a62d6538582759e99234) Thanks [@claude](https://github.com/apps/claude)! - Close two ways out of the sandbox, and stop three readers inflating without a bound

  **A script could put any host file it could name into a deliverable.** `new Workbook().addImage({ filename: '/etc/…' })` and, on a deck, `addMedia({ path })` or `background: { path }` are all resolved by the library itself — exceljs and pptxgenjs each open the path off the _real_ filesystem at write time, not off the agent's tree. Nothing failed, nothing was logged: the workbook or deck was written, `present`ed, and the file's bytes went out with it. `addImage` on slides was already routed through the guarded VFS handle for exactly this reason; the other three were not. They are now, and a path the tree does not have fails on the call that named it rather than on the write. A slide's background is _assigned_ rather than called, which argument rewriting structurally cannot see, so that one is resolved at write time instead — the same defence one step later, at the point the library would otherwise reach for the disk.

  **A 200 KB upload could take the process down.** The documents, slides and render OOXML readers called `inflateRawSync` with no `maxOutputLength`, so a crafted `.docx` or `.pptx` inflated unbounded on the host heap during an ordinary `describe` or `extractText` — outside VFS accounting, in a process that may be serving other agents. The declared uncompressed size is no help, because it comes out of the same hostile file; the bound has to be on the inflate's output, which is what the archives adapter has always done. All three now cap inflation at the environment's `maxVfsBytes` (the live value where the reader is given a VFS handle, the default where it is handed bytes alone) and refuse the entry by name when it is exceeded.

  **An encrypted Office file was read as a broken one.** Inflating ciphertext yields garbage rather than an error, so a password-protected `.docx` came back as "not a Word document" and a protected `.pptx` as "no ppt/slides/" — both true, neither actionable. The ZIP encryption flag is now checked and named, so the answer is the password rather than the file.

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fe2fd69`](https://github.com/porkytheblack/glove/commit/fe2fd6907dcaaea277859bb8ed4a06ddea3c459b), [`104478e`](https://github.com/porkytheblack/glove/commit/104478eb35b0fc2f43396b2b04afcc181fb81900), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`4774ff3`](https://github.com/porkytheblack/glove/commit/4774ff3573167e5779e09e0d17238398546caaf5), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`4099b67`](https://github.com/porkytheblack/glove/commit/4099b671ca1ca9489cb12934859ea5d7c002e24d), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182), [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`37d84f6`](https://github.com/porkytheblack/glove/commit/37d84f6289689e333a3cce4f5d9c8530c8640eb1), [`2d3e974`](https://github.com/porkytheblack/glove/commit/2d3e9741254c00d3561a32118a34d59fd97dfa10), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`e696111`](https://github.com/porkytheblack/glove/commit/e6961110574c9ff2117fa47d9f1c36ef9e4c85dc), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`701f4d9`](https://github.com/porkytheblack/glove/commit/701f4d9a7cd37aef314d0521793bd960cf985fe8), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad), [`d72834d`](https://github.com/porkytheblack/glove/commit/d72834d8819d37b95c16809bf7e0e646073f6948), [`8df9ee3`](https://github.com/porkytheblack/glove/commit/8df9ee3ef41bd2f1b7c1234ef379ef0704d5a765), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860), [`78ffe34`](https://github.com/porkytheblack/glove/commit/78ffe34bd8ccb304239a65f931635053b93d4e50)]:
  - glove-working-environment@0.6.0
