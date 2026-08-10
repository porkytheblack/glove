# Document Desk

An agent with a **working environment** instead of a menu of document actions.

Drop in a PDF, a workbook, a deck or an image and ask for something. The agent
does not pick from a fixed list of verbs — it has a filesystem, a script
runtime, and a standard library, and it writes code against your files. The
right-hand pane shows that code as it is written; the Files button opens the
filesystem both of you are working in.

```bash
pnpm install
cd examples/document-desk
cat > .env.local <<'ENV'
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...      # optional — turns on `view_image`
ENV
pnpm dev
# http://localhost:3000
```

Any provider `glove-core` knows works — `DESK_PROVIDER=openrouter` plus
`DESK_MODEL=<slug>` swaps it without touching code.

### Letting it check its own work

| Variable | Effect |
|---|---|
| `OPENROUTER_API_KEY` or `VISION_API_KEY` | **Enables `view_image`.** Without one, the verb is not offered at all |
| `VISION_MODEL` | Default `google/gemini-2.5-flash` |
| `VISION_BASE_URL` | Default OpenRouter's; any OpenAI-compatible chat endpoint |

With a vision key set, the agent can look at what it produced instead of only
reading its text back. Ask for a report and watch it call `view_image` on its
own PDF — that is the only way it catches a table running off the page or a
heading printed twice.

The whole integration is `app/lib/vision.ts`: one `describe({ bytes,
mediaType, prompt })` function. Swap the `fetch` for whatever you already run
and nothing else changes.

### The same model, as something a script can loop over

`view_image` is a *verb*: one look, one tool call, and the answer lands in the
context window. That is right for spot-checking page 1 and wrong for a
forty-page document.

So the same vision model is mounted a second time — as a **capability**, with
`defineTools` (`visionModule` in `app/lib/desk.ts`). Scripts import it:

```js
import { rasterize } from 'env:render';
import { look } from 'env:vision';

const { pages } = await rasterize('/out/report.pdf', '/tmp/pages');
const bad = [];
for (const p of pages) {
  const answer = await look({ path: p.path, prompt: 'Is any text cut off at the page edge?' });
  if (/yes/i.test(answer)) bad.push(p.page);
}
return bad.length ? `clipped text on pages ${bad.join(', ')}` : 'all pages clean';
```

Forty answers land in a variable; one line comes back. That is the whole
argument for `defineTools`, and it is the same argument for an MCP server or
any other tool — `fnsFromMcp(conn)` from `glove-scratchpad/fns` produces the
list `defineTools` wants, so a GitHub or mail server mounts the same way and
"a PDF of all my emails" becomes one script instead of two systems.

### Things that move

`env:motion` is mounted too, so the desk is not limited to documents. The agent
writes a React component and gets a video, a GIF or a PNG back — the browser is
the drawing surface, which is why the same capability covers an animated
explainer, a title card and a chart image.

```
Write a motion scene that counts a headline figure up from zero over two
seconds on a dark background, render it to /out as a 4-second mp4, and
present it.
```

A presented video **plays in the transcript** rather than arriving as a
download row, and the file explorer previews video and images inline. For a
render, watching it is the check.

Two things are worth knowing before you try it:

- **A render needs a browser.** Chrome, Edge or Chromium is found
  automatically; run `pnpm check:motion` to see what this machine has and to
  render a test clip end to end with no model and no API key. Every failing
  line comes with the command that fixes it.
- **Renders are slow enough to need their own budget.** `MOTION_LIMITS`
  (4 minutes) replaces the 60s script ceiling in `app/lib/desk.ts`. Without it
  a render is refused up front — with the exact fix named, but still refused.

If the inline player shows a black rectangle with working controls, the video
is fine and your browser has no H.264 decoder — that is a plain Chromium build
rather than Chrome. Ask for `.webm` there.

### Handing the result over

The agent also has `present`, wired through `onPresent` in `app/lib/desk.ts`.
When it finishes something it calls

```
present({ path: '/out/q2.pdf', caption: 'Q2 revenue by region — East highest at $163,200.' })
```

and the file appears in the transcript with that caption — as a player if it is
a video or an image, as a download row otherwise. The verb only accepts paths
under `/out`, which is the point: by the end of a task `/out` also holds drafts
and the intermediate workbook, and only the agent knows which one was the
answer.

## What it demonstrates

Seven stdlib adapters mounted at once, so a single agent handles every format
in one conversation:

| Module | Package | What the agent gets |
|---|---|---|
| `env:documents` | `glove-env-documents` | PDF and DOCX — create, merge, split, stamp, extract text |
| `env:spreadsheets` | `glove-env-spreadsheets` | `.xlsx` as records, CSV both ways, styled workbooks |
| `env:images` | `glove-env-images` | resize, crop, convert, composite, contact sheets |
| `env:slides` | `glove-env-slides` | `.pptx` generation and read-back |
| `env:archives` | `glove-env-zip` | zip and tar, in and out |
| `env:render` | `glove-env-render` | rasterize a PDF, deck or Word file to page PNGs — what `view_image` looks at |
| `env:motion` | `glove-env-motion` | a React scene to an mp4, GIF, PNG frames or a still |
| `env:vision` | — (`defineTools`) | the vision model as a function, so a script can check every page in a loop |

