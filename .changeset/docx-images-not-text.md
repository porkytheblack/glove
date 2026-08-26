---
"glove-env-documents": minor
---

A .docx that is images reports itself as images, instead of as an empty file

`docx.extractText` returned `text: ""` for a scanned contract someone had pasted into Word — the same thing it returns for a genuinely blank document. There is no way to tell those apart from the outside, so the honest reading of the result is "this file is empty", and that is what agents concluded and reported. `pdf.extractText` has said `kind: "scanned"` since forever; DOCX is the format where the failure is *quieter*, and it had no signal at all.

It does now, in the same shape:

```js
const { kind, text, note } = await docx.extractText('/inbox/contract.docx');
if (kind === 'scanned') return { blocked: note };
```

- **`kind`** is `"text"`, `"scanned"` or `"empty"` — a document-level property, since a .docx has no pages until something lays it out.
- **`describe` counts `images`**, the content `words` and `characters` cannot see.
- **`note`** appears whenever the text alone misleads, and carries the way out rather than just the diagnosis. A .docx is a ZIP, so the pixels come out with `env:archives`:

  ```js
  const media = await extract('/inbox/contract.docx', '/tmp/media', { include: 'word/media/*' });
  const { text, confidence } = await recognize(media[0]);
  ```

  That recipe is tested end to end, not just asserted on: the note's own advice, run verbatim, recovers the text off the scan.

A note also appears on a document that *does* have text but carries images beside it — a chart pasted into a report keeps its figures in pixels, and the word count gives no hint. A plain text document with no images gets no note, because a note on every document is a note nobody reads.

Images are counted by the two elements that actually reference image data, DrawingML's `<a:blip>` and legacy VML's `<v:imagedata>`, rather than by `<w:drawing>` — native charts and shapes have no pixels in `word/media/` to go and get.
