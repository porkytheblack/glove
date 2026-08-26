---
"glove-env-documents": minor
---

`docx.extractImages` — get the pixels out of a Word file

`docx.extractText` now says `kind: "scanned"` when a .docx is images rather than words, but saying so only helps if there is somewhere to go next. There was not: images went *into* a document through `docx.create` and never came out. The workaround — a .docx is a ZIP, so `env:archives` can pull `word/media/*` — works, and no error message or doc pointed at it, so nothing would find it.

```js
const { images, note } = await docx.extractImages('/inbox/contract.docx', '/tmp/media');
for (const image of images) {
  if (image.vector) continue;
  const { text, confidence } = await recognize(image.path);
}
```

Everything under `word/media/` is covered, so an image in a header comes out beside one in the body. **Bytes are copied, never re-encoded** — a re-encode would cost accuracy on exactly the scans this exists to reach, and the test asserts byte equality rather than "an image came out".

**`vector` is the field that matters.** Word stores a chart pasted from Excel as EMF, so the figure a caller most wants is the one that arrives in a format neither `env:images` nor `env:ocr` can decode. Extracting it and saying nothing would send them to sharp for an error, so `vector` marks EMF/WMF/SVG and `note` says so when some or all of the images are affected. Rendering the document with `env:render` is the way to see those.

Embedded audio and video live under `word/media/` too; they are skipped, and `note` names them rather than writing them out under a function called `extractImages`.

The `kind`/`note` guidance on `extractText` now names `docx.extractImages` instead of the `env:archives` route, and a new `documents-scanned` skill carries the whole path — how to tell a scan from a blank file, and how to read one anyway — because the measured failure mode in this environment is a shape written from memory, which a worked example fixes and a better error does not.
