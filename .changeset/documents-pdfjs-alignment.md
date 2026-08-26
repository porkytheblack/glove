---
"glove-env-documents": minor
---

Move the pdfjs peer onto v6, so documents, render and OCR can share a process

`glove-env-documents` asked for `pdfjs-dist@^5.0.0`; `glove-env-render` and `glove-env-ocr` both depend on `^6.2.0`. No single install satisfied all three, so a host that wired them together — which is precisely what reading a scanned document takes — got two copies of pdfjs in one process.

That is not the harmless duplication it looks like. pdfjs resolves its main-thread worker through `globalThis.pdfjsWorker`, a process **global**: both copies use whichever worker registered first, and the loser fails every call with

```
The API version "6.2.108" does not match the Worker version "5.7.284"
```

It is order-dependent, so it presented as "OCR is broken" or "extractText is broken" depending on which ran first in that session, and neither package's own suite could see it — each is the only pdfjs in its own test process. A cross-adapter test now pins the combination.

Moving the range surfaced a real v5-ism this package had: `doc.destroy()`, which pdfjs 6 removed in favour of teardown through the loading task. Every `extractText` call against pdfjs 6 was throwing `doc.destroy is not a function` — so the old peer range was load-bearing, and anyone who had already installed pdfjs 6 for the rasterizer was getting that instead.

**Upgrading:** if you install `pdfjs-dist` to satisfy this peer, move to `^6.2.0`. The extraction API is unchanged.

The repo's own consumers — `examples/analyst-desk`, `examples/document-desk` and `examples/glovebox-env` — moved with it. The analyst-desk selfcheck is what caught them: it is the only thing that exercises documents, spreadsheets, images and slides together, and it failed with the mismatch the other way round (`API "5.7.284"` against `Worker "6.2.108"`) because those examples were still pinning pdfjs 5 while the adapters had moved to 6.
