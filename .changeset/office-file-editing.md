---
"glove-env-documents": minor
"glove-env-slides": minor
---

"Change the client name in this contract" rebuilt the contract instead of changing it

Both of the make-a-document adapters were regenerate-only, and the way they failed was quiet. `docx` is a write-only library and pptxgenjs cannot open a deck, so the only route to an edit was to extract the text and render a new file from it — which rebuilds the document out of the small vocabulary our own spec can express, and drops everything else on the floor while reporting success.

Measured, not assumed. A contract with a header, a bold red client name and a logo went through that cycle and came back missing `word/header1.xml`, its relationships and `word/media/*.png`, with the client name returned as plain text. A deck with a chart and a footer lost `ppt/media/image-3-1.png` and the footer's slide layout. Neither loss shows up in a text round-trip, which is exactly why it was worth fixing.

**`docx.replaceText(path, replacements, options?)` and `slides.replaceText(path, replacements, options?)` edit the package instead.** The one part carrying the matched text is inflated, spliced and re-deflated; every other entry is copied across *still compressed*, with its recorded CRC and method. That is the guarantee, and it is a property of the bytes rather than of a model of the document: code that never decoded `word/styles.xml` cannot change it. The DOCX edit rewrote 2 of 28 parts and left 26 byte-identical; the slide edit rewrote 1 of 50 and left 49. The tests hash every part before and after and assert on the exact set that moved.

The interesting half is the splicing. Neither format stores "Northwind Traders" anywhere — Word and PowerPoint start a new run wherever anything changes, including a spell-check marker or a revision id, so a name a person reads as one word is routinely two or three `<w:t>` elements and a per-element replace finds nothing. Runs are therefore reassembled per paragraph, matched there, and written back onto the runs they came from: the replacement goes wholly into the run where the match *started*, so a bold client name stays bold and a red one stays red, and the runs around it are re-emitted unchanged.

Three decisions worth naming, because each has a wrong answer that produces a plausible file:

- **Paragraphs are found with a stack, not a regex.** They nest — a text box lives inside a run and carries paragraphs of its own, and so does a table cell. A non-greedy `<w:p>…</w:p>` ends the outer paragraph at the inner `</w:p>`, which would splice the opening of one sentence onto the text of an unrelated box and could match a phrase that is nowhere in the document.
- **Rules are applied in one pass.** `{ Acme: 'Globex', Globex: 'Initech' }` run in sequence carries the original Acme all the way to Initech. One pass with first-rule-wins makes the outcome a function of the rules rather than of their execution order.
- **A search that matches nothing throws.** Writing a byte-identical file and returning success is the failure that costs a run: the model believes the rename happened. When several rules are given and only some hit, `unmatched` names the misses.

Scope is text, and it says so. `slides.replaceText` takes `{ slides: 4 }` or `{ slides: [2, 4] }`, numbered exactly as `describe` and `extract` number them, and leaves speaker notes alone unless asked. `docx.replaceText` edits headers, footers, footnotes and endnotes by default — a client name is usually in a header too — with `{ parts: 'body' }` to narrow it. Matching is literal, case-sensitive, and never crosses a paragraph boundary, because two paragraphs are two lines on the page and joining them would let a replacement swallow the break.

Both edit paths read through the same guarded VFS handle and the same inflation cap as the readers, with tests that point a zip bomb and an encrypted archive at `replaceText` specifically. A new read path is exactly where a closed hole gets reopened, and nothing about a find/replace looks like a place to check for a decompression bomb.

One correctness fix fell out of the work: **a slide's speaker notes are now resolved through the slide's relationships rather than by matching numbers.** `slide7.xml` ↔ `notesSlide7.xml` holds for decks this package writes and for very little else — PowerPoint numbers notes parts in creation order, so a deck where slide 2 got notes first has `notesSlide1.xml` hanging off slide 2. Reading and editing consult the same resolver, so an edit scoped to a slide cannot land on a different slide's notes.

36 tests added across the two packages.
