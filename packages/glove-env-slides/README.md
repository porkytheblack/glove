# glove-env-slides

PowerPoint decks for [`glove-working-environment`](../glove-working-environment). Registers as `env:slides`: an agent builds a deck from a spec, or reads one it was handed.

```bash
pnpm add glove-env-slides
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { slides } from "glove-env-slides";

const env = await createWorkingEnvironment({ stdlib: [slides()] });
```

## Building

```js
import { create } from 'env:slides';

export default async function main() {
  return create({
    title: 'Q3 Review',
    subtitle: 'Prepared for the board',
    footer: 'Confidential',
    slides: [
      { title: 'Headline', metric: { value: '$4.2M', caption: 'revenue, up 12% QoQ' } },
      { title: 'By region', table: [['Region', 'Revenue'], ['EMEA', '$1.8M'], ['AMER', '$2.4M']] },
      {
        title: 'What changed',
        bullets: ['EMEA renewals landed early', '  two of them slipped from Q2'],
        notes: 'The board asked about the Q2 slip last time — lead with it.',
      },
    ],
  }, '/out/q3.pptx');
}
```

A slide takes one kind of content — `bullets`, `table`, `metric` or `body`, applied in that order — plus an optional `image` (a VFS path, so generate it with `env:images` first) and `notes`. Indent a bullet by prefixing two spaces.

A table longer than a slide continues onto further slides with its header repeated, rather than running off the bottom. That matters more than it sounds: an overflowing table still puts every row in the file, so `extract()` finds them all and nothing looks wrong until someone opens the deck.

The palette and layout are fixed rather than configurable. An agent choosing colours per deck produces something worse than a consistent default, and every knob is a decision it has to spend a turn on.

## Reading

`describe()` answers "what am I holding?" for a few dozen tokens — no deck is small enough to read blind:

```js
const summary = await describe('/inbox/board.pptx');
// { format: 'pptx', slides: 31, titles: [...], words: 2140, media: 6, bytes: 284102 }
```

`extract()` returns every slide's title, body paragraphs and speaker notes. `outline()` flattens the whole deck to markdown with `## Slide N: Title` headers — write that to a file and `grep` it, which costs a fraction of pulling 31 slides through the response cap.

## Why the reader is not pptxgenjs

Writing goes through [pptxgenjs](https://gitbrent.github.io/PptxGenJS/); reading goes through this package's own ZIP + OOXML reader in `src/pptx.ts`, and that asymmetry is deliberate.

Verifying a writer with its own library proves only that it is self-consistent. A title written into the wrong placeholder, or a bullet silently dropped, round-trips perfectly through the library that made the mistake. Opening the file independently is what catches it — and it is the only way to read a deck this environment did not write, which is most of the review work an agent is actually asked to do.

Two things that reader gets right and a naive one does not:

- **Runs are joined within a paragraph.** PowerPoint splits one visual line into several `<a:t>` runs wherever formatting changes, so "Revenue **grew** 12%" is three runs. Joining on run boundaries turns one bullet into three and every count downstream is wrong.
- **Footers live on the slide master, not the slide.** A footer stamped into each slide's own XML comes back as a body line on every slide, so a 30-slide deck yields 30 copies of "Confidential" and any summary built from the text inherits them. Chrome is not content.

The test suite reads decks back through that independent path, and one test skips both readers entirely — it runs the system `unzip` to CRC-check the archive and assert every OOXML part the spec requires is present, so a deck only our own code can open still fails.

## Handling

Claims `.pptx` by extension only. A pptx is a ZIP and so are `.docx` and `.xlsx`, so the `PK` signature cannot tell them apart — claiming it would steal every Office file from the adapter that owns it. `describe()` verifies by looking for `ppt/slides/` inside and says so when the container is some other kind of Office file.

## Limits

- ZIP64 archives are refused with a message rather than mis-parsed.
- Charts are not generated. Render one with `env:images` and place it via `image`.
- Reading recovers text, notes and media counts — not layout, animation or theming. It is built for review, not for round-tripping someone else's design.
