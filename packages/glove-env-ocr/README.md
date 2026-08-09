# glove-env-ocr

OCR stdlib adapter for [`glove-working-environment`](../glove-working-environment). Bridges Tesseract (WASM) into the agent's virtual filesystem as **`env:ocr`** — a scanned PDF or a photo of a document goes in, text with per-page confidence comes out.

```bash
pnpm add glove-env-ocr
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { ocr } from "glove-env-ocr";

const env = await createWorkingEnvironment({ stdlib: [ocr()] });
```

No configuration, no system package, no network. English works on a bare host.

## Why

The environment could get *close* to a scanned document and no further. `documents.extractText` reports `kind: "scanned"` and stops — correctly, there is no text layer to read. `env:render` turns the pages into PNGs — correctly, that is what it is for. A vision model can then **look** at the page, and that is genuinely useful, but the agent still cannot grep it, quote it, check a figure against a spreadsheet, or put a number from it in a report.

A user uploads a scanned contract and asks for the total. That was the gap.

## What the model gets

| Function | Does |
|---|---|
| `describe(path)` | Whether OCR is needed at all, which PDF pages already have text, which languages this host can run — recognises nothing |
| `recognize(path, { pages?, lang?, scale? })` | Text plus per-page confidence, for a PDF or an image |
| `languages()` | The tessdata languages actually installed here |

```js
import { describe, recognize } from 'env:ocr';
import { pdf } from 'env:documents';

/** Pulls the total off a scanned invoice. */
export default async function main() {
  const summary = await describe('/inbox/invoice.pdf');
  if (!summary.needsOcr) return { via: 'text layer', text: (await pdf.extractText('/inbox/invoice.pdf')).text };

  const out = await recognize('/inbox/invoice.pdf', { pages: [1] });
  return { total: /total[^\d]{0,12}([\d.,]+)/i.exec(out.text)?.[1], confidence: out.confidence, note: out.note };
}
```

## Offline is the design, not a nice-to-have

The stock `tesseract.js` setup downloads `<lang>.traineddata` from a CDN the first time it runs. In a sandboxed runtime with no egress that is not a slow path, it is a broken one — and it breaks at recognise time, on a real document, rather than at startup.

So both halves are ordinary bundled dependencies, read off disk:

- the WASM core from `tesseract.js-core`;
- English training data from `@tesseract.js-data/eng` (the `4.0.0_best_int` LSTM set, ~3 MB), handed to the worker as a local `langPath`.

`cacheMethod: "none"` on top, so nothing is written into the host's working directory either. Measured with `fetch` and `node:http`/`node:https` hard-disabled in the process: worker ready in 369 ms, a page recognised in 159 ms, confidence 96, text exact.

Another language works if its data package is installed (`npm i @tesseract.js-data/deu`). If it is not, the call fails **saying so and naming the package** — it never falls back to a download.

A host with its own tessdata (a custom-trained model, the full `4.0.0` set) points at it:

```ts
ocr({ langPath: "/srv/tessdata" })
```

**Install size is the price.** `@tesseract.js-data/eng` unpacks to ~14 MB because it ships both the full `4.0.0` set and the `4.0.0_best_int` one this adapter uses; the data cannot be installed piecemeal. `tesseract.js-core` adds the WASM builds. That is the cost of "works on a bare host with no egress", and it is paid at install time rather than at recognise time on someone's document.

## One rasterizer, not two

PDF pages are rasterised by `glove-env-render/raster` — the same pdfjs + canvas path `env:render` uses for `view_image`. This is deliberate. The first question anyone asks about an OCR result is whether it matches what they saw on the page, and two rasterizers with independent scale handling and font resolution make that unanswerable. There is a test that reads one page both ways and requires the text to be identical.

The one difference is the pixel cap: `env:render` stops at 1600px because a vision model charges by pixel, and this adapter goes to 3000px because Tesseract wants roughly 300 dpi. Different jobs, different right answers.

## Reading the result honestly

OCR text is indistinguishable from real text right up until a digit is wrong, so every way the result can mislead is stated in `note`:

| Situation | What happens |
|---|---|
| Mean confidence under 65 | `note` says the text is likely wrong in places and digits are unverified |
| Nothing readable | `text` is empty, `confidence` is 0, `note` says why — too small, too skewed, wrong language |
| A page had a text layer | `pages[].textLayer` is set and `note` points at `documents.extractText`, because OCR of a born-digital page is a downgrade |
| More pages than the per-call budget | `note` says how many were read |

`confidence` is Tesseract's own mean word score, 0–100. Above 90 is a clean scan; below 65 is a result to check against the page before quoting.

## What it refuses

- Anything that is not a PDF or an image, naming `env:documents` / `env:slides` / `env:render` as the alternatives.
- A language with no data on this host, naming the package to install.
- More than 20 pages per call (`maxPages`) — OCR costs roughly a second a page, so this is a budget, not a capability.

It deliberately does **not** register `handles`: `env:documents` describes a PDF better than this adapter can and `env:images` owns PNGs, so claiming those extensions would steal `describe` dispatch to say something narrower. Same reasoning as `env:render`.

## Options

| Option | Default | Does |
|---|---|---|
| `langPath` | bundled | A directory of `<lang>.traineddata(.gz)`, or a URL, instead of the bundled data |
| `maxPages` | 20 | Pages one `recognize` call may read |
| `scale` | 3 | Rasterisation scale for PDF pages (~216 dpi) |
| `maxWidth` | 3000 | Long-edge cap in pixels for a rasterised page |
| `languages` | common set | Which languages `describe()` and `languages()` check for |
