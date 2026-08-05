---
"glove-working-environment": minor
"glove-env-render": minor
---

Look at the work, not just its text: `view_image` and `env:render`

Every verification route in this environment read text back, which finds a wrong number and misses everything about how a document LOOKS — a table running off the page, a chart with no bars, a title overlapping its subtitle, a final slide that came out blank. Those are the defects a person notices in the first second, and the eval measured the gap: 92% of runs produced a deliverable, 54% were fully correct.

**`glove-env-render`** rasterizes to PNG inside the VFS. PDFs and images go through `pdfjs-dist` on `@napi-rs/canvas` with no system dependency; `.pptx`/`.docx`/`.xlsx` go through headless LibreOffice, and the adapter detects the specific case where `libreoffice-core` is installed without its import filters — which fails every conversion while exiting 0 — and names the package to install. Format is decided by magic bytes then extension, so a PDF named `.pptx` never reaches LibreOffice. Renders are capped at 1600px on the long edge, because a vision model charges by pixels and reads an A4 page perfectly well at that size.

**`view_image`** is a new verb in `glove-working-environment`, present only when the host wires `vision`:

```ts
const env = await createWorkingEnvironment({
  stdlib: [render()],
  vision: { async describe({ bytes, mediaType, prompt }) { /* your provider */ } },
});
```

One function, deliberately — not a model adapter — so the package stays free of a `glove-core` dependency. Without it the verb is absent from the tool set entirely: an agent is never shown a capability that would fail on use.

It takes a path and a **question**, and rasterizes documents on the way, so checking a PDF is one call rather than render-then-look. An empty prompt is refused with an example, because "describe this image" costs the same as a real question and answers far less. Adapters can now declare `renders` alongside `handles`, kept in a separate registry so registering a renderer cannot steal `describe` dispatch from the module that understands the format.

Verified end to end against a real vision model on a report carrying two deliberate defects — a row pushed off the right edge and a subtitle overlapping the title. It reported both.

**Scale.** Spawning `soffice` per file costs ~1s of process start, and no tuning removes it — every platform rendering Office documents in volume keeps LibreOffice warm behind a queue (Gotenberg, unoserver, JODConverter, Collabora). So `render({ convertOffice })` hands the conversion to whatever you already run, and `soffice` is never invoked. Without it, conversions lease from a pool of reused profiles instead of building a fresh one each time: measured at 8 conversions per arm, interleaved, medians 1019ms vs 1297ms — about 21%, with a much tighter spread (986–1183 against 1089–2016).

**One call, any page.** `view_image` takes `page` (1-based, default 1) and pushes it down to the renderer, so checking slide 3 of a deck needs no render step and no script. Driven live through `examples/document-desk`, an agent asked to "verify it looks right" called `view_image` seven times across pages 1, 2 and 5 — and the vision model caught a duplicated heading ("repeated twice with the same text, one larger and one slightly smaller"), which the agent then fixed and re-checked.

The environment preamble now mentions the verb, but **only when a vision model is wired** — priming a model to reach for a tool that is not in its list buys a wasted call and a confusing failure. `examples/document-desk` wires both `env:render` and an OpenAI-compatible vision endpoint, and omits the verb when no key is present.