Plus `env:fs`, `env:std` and `env:assert`, which the environment provides
itself.

`env:vision` is the odd one out and deliberately so: the first seven wrap
*libraries*, it wraps a *capability*. Same module shape, same import line, no
adapter to write — see `visionModule` in `app/lib/desk.ts`.

## How it is put together

**The agent runs on the server.** This is the inverse of the usual
`glove-react` arrangement, where tools execute in the browser and
`createChatHandler` proxies the model. It has to be: scripts execute in worker
threads with a real Node heap, and the format adapters wrap libraries
(pdf-lib, exceljs, sharp, pptxgenjs) that only exist server-side. So
`app/api/chat/route.ts` runs `processRequest` and forwards the agent's own
event stream to the browser as SSE.

| File | Role |
|---|---|
| `app/lib/desk.ts` | One environment + one agent per session, held in a module-global registry with idle/TTL eviction |
| `app/api/chat/route.ts` | Runs the turn, streams `text` / `tool` / `tool_result` / `tree_changed` |
| `app/api/upload/route.ts` | `env.mount(bytes, "/inbox/<name>")` |
| `app/api/fs/route.ts` | The tree, and one file's content, read off `env.fs` |
| `app/api/download/route.ts` | `env.fs.readBytes`, `inline` for media the page can play, `attachment` otherwise |
| `scripts/check-motion.ts` | `pnpm check:motion` — renders a clip end to end, no model involved |
| `app/lib/useDesk.ts` | The client half: SSE in, transcript + code cards + tree version out |

**Desks do not live forever.** Each one owns a worker thread and an in-memory
tree — ~16.5 MB and one OS thread of steady residency even with nothing
running — so `reapOldDesks` closes any desk untouched for fifteen minutes, plus
the least recently used past a ceiling of twelve. It runs after every chat
request *and* on an unref'd interval, because a request-driven sweep never runs
on the host that has stopped receiving requests, which is exactly the host with
idle desks to reap. The worker itself is reaped sooner and independently, by
`execution.idleTimeoutMs` inside the package.

This example *drops* the tree on eviction, which is right for a demo where a
reset costs a re-upload. A real host parks it — `snapshot()` before `close()`,
`fromSnapshot` on the way back in — so an idle session costs a row in a table
rather than a thread. `glove-working-environment`'s
[LIFECYCLE.md](../../packages/glove-working-environment/LIFECYCLE.md) works that
policy through.

The three views on screen are projections of one event stream. The code pane
tracks written files by replaying `write_file` and `edit_file` locally — the
edit verb's contract is an exactly-once replacement, so the browser can apply
it without a round-trip.

## Two things that will bite you

**Keep the environment packages out of the bundle.** Scripts run in worker
threads, and the pool finds its worker entry relative to its own module URL.
Bundled, that URL points into a Next chunk and the worker is not beside it —
which surfaces at the first script run rather than at build time. `sharp` is
native and must be external for its own reasons. Hence
`serverExternalPackages` in `next.config.ts`.

**In a monorepo that is not enough.** Next matches `serverExternalPackages`
against the *resolved* path, and resolves it with `symlinks: true` hardcoded.
pnpm links a workspace dependency to `../../packages/<name>`, which contains no
`node_modules` segment, so the match never fires and the package is bundled
anyway — the error is `Can't resolve './worker-dev.mjs'`, several layers from
the cause. `next.config.ts` carries an explicit webpack external to bypass the
path heuristic. An app installing these from npm does not need it.

## Getting files in

**Drop anything, anywhere in the window** — or paste it, or use the paperclip.
There is no format filter: the environment is a filesystem, and an allowlist
could only ever be wrong about a format nobody thought of. A `.webp`, a `.heic`,
a 60MB scan and a `.bin` all land the same way.

Files upload **the moment they arrive**, not when you send a message. The chip
is the receipt — it spins, then turns green with the name it landed as, or red
with the reason it did not. So attaching is its own action: the file is in
`/inbox` whether or not you ever say anything about it, and a failing chat turn
can no longer look like a failing upload.

Three details that were bugs before, in case you are building something similar:

| Detail | Why |
|---|---|
| Drops are handled on the **window** | Handling them only on the composer means a drop anywhere else hits the browser's default — which *navigates away from the app to open the file*. For an image that looks exactly like a rejection |
| Send works with **files and no text** | Requiring a message to carry a file makes "here, look at this" impossible to express. With no text it sends what you did: the names, and where they are |
| One bad file **does not fail the batch** | Uploads are reported per file. Previously the first failure 400'd the whole request, so a single oversized file silently discarded the result for everything beside it |

Uploads are capped by `limits.maxFileBytes` in `app/lib/desk.ts` (96MB here).
If you deploy this, note that serverless platforms impose their own request
body limit — Vercel's is 4.5MB — which is a platform ceiling, not this app's.

## Trying it

Upload a spreadsheet and ask for a ranking. Watch the right pane: the agent
reads `/skills/imports.md`, writes a script, gets an import wrong, sees the
error, edits the script, and runs it again. Then open **Files** — the script
is still there under `/scripts`, with a generated `.d.ts` beside it. Ask for
the same analysis on different data next time and it can reuse it.

That accumulation is the point. A tool call ends when it returns; a script
stays.
