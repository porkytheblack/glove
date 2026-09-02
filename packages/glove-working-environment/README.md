# glove-working-environment

A small, fast, in-memory, sandboxed **persistent working environment** for LLM agents. It gives a model a virtual filesystem it can act on across many tool calls: create files, write and persist scripts, run them, capture outputs, generate intermediates, inspect them, and iterate — the way a developer works in a regular environment — **without** networking, host filesystem access, or process spawning.

```bash
pnpm add glove-working-environment
```

Zero-dependency core (Node builtins only). Heavy format libraries (pdf, xlsx, images, …) live in separate adapter packages.

## Positioning

| Project | Solves | Shape |
|---|---|---|
| `glove-scratchpad` | One powerful executable over a resource catalog (SQL over resources) | Stateless-per-call REPL |
| **`glove-working-environment`** | A place where state accumulates: multi-file, multi-script, persistent, inspectable | Persistent VFS + script execution |
| `glorp` | Tasks requiring a *real* coding environment (real node, real toolchains) | Full-fidelity environment |

Design goals: **context-window discipline** (big data lives in files; tool outputs truncate with spillover to `/tmp`), **security by construction** (scripts run in a scope containing *only* injected capabilities — there is no `fetch` to block, it simply does not exist), **one tree** (inputs, scripts, intermediates, outputs, docs, history), and a **compounding library** (scripts persist and compose; an agent accumulates a discoverable, documented toolkit of its own).

Non-goals, equally load-bearing: no networking (not configurable), no shell emulation, no bare `exec`/REPL tool (all execution goes through named, persistent scripts), no background execution or watchers.

**And no agent loop.** This package makes the work possible and keeps it safe; it does not decide whether the work is *good*. Measured over 90 agent runs, 92% produced the artifact they were asked for and 54% were fully correct — the gap is judgment (a buried fact missed, a settled claim mistaken for an outstanding one), not tooling. Closing it needs generate-and-evaluate with a critic, and that belongs in the host, which is why everything it needs is public: `snapshot()`/`fromSnapshot()` to checkpoint and rewind, `export()` to pull artifacts for judging, `fs` to read what the agent actually did, `mount()` to feed a critique back in. [`examples/analyst-desk`](../../examples/analyst-desk) is a working reference for the evaluate half.

## Quick start

```ts
import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";

const env = await createWorkingEnvironment({
  stdlib: [documents(), spreadsheets()],   // optional adapter packages
  limits: { runTimeoutMs: 30_000 },        // optional overrides
});

// doors (host-side; the model never sees these)
await env.mount("./q3.xlsx", "/inbox/q3.xlsx");           // host path, bytes, or { text }
// … agent works …
const deliverables = await env.export("/out/**");          // → [{ path, bytes }]
const snap = await env.snapshot();                         // serializable; persist anywhere

// model-facing: fold the closed verb set onto a Glove agent
mountWorkingEnvironment(glove, { env });                   // primes the system prompt too
// or fold manually: for (const t of env.tools) glove.fold(t);
```

### Backing it with a real directory

```ts
import { hostDirectory } from "glove-working-environment";

const disk = hostDirectory("./workspace");            // copy-on-write
const env = await createWorkingEnvironment({ filesystem: disk });
// … agent reads the corpus directly, writes freely; the directory is untouched …
await disk.commit();                                  // or disk.discard()
```

Reads fall through to disk; writes and deletes land in an in-memory overlay; nothing on the host changes until `commit()`. That means a directory of a thousand documents needs no `mount()` calls and no second copy in memory — and, more importantly, **the agent cannot damage the source**. `hostDirectory(dir, { mode: "readonly" })` refuses every write outright.

Containment is checked *after* symlink resolution, on the real path, for every access: a link out of the root — or a symlinked parent directory — is refused rather than followed, with a test for each. Links that stay inside the root work normally, because the rule is containment, not link-avoidance.

### Read-only zones: a directory the agent can read but never edit

The rule the environment already applies to `/std` and `/skills`, made yours to configure:

```ts
const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
await env.mount("./handbook.pdf", "/corpus/handbook.pdf");   // the host door stays open
```

Everything under `/corpus` is readable, greppable and describable; every mutation — `write_file`, `edit_file`, `rm`, `mv` in **or out**, `mkdir`, `undo` — is refused with an error naming the zone and the fix (`cp` the file to `/tmp` and work on the copy). The orientation file announces the zone up front, so the model learns "read-only" by reading, not by being refused.

Enforcement lives at the core mutation gateway, so it binds every surface at once: the model verbs, scripts going through `env:fs`, and stdlib adapters. Only `env.mount()` bypasses it — seeding content the agent can only read is what the option is for. `env.fs`, the *guarded* host handle, obeys the same rules as the model.

Pairs naturally with `hostDirectory`: hand the agent a real project where some subtrees are reference-only —

```ts
const env = await createWorkingEnvironment({
  filesystem: hostDirectory("./project"),
  readOnlyPaths: ["/src"],          // read and grep the source, write only /tmp, /out, /notes…
});
```

Like `stdlib`, the option is not stored in snapshots — the host re-supplies it on restore.

Restore later:

```ts
import { createWorkingEnvironment, fromSnapshot } from "glove-working-environment";
const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(snap), stdlib: [...] });
```

### Backing it with cloud storage

```ts
import { cachedRemote } from "glove-working-environment";

const env = await createWorkingEnvironment({
  filesystem: await cachedRemote(myStore, { prefix: `sessions/${id}/` }),
});
```

`myStore` is yours to write — four methods (`get`, `put`, `delete`, `list`), which is all S3, GCS, R2 and Azure Blob have in common, and why this package still depends on none of them.

The reason it is `cachedRemote` and not `remote`: the `Vfs` contract has three whole-tree operations, and they are not cold paths. `totalSize()` runs on **every write** (the byte-budget check) and `files()` backs glob, grep, recursive rm, directory mv/cp and checkpoint fork. Straight through to S3 those are a full bucket LIST per write. So the index — paths, sizes, mtimes, which directories exist — is held in memory and maintained on every mutation, and only file *content* crosses the network. `files()`, `list()`, `stat()`, `exists()` and `totalSize()` cost zero round trips; `read`, `write` and `rm` cost one, and reads are cached (32 MiB by default) because a session re-reads the same scripts and `.d.ts` siblings constantly.

The index is updated only *after* the store confirms a write, so a failed put leaves it honest rather than claiming a file that is not there. Object stores have no directories: a non-empty one is implied by the keys beneath it, and `mkdir` writes a zero-byte `<key>/` marker for the empty case.

**Prefer a snapshot if you only want persistence.** Writing `env.snapshot()` to one object is one round trip per session instead of one per file, and it is atomic. Reach for `cachedRemote` when the tree genuinely outgrows the heap, or when other systems need to read the files directly.

There is **no distributed locking**. The environment serializes its own mutations within a process; two hosts on one prefix would race on version rings and run history. Give every session its own prefix — which also makes cleanup a single delete-by-prefix.

