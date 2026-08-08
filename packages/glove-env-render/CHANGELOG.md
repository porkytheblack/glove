# glove-env-render

## 1.0.0

### Minor Changes

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

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860)]:
  - glove-working-environment@0.2.0
