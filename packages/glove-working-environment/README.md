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

```ts
import type { StdlibAdapter } from "glove-working-environment";

const documents = (): StdlibAdapter => ({
  name: "documents",
  description: "Read, compose, and render PDF/DOCX documents.",
  types: "export const pdf: { save(path: string, doc: Doc): Promise<void>; describe(path: string): Promise<PdfSummary>; ... }",
  docs: "# documents\n…worked examples…",
  create(vfs) {
    // wrap pdf-lib etc. here — ALL I/O goes through the given vfs handle
    return { pdf: { save: async (path, doc) => vfs.writeFile(path, await renderPdf(doc)), ... } };
  },
});
```

`create(vfs)` is the capability boundary: the handle it receives routes through the same guarded gateway as the model verbs (zones, limits, script pipeline, versions). Convention: **paths in, paths out, structured data in between**, and every format adapter exposes `describe(path)` returning a tokens-cheap summary of a binary artifact plus format-appropriate extractors.

Builtins always present: **`env:fs`** (readFile, writeFile, readdir, glob, stat, mkdir, rm, mv, cp — lets a script loop over fifty inputs without fifty tool calls) and **`env:std`** (json, csv, text, bytes).

## Execution & security model

**Capability injection, not containment.** Scripts execute in a fresh `node:vm` context per operation: available are `env:*` modules, relative VFS imports, `console` shims, and standard JS intrinsics (`JSON`, `Math`, `Promise`, `Date`, …). Absent — not blocked, *absent*: `require`, `process`, `fetch`, host fs, timers, `Buffer`, `WebAssembly`. Injected bindings are deep-frozen so scripts can't mutate shared adapter state.

Honest scope note: this is a **discipline boundary for model-written code, not a hostile-code boundary**. The wall-clock limit covers the synchronous prefix of every evaluation (vm timeout) and pending async work (deadline race); a script that goes CPU-bound *between* awaits can still stall the host until its next yield. Anyone needing an adversarial boundary should be in glorp.

Limits (all configurable; failures name the limit): `runTimeoutMs` 30s · `maxVfsBytes` 256MB · `maxFileBytes` 32MB · `maxToolResponseBytes` ~8KB / `maxToolResponseLines` 200 · `maxVersionsPerFile` 10 · `maxHistoryLines` 5000.

## History & recovery

Every `run_script` appends a line to `/.env/history.jsonl` (ring-buffered) — readable and grepable by the model for self-debugging, and an audit trail for the host. Every mutation records the prior file state in a per-file version ring under `/.env/versions/`, giving linear per-file `undo`/`redo` (a fresh mutation truncates the redo branch). Version storage counts against the size cap and survives snapshots.

## Deferred past v1

Unified `describe(path)` tool verb · test convention (`env:assert` + `run_tests`) · auto-maintained orientation file · adapter file handlers on the post-mutation hook · COW host-directory filesystem adapter · model-facing fork/snapshot verbs.
