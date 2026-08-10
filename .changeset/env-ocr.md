---
"glove-env-ocr": minor
"glove-env-render": patch
---

New adapter: `glove-env-ocr` — a scanned PDF or a photo of a document becomes text, offline.

The environment could get *close* to a scan and no further. `documents.extractText` reports `kind: "scanned"` and stops, correctly — there is no text layer to read. `env:render` rasterises the pages, correctly — that is what it is for. A vision model can then **look** at the page. But the agent still could not grep it, quote it, check a figure against a spreadsheet, or put a number from it in a report. A user uploading a scanned contract and asking for the total had no path at all.

`recognize(path, { pages, lang, scale })` returns the text plus **per-page confidence**; `describe(path)` says whether OCR is even needed and which PDF pages already carry a text layer; `languages()` reports what this host can actually run.

**Offline is the design, not a nice-to-have.** The stock `tesseract.js` setup downloads `<lang>.traineddata` from a CDN on first use — in a sandboxed runtime with no egress that is not a slow path but a broken one, and it breaks at recognise time on a real document rather than at startup. Both halves are ordinary bundled dependencies read off disk: the WASM core from `tesseract.js-core`, and English training data from `@tesseract.js-data/eng` handed to the worker as a local `langPath`, with `cacheMethod: "none"` so nothing is written into the host's working directory either. Measured with `fetch` and `node:http`/`node:https` disabled in the process: worker ready in 369ms, a page read in 159ms, confidence 96, text exact. Another language works if its data package is installed and otherwise fails **naming the package** — it never silently falls back to a download. A host with its own tessdata passes `ocr({ langPath })`.

**One rasterizer, not two.** PDF pages go through `glove-env-render/raster`, the same pdfjs + canvas path `env:render` uses for `view_image`. The first question anyone asks about an OCR result is whether it matches what they saw, and two rasterizers with independent scale handling make that unanswerable. A test reads one page both ways and requires identical text. The one difference is the pixel cap — 1600px in `env:render` because a vision model charges by pixel, 3000px here because Tesseract wants roughly 300 dpi.

**OCR text looks exactly like real text until a digit is wrong**, so every way the result can mislead is said out loud in `note`: mean confidence under 65, a page that produced nothing, a page that already had a text layer (OCR of a born-digital page is a downgrade, and the note points back at `documents.extractText`), and pages dropped at the per-call budget. Confidence is Tesseract's own mean word score, reported per page as well as overall.

Not registered under `handles`: `env:documents` describes a PDF better than this adapter can and `env:images` owns PNGs, so claiming those extensions would steal `describe` dispatch to say something narrower — the same reasoning `env:render` documents.

Alongside it, `glove-env-render` gains a `./raster` subpath export (`rasterizePdf`, `rasterizeImage`, `officeToPdf`) so the rasterizer can be reused rather than reimplemented. No behaviour change to `env:render` itself.