`mountWorkingEnvironment` takes any object with `fold()` (structurally — `IGloveRunnable` and `IGloveBuilder` both qualify), so the package does not depend on `glove-core`.

## The tree

```
/inbox    ← mounted inputs (convention)
/scripts  ← the agent's script library + generated .d.ts siblings (/scripts/lib for utility modules)
/skills   ← worked recipes, indexed by /skills/README.md (read-only)
/std      ← materialized adapter types and docs (read-only)
/tmp      ← intermediates and spilled outputs
/out      ← deliverables (what env.export targets by convention)
/.env     ← history.jsonl + file version store (read-only to the model)
```

`/std` and `/skills` answer different questions and are read at different moments. `/std/<name>/index.d.ts` is the reference — what a module exports, exactly. A skill is a worked recipe for a task: here is a styled workbook, here is how you search a document too large to read. The distinction is not cosmetic. The most frequent errors measured across agent runs were *guessed imports* — a model reaches for a remembered shape before it reads a signature, so a correct example in front of it is worth more than a better error after the fact.

Adapters ship their own via `skills: [...]`; they are materialized alongside the builtin ones and listed in the index. The tool preamble points at `/skills/README.md` first.

## The script contract

Every runnable script **must** default-export a function. There is no program-style fallback.

```js
/**
 * Converts a CSV in the VFS to a formatted report.
 * @param {{ input: string, format?: "a4" | "letter" }} args
 * @returns {Promise<{ output: string }>}
 */
export default async function csvToReport(args) {
  // ...
  return { output: "/out/report.md" };
}
```

Validation happens at **write time**, not first-run time: any mutation producing a `.js` under `/scripts` loads the module through the environment's resolver and fails the mutation with a guardrail message if the contract isn't met. On success a sibling `.d.ts` is generated (from `fn.toString()` + the JSDoc block) so the model can learn a script's interface without reading its body. `.d.ts` files are derived artifacts — regenerated on every mutation, moved with `mv`, deleted with `rm`, never hand-edited.

