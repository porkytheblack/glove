---
"glove-working-environment": minor
---

Make the environment answer well enough that a model can correct itself, and measure whether it worked.

Delivery rate across 4 models × 8 end-to-end deliverable scenarios × 2 repetitions — 64 graded runs — moved from **79.7% to 82.8%** (95% lower bound 68.3% → 71.8%). Three of the four models finish at 94–100%; together they are 46/48. The fourth is a small model that exhausted its turn budget on seven of nine failures, on scenarios the others completed in three to six calls. That is a fact about the model, not something further work here moves.

**Names correct themselves.** Reading an export an `env:*` module does not have now answers `no such export "parseRows" on env:std.csv — available: parse, rows, stringify.` The Proxy is built inside the vm context — a host-realm one would reopen the escape `tests/sandbox.test.ts` exists to catch — and carries a cycle guard, since `seal()` sets `ns.default = ns`. A named import that does not exist lists the real exports at import time rather than surfacing as `undefined` at the call site, and a bare `readFile(...)` with no import shows the import line.

**Repeating a failing call stops repeating the same answer.** Better wording has a ceiling: on one verification run a model read an improved message and recovered while another sent the same call three times against a message naming the exact fix. An identical (verb, args, error) triple now escalates — a flat statement on the second, an imperative "STOP, this has failed N times" on the third.

**Orientation is one call.** `describe(path)` routes a file to whichever adapter claims it — by magic bytes, so a PDF named `.docx` is still a PDF — and falls back to a generic summary when nothing does. Adapters declare `handles: { extensions, magic }`; the same registry lets `ls` annotate claimed files with the module that opens them, which costs a header read each rather than a parse. `/.env/orientation.md` answers "where am I and what has happened here" in one read, rebuilt on read rather than maintained on write, and not written until something asks for it.

**A test convention.** `env:assert` plus a `run_tests` verb, because the package's thesis is a compounding library and nothing protected it: editing `/scripts/lib/parse.js` silently changed every caller and the only signal was a failure three steps later.

**Whole-tree checkpoints.** `undo` is per-file and linear; `checkpoint({action:'fork'|'restore'|'list'|'drop'})` is the multi-file recovery it cannot do.

**A copy-on-write host-directory backend.** `hostDirectory(dir)` reads through to disk and keeps writes in an overlay until `commit()`, so an agent can be pointed at real data without being able to damage it. Containment is checked after symlink resolution, including the symlinked-parent case.

**Transform.** Destructuring exports work in every declarator position — renames, defaults, rest, computed keys, nesting, holes — verified by importing the same source with real Node and comparing namespaces rather than against hand-written expectations. Live bindings still diverge from ESM, but no longer silently: a named import of an `export let` the module actually reassigns is refused at write time with the `import * as ns` rewrite. Bindings never reassigned cannot diverge and still import by name.

Also: restoring a tree whose scripts need an adapter the host did not register now reports it at startup on `env.warnings` (`strictAdapters: true` throws) instead of breaking mid-task; `EnvFsHandle` exposes `limits` so adapters can refuse before doing something expensive; and `write_file` handed a non-string body names the `JSON.stringify` rather than restating its schema.

Three defects were found *by* this work and are pinned: a ReDoS in the new hint matching, which hung the audit suite rather than failing it; hints landing after the stack trace, in the one field `run_script` does not surface — the same "right message, wrong place" failure they were written to fix; and a hint that suggested `import { env:documents } from 'env:documents'`.
