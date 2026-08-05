# glove-env-render

Pictures of the agent's own output, so it can **check its work by looking at it**.

Every other way of verifying in [`glove-working-environment`](../glove-working-environment) reads text back. That finds a wrong number and misses a table running off the page, a chart with no bars, a title overlapping its subtitle, or a final slide that came out blank — the defects a person notices in the first second.

```bash
pnpm add glove-env-render
```

## Two halves

**This package** rasterizes to PNG inside the VFS:

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { render } from "glove-env-render";

const env = await createWorkingEnvironment({ stdlib: [render()] });
```

```js
// …and a script can then do:
import { render } from 'env:render';
const shot = await render('/out/report.pdf', '/tmp/proof');   // → /tmp/proof/report-p1.png
```

**The `view_image` verb** (in `glove-working-environment`, enabled when the host wires a vision model) is what actually looks at it — and it renders for you, so verification is one call:

```ts
const env = await createWorkingEnvironment({
  stdlib: [render()],
  vision: {
    async describe({ bytes, mediaType, prompt }) {
      // your provider — this is the whole contract
      return await myVisionModel(bytes, mediaType, prompt);
    },
  },
});
```

```
view_image({
  path: '/out/report.pdf',
  prompt: 'This should list four regions with a total. Name every region and
           figure you can see, and say whether any text is cut off or overlapping.'
})
```

Measured against a report with two deliberate defects — a row pushed off the right edge and a subtitle overlapping the title — a commodity vision model reported both, unprompted about either specifically.

## What it renders

| Input | Needs |
|---|---|
| `.pdf` | nothing |
| `.png .jpg .webp .gif .bmp .tiff` | nothing |
| `.pptx .docx .xlsx .odp .odt .ods` | headless LibreOffice on the host |

PDFs go through `pdfjs-dist` onto `@napi-rs/canvas` — both are ordinary dependencies with prebuilt binaries, no system packages.

Office formats go through LibreOffice, because no npm package renders `.pptx` faithfully. **`libreoffice-core` alone is not enough**: it ships no import filters, and every conversion fails with `source file could not be loaded` while exiting 0. Install `libreoffice-impress` for decks and `libreoffice-writer` for Word. The adapter detects exactly that case and says so.

If LibreOffice is not available, generate the PDF directly instead — `glove-env-documents` renders the same document spec to PDF with no system dependency.

### At scale, don't spawn LibreOffice

Spawning `soffice` per file costs ~1s of process start, and no amount of tuning removes it. Every platform that renders Office documents in volume keeps LibreOffice **warm behind a queue** instead — Gotenberg, unoserver, JODConverter and Collabora are all that shape. The ones that avoid LibreOffice entirely pay for a native SDK.

So the escape hatch is a function, and the ceiling becomes theirs rather than ours:

```ts
render({
  async convertOffice(bytes, filename) {
    const form = new FormData();
    form.set("files", new Blob([bytes]), filename);
    const res = await fetch("http://gotenberg:3000/forms/libreoffice/convert", {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(`gotenberg ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
})
```

With it set, `soffice` is never invoked and no profile pool is created. PDFs and images are unaffected — they never needed LibreOffice.

Without it, conversions lease from a small pool of **reused** LibreOffice profiles. Concurrent conversions cannot share a profile, but a *fresh* one pays first-run initialization, so profiles are leased exclusively and returned. Measured at 8 conversions per arm, interleaved, comparing medians:

| strategy | median | spread |
|---|---|---|
| a fresh profile each | 1297ms | 1089–2016 |
| a leased profile reused | 1019ms | 986–1183 |

About 21%, and the tighter spread matters as much as the median. `profilePoolSize` (default 2) is how many conversions can run at once.

## API

```ts
render(input: string, outDir: string, opts?: {
  pages?: number[] | "all";   // 1-based. Default [1]
  scale?: number;             // Default 1.5
  maxWidth?: number;          // Long-edge cap. Default 1600
}): Promise<{
  pages: Array<{ path: string; page: number; width: number; height: number; bytes: number }>;
  format: "pdf" | "office" | "image";
  totalPages: number;         // the document's length, not the render's
}>
```

Host-side options: `render({ sofficePath, officeTimeoutMs, maxWidth, maxPages })`.

Three details that are deliberate:

- **Format is decided by magic bytes, then extension.** A PDF named `.pptx` is a PDF and never reaches LibreOffice.
- **`maxWidth` caps the long edge at 1600px.** A vision model charges by pixels and reads an A4 page perfectly well at that size; rendering at scale 3 costs several times more and answers no better.
- **Each LibreOffice conversion gets a private user profile.** LibreOffice locks its user-installation directory and opens an IPC socket named after it — the machinery that makes a second document open in the LibreOffice you already have running. Headless, a second conversion sharing that profile tries to delegate to the running instance instead of converting, and exits without writing anything. Measured: four concurrent conversions on a shared profile produced **two** PDFs; the same four with a profile each produced **four**. The losers are inconsistent — some exit 1, some exit 0 having done nothing — so success is decided by whether a PDF appeared, never by the exit code.

## Verifying it yourself

`pnpm test` covers the PDF and image paths for real: it generates a PDF, rasterizes it, and asserts on the bytes. The LibreOffice test skips with a message when the import filters are absent, rather than quietly passing.

`tests/live-check.mts` is a manual end-to-end check against a real vision model — it builds a report with known defects, renders it, and prints what the model saw. Needs `OPENROUTER_API_KEY`; it is not part of CI.

```bash
pnpm exec tsx tests/live-check.mts
```