Enforcement scope: `.js` under `/scripts` (excluding `/scripts/lib/**`, where named-export utility modules are allowed — they're still load-checked for syntax). `run_script` enforces the contract for any path it invokes.

Imports: relative VFS paths (`import parse from './parse_invoice.js'`), `env:*` modules, and dynamic `import()`. Bare specifiers fail with a message listing the available `env:` modules; circular imports fail with the cycle path.

## Model-facing verbs

The complete, closed set — everything the model does goes through these:

| Verb | Notes |
|---|---|
| `write_file(path, content, append?, encoding?)` | Parent dirs auto-created; scripts validated, `.d.ts` generated |
| `edit_file(path, old_str, new_str)` | str_replace semantics — exactly one match or fail with the count |
| `rm(path)` / `mv(from, to)` / `cp(from, to)` | Keep `.d.ts` siblings consistent; validate scripts at destinations |
| `read_file(path, start_line?, end_line?)` | Line-numbered, capped with an explicit tail; binary files refused |
| `ls(path?, depth?)` | `/scripts` inlines JSDoc one-liners — the listing is the capability catalog |
| `grep(pattern, path?, glob?, context?, max_matches?)` | Capped; also covers `/.env/history.jsonl` |
| `run_tests(path?)` | Runs every `*.test.js` under a path; `import * as assert from 'env:assert'` |
| `describe(path)` | Routes to whichever adapter understands the format (magic bytes, not extension); generic summary otherwise, naming a registered renderer when one could still turn the file into something readable |
| `run_script(path, args, timeout_ms?)` | `await defaultExport(args)`; result + stdout/stderr; oversized output spills to `/tmp/run-<id>.*`. `timeout_ms` budgets this run alone, clamped to `limits.runTimeoutMs` |
| `undo(path)` / `redo(path)` | Per-file linear undo (rm included); re-runs the pipeline for scripts |
| `checkpoint(action, name?)` | fork/restore/list/drop the WHOLE tree — the multi-file recovery undo cannot do |
| `diff(path, checkpoint?)` | What changed, against the version `undo` would restore or against a checkpoint — so you can see what you are about to throw away |
| `history(path?, limit?)` | Runs from `history.jsonl`, or a file's saved versions |
| `view_image(path, prompt, page?)` | **Only when a `vision` model is wired.** Look at a file and answer a question about how it LOOKS |
| `present(path, caption)` | **Only when `onPresent` is wired.** Hand a finished file from `/out` to the person, with a one-line caption |
| `ask_user(question, options?)` | **Only when `onAsk` is wired.** Put a question to the person and wait for their answer |

### Checking the work by looking at it

Everything above verifies by reading text back. That finds a wrong number and misses a table running off the page, a chart with no bars, or a title overlapping its subtitle — the defects a person notices first.

Wire a vision model and the `view_image` verb appears. Leave it out and the verb is absent from the tool set entirely; an agent is never shown a capability that would fail on use.

```ts
const env = await createWorkingEnvironment({
  stdlib: [render()],                       // glove-env-render, for documents
  vision: {
    async describe({ bytes, mediaType, prompt }) {
      return await myVisionModel(bytes, mediaType, prompt);
    },
  },
});
```

One function rather than a model adapter, so this package keeps its zero dependencies and works with whatever the host already has.

The verb takes a path and a **question**, and rasterizes documents on the way — so checking a PDF is one call, not render-then-look:

```
view_image({ path: '/out/report.pdf',
             prompt: 'This should list four regions with a total. Name every
                      region and figure you can see, and say whether any text
                      is cut off or overlapping.' })
```

`page` is 1-based and defaults to 1, so checking slide 3 of a deck is still one call — no render step, no script.

An empty prompt is refused with an example. "Describe this image" costs the same as a real question and answers far less.

Any adapter can be the renderer: declare `renders` (a `HandlesSpec`, like `handles`) alongside a `render(input, outDir, opts?)` binding. It is kept in a separate registry from `handles` on purpose — otherwise registering a renderer would steal `describe` dispatch from the module that actually understands the format.

### Handing the work over

Writing to `/out` makes a file. `present` *delivers* it — and the distinction matters because `/out` accumulates: drafts, a superseded version, the spreadsheet that fed the report. Only the agent knows which of those was the answer, so without an explicit hand-off the host is left guessing from filenames and timestamps.

Wire a receiver and the verb appears, on the same terms as `view_image`:

```ts
const env = await createWorkingEnvironment({
  onPresent: async ({ name, bytes, mediaType, caption }) => {
    await sendToUser({ name, bytes, mediaType, caption });   // upload, attach, stream — your call
  },
});
```

```
present({ path: '/out/q2-review.pptx',
          caption: 'Q2 review, 8 slides — revenue by region, with East flagged as the outlier.' })
```

- **`/out` only.** Presenting from `/tmp` would ship an intermediate; presenting from `/inbox` would echo the person's own upload back at them as work. The refusal names the fix (`cp … /out/…`), and making the agent copy the file first *is* the check — it forces a decision about what is finished.
- **The caption is required**, and an empty one is refused with an example. The person reads it instead of the filename, and "report.pdf" is not a description.
- **`mediaType` follows the extension the agent chose**, so the label agrees with the name; magic bytes only settle the extensionless case.
- **The callback is awaited** before the verb reports success, and a throw surfaces as a tool error the agent can retry — never as a crash.

### Asking the person

Some things the tree cannot answer. Two sheets are named `Revenue`; `/out/report.pdf` already exists; "active customer" means something specific in this business. Without a channel the observed behaviour is not "the agent asks in prose" — it is the agent inventing an `ask_user` tool and spending turns on *no such tool*, or, in a turn-capped loop where ending the turn to ask **is** failing the run, guessing.

Wire a receiver and the verb appears, on the same terms as `view_image` and `present`:

```ts
const env = await createWorkingEnvironment({
  onAsk: async ({ question, options }) => {
    return await promptTheHuman(question, options);   // a UI, a Slack message, a CLI readline
  },
});
```

```
ask_user({ question: 'Two sheets are named "Revenue" — Q1 has 480 rows, Q2 has 512. Which should the report use?',
           options: ['Q1 (480 rows)', 'Q2 (512 rows)', 'Both, as separate sections'] })
```

- **A verb, not an `env:` module.** A script blocking on a human would spend its own `runTimeoutMs` waiting, and a person who takes a minute to reply would kill the run.
- **Everything about the asking is the host's**: the UI, the timeout, whether `options` become buttons. Return the answer as a string; throw, and the agent is told and carries on.
- **An empty answer is reported as no answer**, never as consent — the verb tells the agent to proceed on a stated assumption rather than reading silence as yes.
- A conditional `/skills/asking.md` and one preamble line appear only when the callback is supplied, for the same reason the verb does.

### Long runs: budget, progress, cancel

A four-minute render used to be three separate problems. All three are host-side, and none changes what the model writes.

**Budget per run.** There was one `runTimeoutMs`, so permitting one slow render meant handing four minutes to every script — including the accidental `for(;;)` that then holds the warm worker for all of it.

```ts
await env.runScript('/scripts/render.js', args, { timeoutMs: 240_000 });   // host side
run_script({ path: '/scripts/render.js', timeout_ms: 240_000 })            // model side
```

Clamped to `limits.runTimeoutMs`: a caller can ask for less than the environment allows, never more. The refusal names whichever budget actually applied, so it points at the knob that would fix it.

**Progress.** Scripts already narrate with `console.log`; that output used to cross only with the final result.

```ts
execution: {
  onProgress: ({ runId, script, stream, text }) => sse.send({ type: 'progress', script, text }),
}
```

Batched in the worker, so narration inside a loop does not become the slowest thing the script does. `runId` matches `/.env/history.jsonl`. The full transcript still arrives with the result, so ignoring this loses nothing — and the worker only streams when a callback is present.

**Cancellation.** The only ways a run could end early were the global deadline and `close()`, which shuts the whole pool.

```ts
await env.runScript('/scripts/render.js', args, { signal: controller.signal });
```

`EnvTool.do` matches glove-core's fold signature — `(input, display, glove, signal)` — so an agent built with `mountWorkingEnvironment` gets this for nothing: glove already passes the active request's signal to every tool, and `run_script` now forwards it into the run. A cancelled run resolves with a cancellation error, the environment stays usable, and anything it had already handed to the host is refused rather than committed. `defineTools` capabilities receive the same signal, so a cancelled run stops the call it is sitting on.

### Telemetry

Two things a host always ends up wanting, and both were previously reverse-engineered from the examples in this repo.

```ts
const env = await createWorkingEnvironment({
  onVerb: ({ name, ok, durationMs, mutated }) => {
    metrics.timing(`env.verb.${name}`, durationMs);
    if (mutated) refreshFileTree();
  },
});

env.counters;   // { limitHits, spillovers, mutations } — read them on a schedule
```

`mutated` is **measured, not inferred from the verb's name**. A hand-maintained list of mutating verbs is wrong twice over: it drifts the moment a verb is added, and it ignores `toolsWithPrefix`, so a host that renamed the verbs matches nothing. It also cannot tell a `run_script` that wrote a file from one that only read — which is exactly when a UI should not refresh.

`EnvTool.mutates` carries the static answer for hosts that want it up front, and `tool_use_result` in glove-core now carries `duration_ms`, so per-tool latency needs no wrapper around every folded tool.

## Hosting the environment

Everything below was reverse-engineered out of [`examples/document-desk`](../../examples/document-desk) by anyone who wanted to run this in a server. It is written down here because every host arrives at the same five problems, and three of them have a wrong answer that looks right.

### The session registry

An environment is per-conversation and expensive: a worker thread, a tree on the heap, and whatever the adapters hold (`env:motion` keeps a browser warm). It has to outlive the request, so it lives in a registry — and the obvious registry is wrong:

```ts
// WRONG — two requests arriving together each build an environment.
if (!map.has(id)) map.set(id, await create(id));
return map.get(id)!;
```

Both callers pass the guard before either `create` resolves. One environment is orphaned with its worker thread alive and its `close()` never called, and the two requests act on different trees — the file one of them wrote is not there for the other. Nothing throws.

`createSessionManager` memoizes the **promise**, so concurrent callers share one create:

```ts
import { createSessionManager } from "glove-working-environment";

export const sessions = createSessionManager({
  globalKey: "__deskSessions",          // survives a dev server's module reload
  idleMs: 30 * 60_000,
  max: 50,
  async create(id) {
    const env = await createWorkingEnvironment({ stdlib: [documents(), spreadsheets()] });
    const agent = buildAgent(id);
    mountWorkingEnvironment(agent, { env });
    return { id, env, agent, listeners: new Set() };
  },
  dispose: (session) => session.env.close(),
});
```

It is generic over the session value on purpose: a real host's session is an environment *plus* an agent, its listeners, and the turn's `AbortController`. A create that rejects is not remembered, so a transient failure does not pin that id to an error for the life of the process.

`globalKey` addresses a different trap. Next's dev server re-evaluates route modules on edit, so a module-level `Map` is dropped on every save — taking every live environment and its worker threads with it, mid-conversation. Storing the manager on `globalThis` survives the reload.

### Eviction, and the turn you must not evict

A tab left open for a day accumulates threads, so sessions have to be dropped. Reaping on a timer keeps the process alive and does not exist on a serverless runtime; the workable answer is to reap on the way through whatever route is already handling a request, which is why `reap()` is cheap, idempotent, and safe to call concurrently — overlapping callers share one sweep rather than each starting their own, so a session can never be disposed twice.

```ts
const session = await sessions.get(sessionId);
void sessions.reap();                     // from every route
```

The failure a naive sweep introduces: a turn can spend four minutes inside one `run_script`, and `get` only marks the session used at the moment it hands it over. An idle sweep firing in the middle closes the worker pool under the running script, and the person is told the environment was closed part-way through their render. Take a lease for the length of the turn:

```ts
const release = sessions.hold(sessionId);
try {
  await session.agent.processRequest(message, turn.signal);
} finally {
  release();
}
```

`idleMs` (default 30 minutes) covers the ordinary case; `maxAgeMs` drops a session that never goes idle; `max` is the backstop for a burst of new conversations inside one idle window, evicting least-recently-used first. All three skip anything held.

### Streaming the turn to a browser

The agent runs server-side, so the browser sees events rather than tool calls. Two things bite:

**Match a result to its call on `id`/`name`.** A tool call arrives as `{ id, name }`; its result historically carried only `{ call_id, tool_name }`. A UI keyed on `id` throughout records the calls, never matches the results, and shows every tool spinning forever — with nothing thrown anywhere. glove-core now emits `id`/`name` on `tool_use_result` as well, so one pair of names works for both; `call_id`/`tool_name` are still emitted and are what a persisted `ToolResult` replayed from a store carries.

**Show `data`, not `message`, when a verb fails.** The verbs put a one-line summary in `message` and the whole story in `data` — the stack, the stderr, the failing line. Showing only `message` means watching "the scene never mounted" five times while the line underneath says exactly which symbol was undefined. The model sees it; the person does not.

```ts
const output = inner.status === "error"
  ? String(inner.data ?? inner.message ?? "")
  : String(inner.data ?? "");
```

**Cancel by passing the signal.** `EnvTool.do` takes glove's fold signature, so the active request's `AbortSignal` already reaches `run_script`, which forwards it into the run. Give `processRequest` a controller you abort when the browser hangs up, and a script stops instead of writing into a stream nobody is reading. The alternative — `env.close()` — throws away the whole session, warm worker and all, to stop one run.

### Files in

Uploads go to `/inbox` through `env.mount()`, which is the host door and is deliberately not subject to `readOnlyPaths`. Two rules learned the hard way:

- **Never overwrite.** Uploading `chart.png` twice must not destroy the first one — the agent may already have referenced it, and a silent overwrite is the kind of data loss nobody reports because nobody sees it. Pick a free name (`chart-2.png`) and report both the original and what it landed as, so the caller can match its own pending list without guessing the rename rule.
- **Report per file, not per request.** One bad file failing the whole request throws away the result for the good ones already written, and the caller cannot tell what landed. Return `{ files: [...], errors: [...] }` with a 200 — a status code cannot express "three landed, one was too big".

Accept anything. The environment is a filesystem, not a format allowlist: an adapter may not understand a `.heic`, but the agent can still describe it, convert it, or hand it to something that does.

### Files out

`/out` accumulates drafts as well as deliverables, so "wrote a file" is not "handed it over". `onPresent` is the explicit moment, with a caption attached — which is what a UI needs to render a download, an inline preview, or a message with an attachment. Throwing from it surfaces to the agent as a failed verb, so a rejected file (too large, wrong type, the person is gone) is something it can respond to. `env.export("/out/**")` is the bulk door for everything else.

## Stdlib adapters

An adapter bridges a real host-side library into the tree. The model experiences it as a typed importable module plus docs living at `/std/<name>/`.

These ship separately:

| Package | Module | Gives the model |
|---|---|---|
| [`glove-env-documents`](../glove-env-documents) | `env:documents` | One document spec → PDF *and* DOCX; describe/merge/split/stamp; text extraction. Plus `docx`'s own `Document`/`Packer`/`Paragraph` for anything the spec cannot express |
| [`glove-env-spreadsheets`](../glove-env-spreadsheets) | `env:spreadsheets` | `.xlsx` as plain-JSON records; describe, page, write, append, CSV bridging. Plus exceljs's own `Workbook` for styling, formats and formulas |
| [`glove-env-images`](../glove-env-images) | `env:images` | Describe without decoding; resize/convert/crop/rotate/composite/contact-sheet |
| [`glove-env-zip`](../glove-env-zip) | `env:archives` | zip/tar/tar.gz in and out; traversal- and bomb-safe extraction. No dependencies |
| [`glove-env-media`](../glove-env-media) | `env:media` | Video and audio via ffmpeg: describe, thumbnail, frames, clip, concat, transcode, slideshow |
| [`glove-env-slides`](../glove-env-slides) | `env:slides` | PowerPoint decks from a spec, read back independently — outline, slide text, notes. Plus pptxgenjs's own `PptxGenJS` for custom layouts |
| [`glove-env-render`](../glove-env-render) | `env:render` | Rasterize a PDF, deck or Word file to page PNGs — so the agent can *look* at what it made. PDFs and images need nothing installed |
| [`glove-env-motion`](../glove-env-motion) | `env:motion` | A React scene — Reanimated included — to video, GIF, PNG frames or a still. Deterministic: same scene, same bytes. Mount with `limits: MOTION_LIMITS`. Draft v0.1 |
| [`glove-env-notion`](../glove-env-notion) | `env:notion` | A Notion workspace: pages as markdown, database rows as flat records, files pulled into the tree. Databases and data sources kept distinct, as API version 2025-09-03 has them |

```ts
const env = await createWorkingEnvironment({ stdlib: [documents(), spreadsheets(), images()] });
```

### Writing one

```ts
import { defineAdapter } from "glove-working-environment";

export const images = () =>
  defineAdapter({
    name: "images",                                   // → import … from 'env:images'
    description: "Inspect and transform raster images.",
    types: IMAGES_TYPES,                              // → /std/images/index.d.ts
    docs: IMAGES_DOCS,                                // → /std/images/README.md
    handles: {                                        // → describe(path) routes here, ls names the module
      extensions: [".png", ".jpg"],
      magic: [{ bytes: [0x89, 0x50, 0x4e, 0x47] }],   // beats any extension claim
    },
    skills: IMAGES_SKILLS,                            // → /skills/<name>.md, listed in the index
    create: (vfs, ctx) => ({
      describe: async (path) => summarize(await vfs.readBytes(path)),
      resize: async (input, output, opts) => {
        await vfs.writeFile(output, await sharpResize(await vfs.readBytes(input), opts));
        return output;                                // paths in, paths out
      },
    }),
  });
```

`create(vfs)` is the capability boundary: the handle it receives routes through the same guarded gateway as the model verbs (zones, limits, script pipeline, versions). Convention: **paths in, paths out, structured data in between**, and every format adapter exposes `describe(path)` returning a tokens-cheap summary of a binary artifact plus format-appropriate extractors.

### Exposing a library's real API

A curated spec covers the common case in one call and cannot express the rest — a bold header row, a coloured run mid-sentence, a merged title cell, a landscape section. `defineBuilder` exposes the wrapped library itself, so the model writes what the library's own documentation says:

```js
import { Workbook } from 'env:spreadsheets';

const wb = new Workbook();
const ws = wb.addWorksheet('Revenue');
ws.columns = [{ header: 'Region', key: 'region', width: 24 }];
ws.addRows(rows);
ws.getRow(1).font = { bold: true };
ws.getColumn('revenue').numFmt = '#,##0';
await wb.xlsx.writeFile('/out/revenue.xlsx');
```

That is exceljs, verbatim. The point is not elegance: models have read thousands of examples of exactly this shape, and an API that differs makes them translate. Measured — the scenario that *requires* this path (styling unreachable through the curated `write()`) is the highest-delivering one in the eval suite at 15/18.

**How it works.** A live object cannot cross a thread boundary, so nothing does. The worker hands the script a recorder that logs `new`/call/get/set into a flat op list — synchronously, so the API chains exactly like the real one — and the whole list crosses once, on the terminal call. One round trip per document rather than one per call.

The recorder is built *inside* the vm context, alongside the capability closures. It has to be: everything crossing that boundary is deep-copied, and a Proxy whose behaviour lives in traps has no own keys, so a copy of one is `{}`.

```ts
const Pptx = defineBuilder<InstanceType<typeof PptxGenJS>>({
  name: "PptxGenJS",
  construct: () => new PptxGenJS(),
  allow: [...new Set([...methodsOf(probe), ...methodsOf(probeSlide)])],
  data: { ShapeType: probe.ShapeType, AlignH: probe.AlignH },   // enums read as values
  rewrite: {
    async addImage(args) {                                       // path → bytes, via the VFS
      const o = { ...args[0] };
      if (typeof o.path === "string") {
        o.data = `image/png;base64,${Buffer.from(await vfs.readBytes(o.path)).toString("base64")}`;
        delete o.path;
      }
      return [o];
    },
  },
  finish: {                                                      // the only calls that produce anything
    async writeFile(pptx, args) {
      await vfs.writeFile(args[0].fileName, new Uint8Array(await pptx.write({ outputType: "nodebuffer" })));
      return args[0].fileName;
    },
  },
});
```

Four things are not optional:

- **The allowlist is read off the library** (`methodsOf`), never typed out. A hand-written list is wrong the day the dependency adds a method, and wrong *invisibly* — the symptom is a model writing correct code from the real docs and being told the method does not exist. `methodsOf` reads property descriptors rather than invoking getters, so probing a library does not run its side effects.
- **Prototype members are refused.** Replaying a script-chosen name against a live host object would make `constructor` callable, and `constructor.constructor` is the classic route to the host realm. `defineBuilder` rejects an allowlist containing one at definition time.
- **`rewrite` for every path-taking method.** This closed a real hole found while testing something else: `addImage({ path })` made pptxgenjs open the file *itself*, off the host filesystem, so a script could name any file the process could read and have its bytes embedded in a deck it then exported. Any wrapped library taking a filename has the same hole.
- **`finish` replaces the library's own writer.** Bytes are produced in memory and land in the VFS through the guarded handle, so zones, limits and versioning apply exactly as to any other write.

Errors name the call that caused them (`call #7 addText(): …`), because the document is assembled at write time and a bare flush failure says nothing about which line was wrong.

**Libraries that are not one object.** `docx` has no root builder — a document is *assembled* from constructed values and written with a static:

```js
await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(…)] })] }] }));
```

For that, `defineBuilders` declares a **family**: members share one op list and therefore one ref table, so a `Paragraph` can be named inside a `Document`'s arguments, and a member with `singleton` (like `Packer`) is used without `new`. Recorded values are substituted as refs at any depth inside arguments — without which a recorder passed as an argument deep-copies to `{}` and the argument silently vanishes.

One limitation, stated in the skills because it is not guessable from code that looks exactly like the real library: **values cannot be read back off a builder**. The recording replays at the write, so there is nothing to return mid-build. Interpolating one yields `[PptxGenJS (recording; nothing is built until you await a terminal call)]` rather than throwing.

Two hard rules, both from the thread boundary a script call crosses: **declare every binding `Promise<…>`** even where the implementation is synchronous, and **return data, not functions or live host objects**. `auditAdapter` fails the first; the second fails at the call naming your binding.

Four things the environment does for you, which is most of why adapters are short:

- **Arguments arrive as host-realm values.** An array literal written inside a script is a context-realm `Array`: `Array.isArray` recognises it, `instanceof Array` does not, and libraries use both — exceljs reads `instanceof Array` as "a row of cells" and anything else as "a map of column names", so a script's rows silently produced an empty spreadsheet. Everything crossing inward is deep-copied (cycles, `Date`, `Map`/`Set`, typed arrays included), so a library sees plain host data and never a live reference into the sandbox.
- **Failures name the capability.** Every function reachable through `env:*` is wrapped, at any nesting depth, so a bare `Invalid PDF structure` reaches the model as `env:documents.pdf.merge: Invalid PDF structure`. In a script touching four capabilities that is the difference between one debugging round trip and three.
- **Declaring `handles` makes your `describe` reachable without a script.** The `describe` verb routes a path to whichever adapter claims it, and `ls` annotates claimed files with the module that opens them. Claims are matched from the file's head bytes without calling in, so annotating a directory of fifty documents costs fifty header reads, not fifty parses. Magic beats extension globally — declare a magic signature only where it is unambiguous (a `PK` header cannot distinguish `.xlsx` from `.docx`; both are claimed by extension instead).
- **`create` is called twice** — once normally, once bound to a filesystem that refuses mutations, because write-time validation runs module top-level code and a rejected write must leave no trace. `ctx.readOnly` distinguishes them; most adapters ignore it. Keep `create` free of side effects outside its handle.
- **Specs are checked eagerly.** `defineAdapter` rejects a bad name, a missing `description`, or absent `types` at definition time, where the author sees it — not at environment creation, in someone else's stack trace.
- **`skills` is where the worked example goes.** `types` says what you export; a skill says how to get a deliverable out of it. Ship at least two if your adapter has both a one-call path and a library path — that is the shape the three format adapters use, and the measured failure was never a misused signature.

### Pure modules: a synchronous library in one declaration

Adapter calls are async because they cross a thread — right for I/O, wrong for a library whose entire idiom is synchronous. Routing lodash through an adapter makes muscle-memory code fail *silently*: `rows.map(r => camelCase(r.name))` cannot await, an un-awaited call stringifies as `{}`, and the run reports success. Measured, not hypothetical.

`definePureModule` takes the route `env:std` already uses — the package is imported *inside the worker* and bound directly into the vm context, so calls never leave the thread:

```ts
import { definePureModule } from "glove-working-environment";

const env = await createWorkingEnvironment({
  stdlib: [
    documents(),
    definePureModule({
      name: "lodash",
      from: "lodash",                       // package name, absolute path, or import.meta.resolve(...)
      description: "Lodash utilities for shaping data.",
      pick: ["groupBy", "sumBy", "orderBy", "uniqBy", "camelCase", "cloneDeep"],
    }),
  ],
});
```

That is the whole integration — no bundling, no hand-written types, no VFS bytes. Scripts then write ordinary lodash:

```js
import { groupBy, sumBy, camelCase } from 'env:lodash';

const keys = names.map((n) => camelCase(n));        // sync, inside a callback — works
const total = sumBy(rows, 'amount');                 // no await — works
const same  = await sumBy(rows, 'amount');           // await — also works (a no-op)
```

**There is no wrong syntax**, which is the point: sync is the forgiving direction, because `await` on a plain value is a no-op while a missed `await` on a promise is silent garbage. Types and a README are generated at creation — declared synchronous, with the import line — and `pick` is verified against the real module when the environment is created, so a typo fails with the available names rather than as `undefined` in a script.

Rules of the road, each held by a test:

- **`pick` is the sandbox boundary.** These functions run in the worker's realm, outside the vm. The one dangerous class is anything that compiles strings into code — `_.template` runs `Function(source)` host-side, which is arbitrary code execution outside the sandbox. Never pick it. Prototype members are refused at definition time.
- **Callbacks work both ways.** Iteratees cross inward; a returned function (`memoize`, `curry`) crosses back as a guarded context-realm wrapper — callable, but its constructor chain dead-ends inside the sandbox.
- **Data is copied per call**, like every capability. Pure modules suit shaping work, not shared mutable state.
- **Route by shape:** I/O or genuinely async → adapter. Stateful builder written at the end → `defineBuilder`. Pure synchronous computation → `definePureModule`. A capability the host already has as a tool → `defineTools`.

### Capabilities: MCP servers and Glove tools as importable modules

The three routes above wrap *libraries*. `defineTools` wraps *capabilities* — an MCP server, a Glove tool, or a plain async function — and gives scripts a module they can import:

```ts
import { defineTools } from "glove-working-environment";
import { fnsFromMcp, fnFromTool, defineFn } from "glove-scratchpad/fns";

const env = await createWorkingEnvironment({
  stdlib: [
    documents(),
    slides(),
    defineTools({
      name: "github",
      fns: await fnsFromMcp(gh),                    // a whole MCP server
    }),
    defineTools({
      name: "workspace",
      fns: [
        fnFromTool(searchInbox),                    // a Glove tool you already fold
        defineFn({ name: "today", handler: () => new Date().toISOString() }),
      ],
      docs: "Tokens belong to the workspace bot. `since` is inclusive.",
    }),
  ],
});
```

The `ToolFn` shape is declared structurally, so `glove-scratchpad/fns`' builders drop straight in and this package keeps its zero dependencies. Anything matching `{ name, description?, inputSchema?, call(args) }` qualifies — no adapter to write.

**Why this is different from calling the tool directly.** A tool call puts its whole result in the context window. A tool call *from a script* puts the result in a variable:

```js
import { list_pull_requests } from 'env:github';
import { create } from 'env:slides';

export default async function () {
  const prs = await list_pull_requests({ repo: 'porkytheblack/glove', since: '2026-08-01' });
  const byAuthor = Object.groupBy(prs, (p) => p.author);
  await create('/out/week.pptx', {
    slides: Object.entries(byAuthor).map(([author, items]) => ({
      title: author, bullets: items.map((p) => p.title),
    })),
  });
  return `${prs.length} PRs from ${Object.keys(byAuthor).length} people`;
}
```

Two hundred pull requests, a thousand emails, a year of calendar events — the model writes the loop that reduces them and only the answer comes back. And because the capability lands beside `env:documents` and `env:slides`, "a PDF of all my emails" stops being two systems and becomes one script.

Details that matter in practice:

- **Everything is async.** These cross a thread and usually a network, which is the one shape where a missed `await` is loud rather than silent.
- **Names must be valid identifiers**, checked at definition time — a script binds them as one. MCP's `server__tool` convention already qualifies; a dash or a dot fails with the rename attached rather than producing a module nobody can import.
- **Write-time validation cannot fire a real effect.** Every script write executes the module's top level with a read-only environment. For a filesystem adapter that is merely wasteful; for a capability it would mean the email goes out when the script is *saved*. A top-level call is refused with the fix ("move it inside the default export"). Handing capabilities the tree does not soften this: the reason was never the filesystem, it is the effect on the other side, which this layer cannot see and cannot undo.
- **The tree arrives as `ctx.fs`** — the same guarded handle the format adapters get, with the same read-only zones, size limits and version recording. A capability that needs the tree is not exotic ("answer a question about this image", "post this file", "index everything under `/out`"), and without it the host has to hand `defineTools` a mutable `{ current?: env }` holder and fill it after `createWorkingEnvironment` resolves, because the module must appear in `stdlib` before the environment exists.

  ```ts
  defineTools({
    name: "vision",
    fns: [{
      name: "look",
      async call(args, ctx) {
        const bytes = await ctx.fs.readBytes(String(args.path));   // no envRef holder
        return vision.describe({ bytes, mediaType: "image/png", prompt: String(args.prompt) });
      },
    }],
  });
  ```
- **Types and docs are generated** from the input schemas — a `.d.ts` with enums as unions and a `/std/<name>/README.md` listing every capability. `docs` appends the things only the host knows: whose tokens these are, what "recent" means for this server, what not to call twice.

### Testing one

```ts
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";

const t = await createAdapterTestEnv(images());
await t.fs.writeFile("/inbox/logo.png", bytes);

const meta = await t.script(`
  import { describe } from 'env:images';
  export default async function main() { return describe('/inbox/logo.png'); }
`);
assert.equal(meta.format, "png");

const failed = await t.runScript(`…`);              // never throws; assert on failed.error
assertAdapterOk(await t.audit());
```

Adapters are tested **from inside a script**, because that is the only place they are ever used — through the realm bridge, with marshalled arguments, against the guarded VFS. Calling `create()` and poking the raw functions tests an object the model never touches.

`audit()` catches the failure mode ordinary unit tests structurally cannot: a binding that exists but is missing from `types` (the model never discovers it), or a `types` declaration with no binding behind it (the model reads the docs, writes a script, and gets `undefined is not a function`). It checks both directions, plus a `default` binding the namespace would overwrite, and warns about missing `docs` or a missing `describe`.

Builtins always present: **`env:fs`** (readFile, readBytes, writeFile, appendFile, readdir, glob, stat, exists, mkdir, rm, mv, cp — lets a script loop over fifty inputs without fifty tool calls) and **`env:std`** (json, csv, text, bytes). `/std/README.md` indexes every registered module, and the `run_script` tool description carries the list too, so a host that folds the verbs directly still tells the model what it can import.

## Execution & security model

**Capability injection, not containment.** Scripts execute in a fresh `node:vm` context per operation: available are `env:*` modules, relative VFS imports, `console` shims, and standard JS intrinsics (`JSON`, `Math`, `Promise`, `Date`, …). Absent — not blocked, *absent*: `require`, `process`, `fetch`, host fs, timers, `Buffer`, `WebAssembly`.

**That context lives in a worker thread, so the time limit is absolute.** `runTimeoutMs` used to be enforced three ways — a vm timeout, a deadline race, a re-check on every capability call — and all three missed the same case, because a vm timeout covers only a synchronous evaluation, a deadline race needs the event loop to turn, and a capability check needs the script to call something. A pure compute loop satisfies none of them. Measured with a 3s limit: the run took 60,005ms, a 100ms host timer fired *zero* times, and the run was recorded as a success. One accidental `for (;;) { await null; }` from a model took the host down.

Scripts now run in a pooled worker thread, and `terminate()` is the backstop — the only mechanism that stops running code regardless of what it is doing. The in-worker deadline usually resolves the run first with a better message; when it cannot, the thread is destroyed and replaced. Under the same probe: 3,252ms, 32 host ticks, `ok: false`, `script exceeded the wall-clock limit: 3000ms (limits.runTimeoutMs) and was terminated`. A killed worker is never handed back to the next run, so one runaway script cannot leave the environment broken.

Two consequences for adapter authors, both enforced with a named error rather than a mystery:

- **Capability calls must be `await`ed**, including ones whose host implementation is synchronous — the call is now cross-thread RPC. `auditAdapter` fails an adapter whose `.d.ts` declares a binding synchronous, because that is what makes a model write `const rows = parse(text)` and get a promise where the docs promised an array. `env:std` and `env:assert` are pure computation and run *inside* the worker, so they stay synchronous: `json.parse(text)` still returns a value.
- **Capabilities must return data**, not functions — paths, plain objects, arrays, bytes, and plain objects of those. A function or a live host reference cannot cross a thread boundary; the attempt fails naming the binding rather than hanging.

The pool is one thread per environment by default, which is right for an agent loop that runs a script at a time; `execution.size` raises it for hosts that genuinely run scripts concurrently against one environment. `env.close()` shuts the pool down.

### Lifecycle: what an idle environment costs, and how to stop paying for it

Measured with the four format adapters registered and nothing running, an environment holds **~16.5 MB and one OS thread** of steady residency — five of them at +82.5 MB and +5 threads, all returned on `close()` and none of it before. That is not a leak, it is residency, and a host with a session per conversation pays it for every tab somebody left open.

Three levels, in the order you should reach for them:

```ts
const env = await createWorkingEnvironment({
  filesystem: fromSnapshot(parked),      // resume: the tree IS the session
  stdlib: [documents(), spreadsheets()], // re-supplied; adapters are not in a snapshot
  execution: {
    idleTimeoutMs: 60_000,               // the default — reap the worker after a quiet minute
    prewarm: true,                       // and pay the next spawn off the request path
  },
});
```

- **Idle workers reap themselves.** `execution.idleTimeoutMs` (default 60s, `0` to disable) terminates a worker nobody has used; the environment stays completely usable and the next script spawns a replacement in ~82 ms — noise beside the model round trip that precedes any script. A busy worker is never touched, and the timer is `unref`'d.
- **Close on idle, resume from a snapshot.** The tree, the version rings and the adapters only come back on `close()`, so the tree is what you park: `snapshot()` → `close()` → `createWorkingEnvironment({ filesystem: fromSnapshot(snap), … })`. An identical restore now writes nothing — `/std` and `/skills` are still regenerated, but only *written* where the bytes differ, which is the difference between free and 32 network round trips on `cachedRemote`.
- **Prewarm.** `execution.prewarm: true` (or `env.warmup()`, awaitable, at a moment of your choosing) starts the pool in the background. First action measured at **~300 ms cold against ~13 ms prewarmed**. Neither can fail a create: a spawn that does not come up leaves the pool as it was, retried on demand.

**[LIFECYCLE.md](./LIFECYCLE.md)** is the full guide: a worked registry with TTL and a live ceiling, exactly what a snapshot carries and what you re-supply, sizing `N × maxVfsBytes` and `N × execution.memoryMb`, and shutting down with a grace. [`examples/document-desk`](../../examples/document-desk) implements the pattern.

**Realm isolation is what makes that stick.** Absence of a global is not isolation: in JavaScript, *any* host-realm object reaching sandboxed code hands it `value.constructor.constructor` — the host `Function` constructor — and `Function("return process")()` escapes completely. So the boundary is enforced by construction on both sides:

- Host functions are never handed over. They are wrapped by closures built *inside* the context (a closure isn't reachable through property access, so the host callee stays hidden), and every returned value is deep-copied into context-realm objects. Host errors are re-thrown as context-realm `Error`s carrying only name and message. Run arguments cross as a JSON string — a primitive — and are parsed inside the context.
- The context's sandbox object has a **null prototype**. `vm.createContext({})` backs the global with a host object, which leaves `globalThis.constructor` pointing at the host `Object` — an escape hatch entirely independent of the one above.

Both routes were live in development and are pinned by `tests/sandbox.test.ts`, which walks the reachable object graph hunting for any constructor chain that can see `process`, rather than asserting a global is undefined. Adapter authors get this for free: values returned from `create(vfs)` bindings are marshalled like anything else.

Injected namespaces are frozen, and each operation gets a fresh context, so prototype pollution or global scribbling inside one run cannot reach the next.

Honest scope note: this is a **discipline boundary for model-written code, not a hostile-code boundary**. `node:vm` is not a security sandbox — Node does not support it as one, and the isolation above raises the cost of an escape without proving none exists. Anyone who needs an adversarial boundary should be in glorp, behind a real process/container isolate.

### Known limitations

Found by adversarial audit and left open deliberately — each is a real constraint, not a rough edge:

- **Imported bindings are snapshots, not live bindings — but never silently.** `export let n` is exposed as a live getter, so `import * as ns` sees later mutations; `import { n }` binds the value at import time, where real ESM would track it. Emulating that needs reference rewriting, which the lexical transform deliberately doesn't do, so the divergence is *reported* instead: a named import of an `export let`/`export var` the module actually reassigns is refused at write time, with the `import * as ns` rewrite. Bindings that are never reassigned cannot diverge and import by name as usual.
- **Stack-trace line numbers are exact; columns can shift** by a few characters on lines the transform rewrote.
- The transform is a lexical scanner, not a parser. It is checked against real Node ESM by a differential suite — the same source imported by Node and by the environment, namespaces compared — covering templates, regex-vs-division, ASI, every import/export form (destructuring exports included: renames, defaults, rest, computed keys, nesting, holes, later declarator positions), generators, hashbangs, and import attributes — but exotic syntax may still diverge, and a divergence is a bug worth reporting.

Limits (all configurable; failures name the limit): `runTimeoutMs` 30s · `maxVfsBytes` 128MB · `maxFileBytes` 32MB · `maxToolResponseBytes` ~8KB / `maxToolResponseLines` 200 · `maxVersionsPerFile` 10 · `maxHistoryLines` 5000 · `execution.memoryMb` 256 · `execution.idleTimeoutMs` 60s.

**Sizing for a multi-tenant host.** Two of those are per-environment claims on the host, and a host running N agents in one process pays N times: `maxVfsBytes` is host heap under the default in-memory filesystem, and `execution.memoryMb` is a worker thread's heap — claimed only while a worker exists, which is what `idleTimeoutMs` bounds. The defaults assume an agent working on a handful of documents. Both err low on purpose — too low is a named error an operator raises in one line, too high is an OOM kill that takes every other agent in the process with it. [LIFECYCLE.md](./LIFECYCLE.md) works the whole policy through.

## History & recovery

`/.env/orientation.md` answers "where am I and what has happened here?" in one read — tree shape with counts, the script catalogue with one-liners, which modules those scripts use, what sits in `/out`, and the last runs. It is rebuilt on every read rather than maintained on write: a file kept current by hooks goes stale on the mutation someone forgot to hook, and a stale orientation file is worse than none because it is believed. It is not written until first read, so an environment that never asks doesn't pay for it.

### Restoring against a different set of adapters

Restoring a tree whose scripts import an adapter the host did not register is reported at startup on `env.warnings`, naming the modules and the scripts that need them — the alternative is a tree that looks healthy (`ls` shows the catalogue, the `.d.ts` files describe capabilities that no longer exist) and breaks mid-task. `strictAdapters: true` makes it throw instead. The check reads the tree, not snapshot metadata, so it works for a host-supplied persistent filesystem too.

The same facts now reach the **model**, at the top of `/.env/orientation.md`, under a heading that says the tree does not match the environment. `env.warnings` is host-only, and a host that logs it and carries on leaves the agent orienting cleanly on a tree it cannot actually run. Orientation recomputes the set on every read rather than reusing the startup scan, because `checkpoint restore` writes a stored tree in below validation — a session can acquire scripts importing an unregistered module without ever restarting.

Three restore-time failures, and what catches each:

| What changed | Caught by | When |
|---|---|---|
| The module is not registered at all | the startup scan, `env.warnings` + orientation | startup |
| A binding was renamed or removed | the run itself — the error names the missing binding | first run |
| A binding's **signature** changed, same name | `StdlibAdapter.version` | startup |

The third one is why `version` exists. Nothing else can see it: the import resolves, the call is made with arguments that no longer mean what they did, and the failure lands somewhere inside the adapter with a message about neither.

```ts
export function documents(): StdlibAdapter {
  return { name: "documents", version: "2.0.0", /* … */ };
}
```

It is the **binding contract's** version, not the package's — bump it when a signature changes, not when the implementation does. Every startup records the registered versions in `/.env/adapters.json`, so the tree carries what it was last used with (in the tree, not in snapshot metadata: no `EnvSnapshot` format bump, and it works for a persistent filesystem that never passed through `snapshot()`). The next startup compares, and a difference is reported on `env.warnings` and named in orientation, with the `.d.ts` to re-read. The version also rides beside the module in `/std/README.md` and in orientation's module list, so the model can see what it is coding against.

Skew is a **warning, never a refusal** — including under `strictAdapters`. Restoring across a version bump is the normal case (the host upgraded a dependency), and refusing to start would make every upgrade a data-loss event for anyone holding a snapshot. An adapter that declares no version opts out entirely: nothing is compared against it, no file is written, and comparing a known version against "unknown" would only produce a line nobody can act on.

Every `run_script` appends a line to `/.env/history.jsonl` (ring-buffered) — readable and grepable by the model for self-debugging, and an audit trail for the host. Every mutation records the prior file state in a per-file version ring under `/.env/versions/`, giving linear per-file `undo`/`redo` (a fresh mutation truncates the redo branch). Version storage counts against the size cap and survives snapshots.

## What has been measured

Design claims in this README are cheap; these are the ones with numbers behind them. The harness is [`examples/analyst-desk`](../../examples/analyst-desk) — an 80-page report that *cannot* be read into context, a messy 420-row export, and instructions to produce a briefing, a deck, a PDF and a styled workbook. Graded twice: deterministic checks own facts, a stronger model owns readings. 90 runs across `xiaomi/mimo-v2.5`, `minimax/minimax-m2.5` and `z-ai/glm-4.7-flash`.

| | produced the artifact | ≥80% of facts right | fully correct |
|---|---|---|---|
| **all runs** | **83/90 (92%)** | 58/90 (64%) | **49/90 (54%)** |
| xiaomi/mimo-v2.5 | 29/30 | 27/30 | **24/30 (80%)** |
| minimax/minimax-m2.5 | 29/30 | 20/30 | 18/30 (60%) |
| z-ai/glm-4.7-flash | 25/30 | 11/30 | 7/30 (23%) |

**The environment is not the bottleneck.** 92% of runs produce the deliverable — models work out the tools, write scripts, and get files into `/out`. What fails is content, and it is strongly model-dependent: mimo delivers 80% of the time at 93% fact accuracy, while glm-4.7-flash produces a file 83% of the time and gets it right 23%. That last profile is the one to watch in production — it hands you something that looks like finished work.

**The scenario needing the wrapped library's real API delivers best** (15/18), which is the argument for `defineBuilder` over a bigger options bag.

**Capabilities go the same way.** The motivating request for `defineTools` was "a deck of what was accomplished this week, going over the merges" — two systems unless they meet somewhere. Mounted as `env:github` over this repository's real `git log` (239 commits available), `z-ai/glm-4.6` did it in 18 turns for **$0.026**: read `/skills`, wrote a script, guessed one export name wrong (`getCommitsSince` — the error named `list_merges` and it edited the script), pulled **100 records into a variable**, grouped them into six themes inside the script, built the deck with `env:slides`, `describe`d its own output, and handed it over with a caption naming the counts. The only thing that reached the context window was the summary. `examples/analyst-desk/src/livecheck-capabilities.ts` asserts exactly that: a script imported the module, a `.pptx` exists, and the presented file is the deck.

**A negative result worth keeping.** `/skills` exists because guessed imports were the most frequent error. The obvious follow-up — refuse the first blind script write and point at the docs (`nudgeToDocsOnFirstWrite`) — was A/B'd over 45 runs per arm: **25/45 complete without it, 24/45 with it**, two of three models identical. It does cut genuine errored calls ~17%, and none of that converts into delivered work. It ships **off**; the errors it removes were not the ones costing runs. Recorded on [#64](https://github.com/porkytheblack/glove/issues/64).

## Still deferred

Adapter file handlers on the post-mutation hook ([#51](https://github.com/porkytheblack/glove/issues/51) — the `handles` registry and the `describe` verb shipped; `onWrite` and sidecar summaries did not).

Shipped since v1 and no longer on this list: the unified `describe(path)` verb, the test convention (`env:assert` + `run_tests`), the orientation file, the COW host-directory filesystem, model-facing `checkpoint` verbs, worker-thread execution with an absolute time limit and a heap ceiling, `/skills`, and real library APIs via `defineBuilder`/`defineBuilders`.
