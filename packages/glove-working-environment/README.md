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

Restore later:

```ts
import { createWorkingEnvironment, fromSnapshot } from "glove-working-environment";
const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(snap), stdlib: [...] });
```

`mountWorkingEnvironment` takes any object with `fold()` (structurally — `IGloveRunnable` and `IGloveBuilder` both qualify), so the package does not depend on `glove-core`.

## The tree

```
/inbox    ← mounted inputs (convention)
/scripts  ← the agent's script library + generated .d.ts siblings (/scripts/lib for utility modules)
/std      ← materialized adapter docs (read-only)
/tmp      ← intermediates and spilled outputs
/out      ← deliverables (what env.export targets by convention)
/.env     ← history.jsonl + file version store (read-only to the model)
```

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
| `write_file(path, content, append?)` | Parent dirs auto-created; scripts validated, `.d.ts` generated |
| `edit_file(path, old_str, new_str)` | str_replace semantics — exactly one match or fail with the count |
| `rm(path)` / `mv(from, to)` / `cp(from, to)` | Keep `.d.ts` siblings consistent; validate scripts at destinations |
| `read_file(path, start_line?, end_line?)` | Line-numbered, capped with an explicit tail; binary files refused |
| `ls(path?, depth?)` | `/scripts` inlines JSDoc one-liners — the listing is the capability catalog |
| `grep(pattern, path?, glob?, context?, max_matches?)` | Capped; also covers `/.env/history.jsonl` |
| `run_script(path, args)` | `await defaultExport(args)`; result + stdout/stderr; oversized output spills to `/tmp/run-<id>.*` |
| `undo(path)` / `redo(path)` | Per-file linear undo (rm included); re-runs the pipeline for scripts |
| `history(path?, limit?)` | Runs from `history.jsonl`, or a file's saved versions |

## Stdlib adapters

An adapter bridges a real host-side library into the tree. The model experiences it as a typed importable module plus docs living at `/std/<name>/`.

Three ship separately, each with its own dependencies:

| Package | Module | Gives the model |
|---|---|---|
| [`glove-env-documents`](../glove-env-documents) | `env:documents` | One document spec → PDF *and* DOCX; describe/merge/split/stamp; text extraction |
| [`glove-env-spreadsheets`](../glove-env-spreadsheets) | `env:spreadsheets` | `.xlsx` as plain-JSON records; describe, page, write, append, CSV bridging |
| [`glove-env-images`](../glove-env-images) | `env:images` | Describe without decoding; resize/convert/crop/rotate/composite/contact-sheet |

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

Four things the environment does for you, which is most of why adapters are short:

- **Arguments arrive as host-realm values.** An array literal written inside a script is a context-realm `Array`: `Array.isArray` recognises it, `instanceof Array` does not, and libraries use both — exceljs reads `instanceof Array` as "a row of cells" and anything else as "a map of column names", so a script's rows silently produced an empty spreadsheet. Everything crossing inward is deep-copied (cycles, `Date`, `Map`/`Set`, typed arrays included), so a library sees plain host data and never a live reference into the sandbox.
- **Failures name the capability.** Every function reachable through `env:*` is wrapped, at any nesting depth, so a bare `Invalid PDF structure` reaches the model as `env:documents.pdf.merge: Invalid PDF structure`. In a script touching four capabilities that is the difference between one debugging round trip and three.
- **`create` is called twice** — once normally, once bound to a filesystem that refuses mutations, because write-time validation runs module top-level code and a rejected write must leave no trace. `ctx.readOnly` distinguishes them; most adapters ignore it. Keep `create` free of side effects outside its handle.
- **Specs are checked eagerly.** `defineAdapter` rejects a bad name, a missing `description`, or absent `types` at definition time, where the author sees it — not at environment creation, in someone else's stack trace.

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

**Realm isolation is what makes that stick.** Absence of a global is not isolation: in JavaScript, *any* host-realm object reaching sandboxed code hands it `value.constructor.constructor` — the host `Function` constructor — and `Function("return process")()` escapes completely. So the boundary is enforced by construction on both sides:

- Host functions are never handed over. They are wrapped by closures built *inside* the context (a closure isn't reachable through property access, so the host callee stays hidden), and every returned value is deep-copied into context-realm objects. Host errors are re-thrown as context-realm `Error`s carrying only name and message. Run arguments cross as a JSON string — a primitive — and are parsed inside the context.
- The context's sandbox object has a **null prototype**. `vm.createContext({})` backs the global with a host object, which leaves `globalThis.constructor` pointing at the host `Object` — an escape hatch entirely independent of the one above.

Both routes were live in development and are pinned by `tests/sandbox.test.ts`, which walks the reachable object graph hunting for any constructor chain that can see `process`, rather than asserting a global is undefined. Adapter authors get this for free: values returned from `create(vfs)` bindings are marshalled like anything else.

Injected namespaces are frozen, and each operation gets a fresh context, so prototype pollution or global scribbling inside one run cannot reach the next.

Honest scope note: this is a **discipline boundary for model-written code, not a hostile-code boundary**. `node:vm` is not a security sandbox — Node does not support it as one, and the isolation above raises the cost of an escape without proving none exists. Anyone who needs an adversarial boundary should be in glorp, behind a real process/container isolate.

### Known limitations

Found by adversarial audit and left open deliberately — each is a real constraint, not a rough edge:

- **Wall-clock enforcement is not absolute.** The vm timeout covers the synchronous prefix of each evaluation, a deadline race covers pending async work, and every capability call re-checks the budget — so a runaway loop that touches `env:fs`/adapters is stopped promptly. But a pure compute loop that yields only to microtasks (`for (;;) { await null; }`) and calls nothing can still starve the event loop: a macrotask timer cannot preempt it, and a microtask watchdog would itself starve legitimate host I/O. Such a script wedges the host until the process restarts. Closing this properly requires running scripts in a worker thread that can be `terminate()`d — a v2 change, since it turns adapter calls into cross-thread RPC.
- **Imported bindings are snapshots, not live bindings.** `export let n` is exposed as a live getter, so `import * as ns` sees later mutations; but `import { n }` binds the value at import time, where real ESM would track it. Emulating that needs reference rewriting, which the lexical transform deliberately doesn't do.
- **Destructuring exports are unsupported** (`export const { a } = obj`) — rejected loudly at write time, in any declarator position.
- **Stack-trace line numbers are exact; columns can shift** by a few characters on lines the transform rewrote.
- The transform is a lexical scanner, not a parser. It is checked against real Node ESM by a differential suite covering templates, regex-vs-division, ASI, every import/export form, generators, hashbangs, and import attributes — but exotic syntax may still diverge, and a divergence is a bug worth reporting.

Limits (all configurable; failures name the limit): `runTimeoutMs` 30s · `maxVfsBytes` 256MB · `maxFileBytes` 32MB · `maxToolResponseBytes` ~8KB / `maxToolResponseLines` 200 · `maxVersionsPerFile` 10 · `maxHistoryLines` 5000.

## History & recovery

Every `run_script` appends a line to `/.env/history.jsonl` (ring-buffered) — readable and grepable by the model for self-debugging, and an audit trail for the host. Every mutation records the prior file state in a per-file version ring under `/.env/versions/`, giving linear per-file `undo`/`redo` (a fresh mutation truncates the redo branch). Version storage counts against the size cap and survives snapshots.

## Deferred past v1

Unified `describe(path)` tool verb · test convention (`env:assert` + `run_tests`) · auto-maintained orientation file · adapter file handlers on the post-mutation hook · COW host-directory filesystem adapter · model-facing fork/snapshot verbs.
