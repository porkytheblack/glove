# Document Desk

An agent with a **working environment** instead of a menu of document actions.

Drop in a PDF, a workbook, a deck or an image and ask for something. The agent
does not pick from a fixed list of verbs — it has a filesystem, a script
runtime, and a standard library, and it writes code against your files. The
right-hand pane shows that code as it is written; the Files button opens the
filesystem both of you are working in.

```bash
pnpm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > examples/document-desk/.env.local
pnpm --filter glove-document-desk dev
# http://localhost:3000
```

Any provider `glove-core` knows works — `DESK_PROVIDER=openrouter` plus
`DESK_MODEL=<slug>` swaps it without touching code.

## What it demonstrates

Five stdlib adapters mounted at once, so a single agent handles every format
in one conversation:

| Module | Package | What the agent gets |
|---|---|---|
| `env:documents` | `glove-env-documents` | PDF and DOCX — create, merge, split, stamp, extract text |
| `env:spreadsheets` | `glove-env-spreadsheets` | `.xlsx` as records, CSV both ways, styled workbooks |
| `env:images` | `glove-env-images` | resize, crop, convert, composite, contact sheets |
| `env:slides` | `glove-env-slides` | `.pptx` generation and read-back |
| `env:archives` | `glove-env-archives` | zip and tar, in and out |

Plus `env:fs`, `env:std` and `env:assert`, which the environment provides
itself.

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
| `app/lib/desk.ts` | One environment + one agent per session, held in a module-global registry |
| `app/api/chat/route.ts` | Runs the turn, streams `text` / `tool` / `tool_result` / `tree_changed` |
| `app/api/upload/route.ts` | `env.mount(bytes, "/inbox/<name>")` |
| `app/api/fs/route.ts` | The tree, and one file's content, read off `env.fs` |
| `app/api/download/route.ts` | `env.fs.readBytes` with a Content-Disposition |
| `app/lib/useDesk.ts` | The client half: SSE in, transcript + code cards + tree version out |

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

## Trying it

Upload a spreadsheet and ask for a ranking. Watch the right pane: the agent
reads `/skills/imports.md`, writes a script, gets an import wrong, sees the
error, edits the script, and runs it again. Then open **Files** — the script
is still there under `/scripts`, with a generated `.d.ts` beside it. Ask for
the same analysis on different data next time and it can reuse it.

That accumulation is the point. A tool call ends when it returns; a script
stays.
