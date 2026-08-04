---
"glove-working-environment": minor
"glove-env-slides": minor
---

Scripts can use a wrapped library's real API, not a spec invented for it.

```js
import { PptxGenJS } from 'env:slides';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
const slide = pptx.addSlide();
slide.addText('Revenue', { x: 0.5, y: 0.4, fontSize: 32, bold: true });
slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.1, w: 1.4, h: 0.07 });
slide.addTable(rows, { x: 0.5, y: 1.4, align: pptx.AlignH.left });
await pptx.writeFile({ fileName: '/out/deck.pptx' });
```

That is pptxgenjs, verbatim from its own documentation. Models have read thousands of examples of exactly this, so an API that differs makes them translate — and translation is where they burn turns. The analyst-desk eval caught it directly: a model reached for `import { slides } from 'env:slides'` because the real library has a class, not a bag of verbs.

**How it works.** A live object cannot cross a thread boundary, so nothing does. The worker records `new`/call/set into a flat op list — synchronously, so the API chains exactly like the real one — and the whole list crosses once, on the terminal call. One round trip per document rather than one per call, and no `Atomics` shim.

The recorder is built *inside* the vm context, alongside the capability closures. It has to be: every value crossing that boundary is deep-copied, and a Proxy whose behaviour lives entirely in traps has no own keys, so a copy of one is `{}`.

**`defineBuilder` for adapter authors**, with three things that are not optional:

- **The allowlist is read off the library** (`methodsOf`), not typed out. A hand-written list is wrong the day the dependency adds a method, and wrong invisibly — the symptom is a model writing correct code from the real docs and being told the method does not exist.
- **Prototype members are refused.** Replaying a script-chosen name against a live host object would make `constructor` callable, and `constructor.constructor` is the classic route to the host realm.
- **A `rewrite` hook for path arguments.** This closed a real hole found while testing something else: `addImage({ path })` made pptxgenjs open the file *itself*, off the host filesystem, so a script could name any host file the process could read and have its bytes embedded in a deck it then exports. Paths are now resolved through the guarded VFS handle and passed on as inline bytes. Any wrapped library that takes a filename has the same hole — the hook is how an adapter closes it.

Errors name the call that caused them (`call #7 addText(): …`), because the document is assembled at write time and a bare flush failure says nothing about which line was wrong. Resolving paths at replay also moves a missing-file failure onto the `addImage()` that named it rather than the `writeFile()` that tripped over it later.

The curated `create(spec, path)` is unchanged and still the shorter path for "just make me a deck". It is simply no longer the only one.
