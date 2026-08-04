---
"glove-env-slides": minor
"glove-working-environment": patch
---

New adapter: `glove-env-slides` — build PowerPoint decks and read them back.

A deck is the one artifact an agent is routinely asked to *produce* rather than consume, and the environment had no way to make one: `env:documents` writes PDF and DOCX, which are the wrong shape for something meant to be presented.

```js
import { create } from 'env:slides';

await create({
  title: 'Q3 Review',
  footer: 'Confidential',
  slides: [
    { title: 'Headline', metric: { value: '$4.2M', caption: 'revenue, up 12% QoQ' } },
    { title: 'By region', table: [['Region', 'Revenue'], ['EMEA', '$1.8M']] },
    { title: 'Risks', bullets: ['Covenant headroom is thin'], notes: 'Expect a question here.' },
  ],
}, '/out/q3.pptx');
```

`describe()` returns the outline — slide count and every title — for a few dozen tokens, because no deck is small enough to read blind. `extract()` returns each slide's text and speaker notes, and `outline()` flattens the deck to markdown you can write to a file and `grep`, which costs a fraction of pulling thirty slides through the response cap.

**Writing goes through pptxgenjs; reading does not.** Verifying a writer with its own library proves only that it is self-consistent — a title written into the wrong placeholder round-trips perfectly through the library that made the mistake. Reading goes through this package's own ZIP + OOXML reader, which is also the only way to open a deck the environment did not write, and that is most of the review work an agent is actually asked to do. One test skips both readers and runs the system `unzip` to CRC-check the archive and assert every OOXML part the spec requires is present, so a deck only our own code can open still fails.

Two things that reader gets right and a naive one does not, both found by the tests rather than by reasoning:

- **Runs are joined within a paragraph.** PowerPoint splits one visual line into several `<a:t>` runs wherever formatting changes, so "Revenue **grew** 12%" is three runs and a naive reader reports three bullets where there is one.
- **Footers live on the slide master.** Stamped into each slide's own XML, a footer comes back as a body line on every slide — thirty copies of "Confidential" in a thirty-slide deck, inherited by any summary built from the text. Chrome is not content.

Claims `.pptx` by extension only, deliberately: a pptx is a ZIP and so are `.docx` and `.xlsx`, so claiming the `PK` signature would steal every Office file from the adapter that owns it. `describe()` verifies by looking for `ppt/slides/` inside.

Also in `glove-working-environment`: the heap-ceiling warning is now reported once per process rather than once per environment. The condition it describes is a property of the process — one flag affecting every worker it will ever start — so a host creating an environment per conversation, or a test suite creating thirty, was getting the same unchanging sentence repeated until it read as log noise. A host that passes its own `execution.onWarning` still gets every occurrence, since that is the caller asking to be told.
