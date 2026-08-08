# glove-working-environment

## 0.2.0

### Minor Changes

- [#47](https://github.com/porkytheblack/glove/pull/47) [`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Make the stdlib adapter contract something you can write, test and trust.

  **Arguments now cross into the host as host-realm values.** Results already crossed host→script as deep copies; the reverse direction passed references, and the asymmetry was not academic. An array literal written inside a script is a context-realm `Array`: `Array.isArray` still recognises it, `instanceof Array` does not, and real libraries use both. exceljs reads `instanceof Array` as "a row of cells" and anything else as "a map of column names", so passing a script's rows straight through produced a silently empty spreadsheet — found while building the spreadsheets adapter, and every adapter author would have hit some version of it, one library at a time. Everything crossing inward is now deep-copied (cycles, `Date`, `RegExp`, `Map`/`Set`, `Error`, typed arrays included; functions pass through, since a callback cannot be copied and can do no more than the script itself). Copying also severs the live reference, so a library that retains an argument holds plain host data rather than an object whose prototype chain and getters still live inside the sandbox.

  **`defineAdapter({ name, description, types, docs, create })`** types the bindings and validates the spec at definition time — where the author sees it, rather than in someone else's stack trace at environment creation. `create` now receives `(vfs, ctx)`, where `ctx.readOnly` marks the second instantiation that backs write-time script validation.

  **Failures name the capability that raised them.** Every function reachable through an `env:*` module is wrapped, at any nesting depth, so a bare `Invalid PDF structure` arrives as `env:documents.pdf.merge: Invalid PDF structure`. In a script touching four capabilities that is one debugging round trip instead of three. Wrappers preserve `fn.name` and `fn.length`, which the realm bridge and the deadline guard were both dropping — every capability previously reached scripts as an anonymous zero-arity function. `EnvLimitError` now sets its `name`, so a script can branch on a limit rather than parse a message.

  **`glove-working-environment/testing`** ships the harness: `createAdapterTestEnv(adapter)` returns `{ env, fs, script(), runScript(), audit() }`, running adapters from inside real scripts — the only place they are ever used, and the only way to exercise the realm bridge and the guarded VFS. `audit()` catches what ordinary unit tests structurally cannot: a binding missing from `types` (the model never discovers it) or a `types` declaration with no binding behind it (the model reads the docs, writes a script, and gets `undefined is not a function`). `assertAdapterOk` turns that into a failing test.

  **Discovery.** `/std/README.md` now indexes every registered module with its one-liner and a pointer to its types, and the `run_script` tool description carries the module list too — a host that folds the verbs directly, rather than via `mountWorkingEnvironment`, no longer leaves the model to guess at its own capabilities.

  Base adapters: `env:fs` gains `appendFile`. `env:std`'s `csv.parse` now always returns records, with raw rows moved to `csv.rows` — a return type that depended on an option was a return type the model had to guess at — and `text.dedent` joins the set. Both are covered by a new suite that exercises them through the bridge, including zone refusals, limit enforcement, the read-only validation view, and byte round-trips.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Scripts can use a wrapped library's real API, not a spec invented for it.

  ```js
  import { PptxGenJS } from "env:slides";

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const slide = pptx.addSlide();
  slide.addText("Revenue", { x: 0.5, y: 0.4, fontSize: 32, bold: true });
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.1, w: 1.4, h: 0.07 });
  slide.addTable(rows, { x: 0.5, y: 1.4, align: pptx.AlignH.left });
  await pptx.writeFile({ fileName: "/out/deck.pptx" });
  ```

  That is pptxgenjs, verbatim from its own documentation. Models have read thousands of examples of exactly this, so an API that differs makes them translate — and translation is where they burn turns. The analyst-desk eval caught it directly: a model reached for `import { slides } from 'env:slides'` because the real library has a class, not a bag of verbs.

  **How it works.** A live object cannot cross a thread boundary, so nothing does. The worker records `new`/call/set into a flat op list — synchronously, so the API chains exactly like the real one — and the whole list crosses once, on the terminal call. One round trip per document rather than one per call, and no `Atomics` shim.

  The recorder is built _inside_ the vm context, alongside the capability closures. It has to be: every value crossing that boundary is deep-copied, and a Proxy whose behaviour lives entirely in traps has no own keys, so a copy of one is `{}`.

  **`defineBuilder` for adapter authors**, with three things that are not optional:

  - **The allowlist is read off the library** (`methodsOf`), not typed out. A hand-written list is wrong the day the dependency adds a method, and wrong invisibly — the symptom is a model writing correct code from the real docs and being told the method does not exist.
  - **Prototype members are refused.** Replaying a script-chosen name against a live host object would make `constructor` callable, and `constructor.constructor` is the classic route to the host realm.
  - **A `rewrite` hook for path arguments.** This closed a real hole found while testing something else: `addImage({ path })` made pptxgenjs open the file _itself_, off the host filesystem, so a script could name any host file the process could read and have its bytes embedded in a deck it then exports. Paths are now resolved through the guarded VFS handle and passed on as inline bytes. Any wrapped library that takes a filename has the same hole — the hook is how an adapter closes it.

  Errors name the call that caused them (`call [#7](https://github.com/porkytheblack/glove/issues/7) addText(): …`), because the document is assembled at write time and a bare flush failure says nothing about which line was wrong. Resolving paths at replay also moves a missing-file failure onto the `addImage()` that named it rather than the `writeFile()` that tripped over it later.

  The curated `create(spec, path)` is unchanged and still the shorter path for "just make me a deck". It is simply no longer the only one.

- [#69](https://github.com/porkytheblack/glove/pull/69) [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `cachedRemote` — back the working environment with object storage

  A third `Vfs` backend, alongside `inMemoryFs()` and `hostDirectory()`. You supply the store as four methods (`get`, `put`, `delete`, `list`) — the common denominator of S3, GCS, R2 and Azure Blob — so the package still depends on no cloud SDK.

  ```ts
  const env = await createWorkingEnvironment({
    filesystem: await cachedRemote(myStore, { prefix: `sessions/${id}/` }),
  });
  ```

  The name carries the design. Three `Vfs` methods are whole-tree operations on hot paths: `totalSize()` runs on every write (the byte-budget check) and `files()` backs glob, grep, recursive rm, directory mv/cp and checkpoint fork. Passed straight through to an object store those become a full bucket LIST per write. So the structural index — paths, sizes, mtimes, which directories exist — is built from one LIST at open and maintained in memory on every mutation; only file content crosses the network. `files()`, `list()`, `stat()`, `exists()` and `totalSize()` cost zero round trips, and reads are served from a bounded LRU (32 MiB default) because a session re-reads the same scripts and `.d.ts` siblings constantly.

  Correctness details worth knowing: the index is updated only after the store confirms a write, so a failed put leaves it honest rather than claiming a file that is not there. Object stores have no directories — a non-empty one is implied by the keys beneath it and derived on load, while `mkdir` writes a zero-byte `<key>/` marker for the empty case, and `rm` clears markers as well as content so a deleted directory cannot resurrect itself. Directory removal fans out at a bounded concurrency (16 by default) rather than firing one request per file at once.

  It is deliberately not a persistence layer. If you only want the tree to survive a restart, `env.snapshot()` to a single object is one round trip per session instead of one per file, and atomic. Reach for this when the tree genuinely outgrows the heap or other systems need the files as individual objects. There is no distributed locking — give every session its own prefix.

- [#76](https://github.com/porkytheblack/glove/pull/76) [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `defineTools` and `present` — capabilities go in, deliverables come out

  Two additions that turn the environment from a place to _compute_ into a place to _compose_.

  ### `defineTools` — mount any capability as an `env:` module

  A fourth authoring route, beside `defineAdapter`, `defineBuilder` and `definePureModule`. The first three wrap libraries; this one wraps whatever the host already has as a tool — an MCP server, a Glove tool, or a plain async function.

  ```ts
  import { defineTools } from "glove-working-environment";
  import { fnsFromMcp, fnFromTool, defineFn } from "glove-scratchpad/fns";

  const env = await createWorkingEnvironment({
    stdlib: [
      documents(),
      slides(),
      defineTools({ name: "github", fns: await fnsFromMcp(gh) }),
      defineTools({
        name: "workspace",
        fns: [
          fnFromTool(searchInbox),
          defineFn({ name: "today", handler: todayIso }),
        ],
        docs: "Tokens belong to the workspace bot. `since` is inclusive.",
      }),
    ],
  });
  ```

  **A tool call puts its whole result in the context window. A tool call from a script puts the result in a variable.** That is the whole argument, and it is the same context discipline this environment already applies to files, applied to capabilities:

  ```js
  import { list_pull_requests } from "env:github";
  import { create } from "env:slides";

  export default async function () {
    const prs = await list_pull_requests({
      repo: "you/repo",
      since: "2026-08-01",
    });
    const byAuthor = Object.groupBy(prs, (p) => p.author);
    await create("/out/week.pptx", {
      slides: Object.entries(byAuthor).map(([author, items]) => ({
        title: author,
        bullets: items.map((p) => p.title),
      })),
    });
    return `${prs.length} PRs from ${Object.keys(byAuthor).length} people`;
  }
  ```

  Two hundred pull requests, a thousand emails, a year of calendar events — the model writes the loop that reduces them and only the last line comes back. And because the capability lands beside `env:documents` and `env:slides`, "a PDF of all my emails" stops being two systems and becomes one script.

  `ToolFn` is declared **structurally**, not imported, so `glove-scratchpad/fns`' `defineFn` / `fnFromTool` / `fnsFromMcp` drop straight in while this package keeps its zero dependencies — anything matching `{ name, description?, inputSchema?, call(args) }` qualifies. A cross-package test in `glove-scratchpad` holds the two shapes together, since neither package's own build would notice them drifting.

  Details that matter in practice. Names are checked as JS identifiers at definition time, because a script binds them as one — MCP's `server__tool` already qualifies, a dash fails with the rename attached rather than producing an unimportable module. Types and docs are generated from the input schemas, with enums as unions rather than `string`. And **write-time validation cannot fire a real effect**: every script write executes the module's top level against a read-only environment, which for a filesystem adapter is merely wasteful but for a capability would mean the email goes out when the script is _saved_. A top-level call is refused, with the fix.

  ### `present` — hand a finished file over

  Writing to `/out` makes a file; `present` delivers it. The distinction earns its keep because `/out` accumulates — drafts, a superseded version, the spreadsheet that fed the report — and only the agent knows which of those was the answer.

  ```ts
  const env = await createWorkingEnvironment({
    onPresent: async ({ name, bytes, mediaType, caption }) => {
      await sendToUser({ name, bytes, mediaType, caption });
    },
  });
  ```

  Wired on the same terms as `vision`/`view_image`: no receiver, no verb, so an agent is never shown a capability that would fail on use. A matching `/skills/delivering.md` appears and disappears with it, because a recipe for a verb that is not offered is how an agent learns to hallucinate the call.

  The path must be under `/out`. Presenting from `/tmp` would ship an intermediate and presenting from `/inbox` would echo the person's own upload back at them as work — the refusal names the fix, and making the agent copy the file first _is_ the check. The caption is required and an empty one is refused with an example, since the person reads it in place of the filename. `mediaType` follows the extension the agent chose, so the label agrees with the name; magic bytes only settle the extensionless case.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `nudgeToDocsOnFirstWrite` — an opt-in that refuses the first script write of a session, once, when no docs have been opened, naming `/skills/README.md`. Resending the identical write succeeds; nothing afterwards is ever refused.

  It ships **off**, and the measurement is the reason rather than caution. A/B over 45 runs per arm (5 scenarios × 3 models × 3 reps, same build, same day):

  |                       | off       | on        |
  | --------------------- | --------- | --------- |
  | complete              | **25/45** | **24/45** |
  | genuine errored calls | 87        | 72        |

  Two of the three models scored identically. It does what it was built to do — errors fall about 17% — and that does not convert into delivered work, which is the finding worth recording: the failures it removes were not the ones costing runs.

  Kept as an opt-in rather than deleted, because it costs nothing when off and a different model mix may answer differently. Turn it on to re-measure, not because it is expected to help.

- [#47](https://github.com/porkytheblack/glove/pull/47) [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Make one bad script survivable: scripts now run in supervised, terminable worker threads.

  **`limits.runTimeoutMs` was advisory.** It was enforced three ways and all three missed the same case, because a `vm` timeout covers only a synchronous evaluation, a deadline race needs the event loop to turn, and a per-capability check needs the script to call something. A script that just computes satisfies none of them. Measured with a 3s limit: the run took 60,005ms, the host's 100ms timer fired _zero_ times, and the run was then recorded as a success. One accidental `for (;;) { await null; }` from a model — and models write that — took down every agent sharing the process. After: 3,252ms, 32 host ticks, `ok: false`, and an error naming `limits.runTimeoutMs`.

  Scripts execute in a pooled worker thread and `terminate()` is the backstop — the only mechanism that stops running code regardless of what it is doing. The supervision follows station-beacon's shape: exponential backoff on respawn, and a worker that had to be killed is destroyed rather than handed to the next run, so one runaway script cannot leave the environment permanently broken. Threads are pooled because spawning one costs ~40ms against ~0.5ms for a round trip; the default is one per environment, which is right for an agent loop that runs a script at a time.

  **A time limit is no protection against allocation**, because the process dies before the deadline arrives. Measured inside the default 30s budget, a script pushing arrays in a loop reached 7.6 GiB of host RSS — and an OOM kill takes every other agent in the process with it. Workers now carry a heap ceiling (`execution.memoryMb`, default 256): V8 terminates just that thread, the pool replaces it, and the run fails naming the option. Same probe after: 237 MiB and 261ms.

  That ceiling can be silently overridden — a process-level `--max-old-space-size` beats per-worker `resourceLimits` while still reading back the value you asked for. So the worker reports what V8 actually gave it and the environment warns once, naming the cause and the fix, because an operator who believes they have a ceiling and does not is the worst available outcome. Route it to your logger with `execution.onWarning`.

  **`close()` drains.** An in-flight run gets a bounded grace (default 5s, `close({ graceMs })`) to reach its own end before its worker is terminated — a script part-way through writing its outputs leaves half a file behind, and on a host-directory filesystem that half file outlives the process. Past the grace it is terminated and `runScript` resolves with an error saying the environment was closed, rather than hanging for the rest of `runTimeoutMs`.

  **Two contract changes for adapter authors**, both from the thread boundary a capability call now crosses:

  - **Declare every binding `Promise<…>`**, including ones whose host implementation is synchronous. `auditAdapter` fails an adapter that doesn't, because a `.d.ts` reading `parse(text): Row[]` is what makes a model write `const rows = parse(text)` and get a promise — usually surfacing much later as an empty result rather than an error. Only flagged when every declaration of a name is synchronous, so overloads and same-named callback parameters cannot trip it.
  - **Return data, not functions or live host objects.** A function cannot cross a thread; the attempt now fails naming your binding instead of hanging until the wall-clock limit.

  `env:std` and `env:assert` are pure computation and run inside the worker rather than over RPC, so they stay synchronous: `json.parse(text)` still returns a value.

  **Safer defaults.** `limits.maxVfsBytes` drops from 256 MiB to 128 MiB. With the default in-memory filesystem it is host heap, per environment, so a host running N agents in one process pays N times over. The asymmetry decides it: too low is a named error an operator raises in one line, too high is an OOM kill. Both this and `execution.memoryMb` now document that arithmetic where you set them.

  Also fixed: host stack frames could reach sandboxed code. Frames were kept by matching `/(scripts|tmp|inbox|out)/` anywhere in the line as a proxy for "a VFS path" — but `out/` and `scripts/` are ordinary directory names in a real deployment, and host `/tmp` collides with VFS `/tmp` exactly. In production those frames would have named the host application's source layout to the one party the design exists to keep it from. Frames are now kept only when the file is one the executor handed to `vm.Script`.

- [#69](https://github.com/porkytheblack/glove/pull/69) [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `definePureModule` — a host npm package exposed to scripts **synchronously**, in one declaration.

  ```ts
  const env = await createWorkingEnvironment({
    stdlib: [
      documents(),
      definePureModule({
        name: "lodash",
        from: "lodash",
        description: "Lodash utilities for shaping data.",
        pick: [
          "groupBy",
          "sumBy",
          "orderBy",
          "uniqBy",
          "camelCase",
          "cloneDeep",
        ],
      }),
    ],
  });
  ```

  Scripts then write ordinary lodash — `rows.map(r => camelCase(r.name))`, no await, inside callbacks — and it works, because the package is imported _inside the worker_ and bound directly into the vm context, the same route `env:std` takes. No bundling, no hand-written types, no VFS bytes: accurate synchronous declarations and a README with the import line are generated at creation, and every `pick` name is verified against the real module then, so a typo fails with the available names rather than as `undefined` in a script.

  Why this exists as a third route beside adapters and builders: adapter calls cross a thread, so they are async — right for I/O, silently wrong for a library whose idiom is synchronous. Measured before building this: routing lodash through an adapter made muscle-memory code stringify promises as `{}` while the run reported success. Sync is the forgiving direction — `await` on a plain value is a no-op, so **there is no syntax for a model to get wrong**, which is the design goal.

  The boundary work, each rule held by a test:

  - `pick` is required and is the sandbox boundary — these functions run in the worker's realm, outside the vm. The genuinely dangerous class is string-to-code members (`_.template` runs `Function(source)` host-side); never pick one. Prototype members are refused at definition time.
  - Callbacks cross inward (`sumBy(rows, r => r.n)` works) and returned functions cross back as guarded context-realm wrappers — `memoize` works, and its constructor chain dead-ends inside the sandbox.
  - Wrong names are corrected at _write time_, before a run is spent, exactly like any other module; a wrong `pick` or unresolvable `from` fails at environment creation naming the fix.
  - Pure modules survive worker replacement: the respawned worker re-imports them from its start message.

  Route by shape: I/O or genuinely async → `defineAdapter`. A stateful builder written at the end → `defineBuilder`. Pure synchronous computation → `definePureModule`.

- [#78](https://github.com/porkytheblack/glove/pull/78) [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `readOnlyPaths` — host-configured directories the agent can read but never edit

  The rule the environment already applies to `/std` and `/skills`, made configurable:

  ```ts
  const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
  await env.mount("./handbook.pdf", "/corpus/handbook.pdf"); // the host door stays open
  ```

  Everything under a zone stays readable, greppable and describable; every mutation — `write_file`, `edit_file`, `rm`, `mv` in **or out**, `mkdir`, `undo` — is refused with an error naming the zone and the fix (copy the file to `/tmp` and work on the copy). Enforcement lives at the core mutation gateway, so it binds every surface at once: the model verbs, scripts going through `env:fs`, and stdlib adapter handles. `env.mount()` deliberately bypasses it — seeding content the agent can only read is what the option is for — while `env.fs`, the guarded host handle, obeys the same rules as the model.

  The orientation file announces each zone as READ-ONLY up front, so the model learns the boundary by reading rather than by being refused. Zone directories are created at startup so they are discoverable in `ls` before anything is mounted. Bad configurations (`"/"`, relative paths) fail at creation, to the host.

  Pairs naturally with `hostDirectory` for the headline case — hand an agent a real project where some subtrees are reference-only:

  ```ts
  const env = await createWorkingEnvironment({
    filesystem: hostDirectory("./project"),
    readOnlyPaths: ["/src"], // read and grep the source; write only elsewhere
  });
  ```

  Like `stdlib`, the option is not stored in snapshots — the host re-supplies it on restore.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3) Thanks [@porkytheblack](https://github.com/porkytheblack)! - The wrapped libraries are now reachable in full — exceljs and docx as well as pptxgenjs — and the recording protocol grew what those two needed.

  ```js
  import { Workbook } from "env:spreadsheets";

  const wb = new Workbook();
  const ws = wb.addWorksheet("Revenue");
  ws.columns = [
    { header: "Region", key: "region", width: 24 },
    { header: "Revenue", key: "revenue", width: 18 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.getColumn("revenue").numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile("/out/revenue.xlsx");
  ```

  ```js
  import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
  } from "env:documents";
  import { writeFile } from "env:fs";

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Q3 Review", heading: HeadingLevel.TITLE }),
          new Paragraph({
            children: [
              new TextRun({ text: "Revenue rose " }),
              new TextRun({ text: "18%", bold: true, color: "C00000" }),
            ],
          }),
        ],
      },
    ],
  });
  await writeFile("/out/review.docx", await Packer.toBuffer(doc));
  ```

  Both are the libraries' own code, unchanged from their documentation. The curated `write(path, rows)` and `docx.create(path, spec)` stay and are still the shorter path; they were simply the only path, and everything they did not name — a bold header, a number format, a merged title, a coloured run, a bordered table, a landscape section — was unreachable.

  **Three additions to the recording protocol**, each one a library making a demand:

  - **Property reads.** `workbook.xlsx.writeFile(...)` is a read followed by a call, and at `wb.xlsx` the recorder cannot yet know which it is — `ws.addRow(...)` is a call at exactly the same syntactic position. A property now records lazily: calling it records a call, reading through it records the access first.
  - **Constructed values as arguments.** `new Document({ children: [new Paragraph(...)] })` needs the paragraph to be nameable inside the document's arguments. This was also a latent correctness bug: a recorder node passed as an argument deep-copied to `{}` on its way to the host, so the argument silently vanished. Nodes are now substituted as refs and resolved at replay, at any depth inside objects and arrays.
  - **Builder families.** `docx` has no root object to call methods on — a document is _assembled_ out of constructed values and written with a static, `Packer.toBuffer(doc)`. Constructors declared in one family record into one op list, so a value built by one can be handed to another, and `Packer` is a member used without `new`.

  `defineBuilders` is the general form; `defineBuilder` is now the single-constructor case of it. `methodsOf` reads descriptors instead of invoking getters — building an allowlist by reading every property runs library code for its side effects, which is how exceljs's deprecated `tabColor` came to print a stack trace on every adapter construction.

  **Adapters can ship skills.** `StdlibAdapter.skills` was declared and unused; `defineAdapter` now accepts it, and slides, documents and spreadsheets each ship two — one for the one-call path, one for the library. `/std/<name>/index.d.ts` says what a module exports; a skill says how to get a deliverable out of it, and the measured failure was never a misused signature.

  **Two fixes found by running the eval against this, both regressions the feature itself introduced:**

  - Exporting docx's vocabulary made `env:documents` answer a wrong import with forty names, burying the verb the model was reaching for. The correction now leads with the module's own verbs in full and counts the library's classes, pointing at `/skills/imports.md` for the rest. Applied on both paths that answer a bad name.
  - Interpolating a builder into a string threw `Cannot convert object to primitive value` — a recorder had no `toString`, no `valueOf` and no `Symbol.toPrimitive`, so an ordinary debug string was fatal. Both now render as `[PptxGenJS (recording; nothing is built until you await a terminal call)]`. It is answered inside the sandbox and records nothing, so `constructor`, `valueOf` and `__defineGetter__` are still refused.

  Measured on the analyst-desk eval: the scenario that _requires_ the library path — styling unreachable through the curated `write()` — is the highest-delivering in the suite at 15/18, across three models that had never seen this API.

- [#47](https://github.com/porkytheblack/glove/pull/47) [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Make the environment answer well enough that a model can correct itself, and measure whether it worked.

  Delivery rate across 4 models × 8 end-to-end deliverable scenarios × 2 repetitions — 64 graded runs — moved from **79.7% to 82.8%** (95% lower bound 68.3% → 71.8%). Three of the four models finish at 94–100%; together they are 46/48. The fourth is a small model that exhausted its turn budget on seven of nine failures, on scenarios the others completed in three to six calls. That is a fact about the model, not something further work here moves.

  **Names correct themselves.** Reading an export an `env:*` module does not have now answers `no such export "parseRows" on env:std.csv — available: parse, rows, stringify.` The Proxy is built inside the vm context — a host-realm one would reopen the escape `tests/sandbox.test.ts` exists to catch — and carries a cycle guard, since `seal()` sets `ns.default = ns`. A named import that does not exist lists the real exports at import time rather than surfacing as `undefined` at the call site, and a bare `readFile(...)` with no import shows the import line.

  **Repeating a failing call stops repeating the same answer.** Better wording has a ceiling: on one verification run a model read an improved message and recovered while another sent the same call three times against a message naming the exact fix. An identical (verb, args, error) triple now escalates — a flat statement on the second, an imperative "STOP, this has failed N times" on the third.

  **Orientation is one call.** `describe(path)` routes a file to whichever adapter claims it — by magic bytes, so a PDF named `.docx` is still a PDF — and falls back to a generic summary when nothing does. Adapters declare `handles: { extensions, magic }`; the same registry lets `ls` annotate claimed files with the module that opens them, which costs a header read each rather than a parse. `/.env/orientation.md` answers "where am I and what has happened here" in one read, rebuilt on read rather than maintained on write, and not written until something asks for it.

  **A test convention.** `env:assert` plus a `run_tests` verb, because the package's thesis is a compounding library and nothing protected it: editing `/scripts/lib/parse.js` silently changed every caller and the only signal was a failure three steps later.

  **Whole-tree checkpoints.** `undo` is per-file and linear; `checkpoint({action:'fork'|'restore'|'list'|'drop'})` is the multi-file recovery it cannot do.

  **A copy-on-write host-directory backend.** `hostDirectory(dir)` reads through to disk and keeps writes in an overlay until `commit()`, so an agent can be pointed at real data without being able to damage it. Containment is checked after symlink resolution, including the symlinked-parent case.

  **Transform.** Destructuring exports work in every declarator position — renames, defaults, rest, computed keys, nesting, holes — verified by importing the same source with real Node and comparing namespaces rather than against hand-written expectations. Live bindings still diverge from ESM, but no longer silently: a named import of an `export let` the module actually reassigns is refused at write time with the `import * as ns` rewrite. Bindings never reassigned cannot diverge and still import by name.

  Also: restoring a tree whose scripts need an adapter the host did not register now reports it at startup on `env.warnings` (`strictAdapters: true` throws) instead of breaking mid-task; `EnvFsHandle` exposes `limits` so adapters can refuse before doing something expensive; and `write_file` handed a non-string body names the `JSON.stringify` rather than restating its schema.

  Three defects were found _by_ this work and are pinned: a ReDoS in the new hint matching, which hung the audit suite rather than failing it; hints landing after the stack trace, in the one field `run_script` does not surface — the same "right message, wrong place" failure they were written to fix; and a hint that suggested `import { env:documents } from 'env:documents'`.

- [#76](https://github.com/porkytheblack/glove/pull/76) [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Look at the work, not just its text: `view_image` and `env:render`

  Every verification route in this environment read text back, which finds a wrong number and misses everything about how a document LOOKS — a table running off the page, a chart with no bars, a title overlapping its subtitle, a final slide that came out blank. Those are the defects a person notices in the first second, and the eval measured the gap: 92% of runs produced a deliverable, 54% were fully correct.

  **`glove-env-render`** rasterizes to PNG inside the VFS. PDFs and images go through `pdfjs-dist` on `@napi-rs/canvas` with no system dependency; `.pptx`/`.docx`/`.xlsx` go through headless LibreOffice, and the adapter detects the specific case where `libreoffice-core` is installed without its import filters — which fails every conversion while exiting 0 — and names the package to install. Format is decided by magic bytes then extension, so a PDF named `.pptx` never reaches LibreOffice. Renders are capped at 1600px on the long edge, because a vision model charges by pixels and reads an A4 page perfectly well at that size.

  **`view_image`** is a new verb in `glove-working-environment`, present only when the host wires `vision`:

  ```ts
  const env = await createWorkingEnvironment({
    stdlib: [render()],
    vision: {
      async describe({ bytes, mediaType, prompt }) {
        /* your provider */
      },
    },
  });
  ```

  One function, deliberately — not a model adapter — so the package stays free of a `glove-core` dependency. Without it the verb is absent from the tool set entirely: an agent is never shown a capability that would fail on use.

  It takes a path and a **question**, and rasterizes documents on the way, so checking a PDF is one call rather than render-then-look. An empty prompt is refused with an example, because "describe this image" costs the same as a real question and answers far less. Adapters can now declare `renders` alongside `handles`, kept in a separate registry so registering a renderer cannot steal `describe` dispatch from the module that understands the format.

  Verified end to end against a real vision model on a report carrying two deliberate defects — a row pushed off the right edge and a subtitle overlapping the title. It reported both.

  **Scale.** Spawning `soffice` per file costs ~1s of process start, and no tuning removes it — every platform rendering Office documents in volume keeps LibreOffice warm behind a queue (Gotenberg, unoserver, JODConverter, Collabora). So `render({ convertOffice })` hands the conversion to whatever you already run, and `soffice` is never invoked. Without it, conversions lease from a pool of reused profiles instead of building a fresh one each time: measured at 8 conversions per arm, interleaved, medians 1019ms vs 1297ms — about 21%, with a much tighter spread (986–1183 against 1089–2016).

  **One call, any page.** `view_image` takes `page` (1-based, default 1) and pushes it down to the renderer, so checking slide 3 of a deck needs no render step and no script. Driven live through `examples/document-desk`, an agent asked to "verify it looks right" called `view_image` seven times across pages 1, 2 and 5 — and the vision model caught a duplicated heading ("repeated twice with the same text, one larger and one slightly smaller"), which the agent then fixed and re-checked.

  The environment preamble now mentions the verb, but **only when a vision model is wired** — priming a model to reach for a tool that is not in its list buys a wasted call and a confusing failure. `examples/document-desk` wires both `env:render` and an OpenAI-compatible vision endpoint, and omits the verb when no key is present.

  **A deck is verifiable with nothing installed.** `.pptx` no longer fails when LibreOffice is absent — it is drawn from its own OOXML geometry as a **layout schematic**: every shape's real frame and real text, to scale, with no theme, fonts, charts or master-slide inheritance. The result carries `approximate: true` and the image is captioned as a schematic, so nothing downstream can mistake it for a render. It catches the positional defects, which is most of what goes wrong: a box off the slide (drawn outside the white area in red), text overflowing its box, a slide with nothing on it.

  Two details in it exist because a vision model got them wrong first. Drawing "(this slide is empty)" onto an empty slide made the model answer _"yes, this slide has content"_ — it read the notice as content, so the fact moved to the caption and the slide is left genuinely blank. And the caption now says "thin rectangles are shape frames, not visible borders", because without that a model read a frame as a clipping boundary and reported a title cut off that was not. With both, asked to list the text and flag anything outside the slide, it named the on-slide text correctly and flagged only the genuinely off-slide box. `schematicFallback: false` restores the LibreOffice error.

- [#47](https://github.com/porkytheblack/glove/pull/47) [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce `glove-working-environment` — a small, fast, in-memory, sandboxed persistent working environment for LLM agents (v1 of the approved design).

  Sandbox isolation is enforced by realm separation, not by the absence of globals: host functions are wrapped by closures built inside the vm context and every value crossing back is deep-copied into context-realm objects, because any host-realm object reaching sandboxed code exposes `value.constructor.constructor` — the host `Function` constructor — and with it `process`. The context is created from a null-prototype sandbox object for the same reason (`vm.createContext({})` leaves `globalThis.constructor` pointing at the host `Object`). Mutations are transactional (everything that can fail is checked before the first byte is written), write-time validation runs against a read-only filesystem so a rejected write leaves no trace, and mutations are serialized so concurrent writers can't destroy undo history. Known limitations — chiefly that a pure microtask loop calling no capabilities can still starve the host, and that imported bindings are snapshots rather than live bindings — are documented in the README. One persistent, snapshottable virtual tree (`/inbox`, `/scripts`, `/std`, `/tmp`, `/out`, `/.env`) behind a closed verb surface (`write_file`, `edit_file`, `rm`, `mv`, `cp`, `read_file`, `ls`, `grep`, `describe`, `run_script`, `run_tests`, `checkpoint`, `undo`, `redo`, `history`). All execution goes through named scripts that must `export default async function (args)` — validated at write time, with a derived sibling `.d.ts` generated from the signature + JSDoc via a single post-mutation hook, so `ls /scripts` doubles as a self-documenting capability catalog. Scripts run in a `node:vm` scope built by capability injection: `env:fs` / `env:std` builtins, registered `StdlibAdapter`s (materialized read-only under `/std`), relative VFS imports with cycle detection — no `fetch`, `process`, `require`, host fs, or timers, by absence rather than blocking. Context-window discipline throughout: line-capped reads, capped grep, oversized run output spilled to `/tmp/run-<id>.*`. Per-file linear undo/redo rings and a ring-buffered `/.env/history.jsonl` run log cover recovery and self-debugging; host-side doors (`mount` / `export` / `snapshot` / `fromSnapshot`) move data across the boundary. Zero-dependency core; `mountWorkingEnvironment(glove, { env })` folds the verbs onto any Glove agent structurally, without importing glove-core.

### Patch Changes

- [#47](https://github.com/porkytheblack/glove/pull/47) [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Fix the three things real agents actually tripped over.

  Four models were run through four end-to-end deliverable scenarios via OpenRouter (`benches/working-environment-bench`). Of 38 errored tool calls, three classes accounted for 16 of them — and none was a crash. They were messages that sent the model the wrong way.

  **Running a script that does not exist reported `no such module`.** That is the _import resolver's_ error, surfacing on a verb the model called with a path, so it reads as a dependency problem rather than "you have not written this yet". It now says `no such script: /scripts/x.js` and lists the scripts that do exist — or that `/scripts` is empty and to `write_file` first. Directories and non-`.js` targets are refused in their own terms too.

  **Running or importing anything under `/std` was incoherent.** Models read `/std/documents/index.d.ts` and then reach for that _path_ — reasonably, since every verb in the surface takes an absolute path. Running it tried to evaluate a `.d.ts` as a module (`could not parse export statement`, from a file the model had just been told to read as documentation); importing it reported a missing file. Both now say that `/std` holds documentation and name the specifier to use instead — and the import case is caught at _write_ time, so the script is never stored.

  **`readdir` returns entry objects; Node's returns strings.** Every `f.endsWith is not a function` in the run came from `entries.filter(f => f.endsWith('.png'))`. The `env:fs` types now say so at the point of use and point at `glob()`, which returns full paths and filters in one step.

  Also silences pdfjs, which narrated font substitution to stderr on every `extractText` call. Pointing it at the bundled fonts made it worse — pdfjs 5 ships Foxit faces but asks for Liberation ones — so verbosity is set to errors-only. Real failures still throw.

  The remaining friction class, models guessing binding names (`csv.parseRows`, `readFile is not defined`), is filed rather than fixed: the runtime knows what is available and could say so, but doing it through a `Proxy` has to happen inside the vm context or it reopens the realm leak the sandbox tests exist to catch.

- [#47](https://github.com/porkytheblack/glove/pull/47) [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New adapter: `glove-env-archives` — zip, tar and tar.gz inside the VFS.

  Archives are how batches of files actually arrive: an export from another system, a bundle of scans, a customer's data dump. An agent handed `/inbox/records.zip` was simply stuck — nothing in the environment could open it. They are also the natural way to hand a multi-file deliverable back, as one file rather than an array the host has to write out itself.

  `describe` and `list` answer what is in an archive without extracting it; `extract(path, dir, { include })` takes only what is wanted; `create(dir, output)` packages a directory back up. Dependency-free — ZIP and tar are stable container formats and `node:zlib` supplies the only hard part.

  **Extraction is the part that has to be right, and it is where the tests are.** A zip reader that round-trips its own output but writes `/etc/passwd` when handed a hostile archive has failed at the only job that is hard.

  - _Traversal._ `../../etc/passwd`, absolute paths, backslash separators, `safe/../../../escaped` — refused by name. The check is on the **resolved** path rather than the spelling, since `a/../../b` normalises away before any string comparison would catch it. `a/../b.txt`, which resolves back inside the destination, is allowed: refusing it would reject archives real tools produce.
  - _Decompression bombs._ The declared uncompressed size is attacker-controlled, so it is checked **and** the decompression itself is capped. A zip declaring ten bytes that expands to five megabytes fails at the cap, not at the claim; `.tar.gz`, which has no declared size at all, is capped before the tar is parsed.
  - Entry counts are bounded, extracted bytes count against `maxVfsBytes` like any other write, and nested archives are not extracted recursively.

  Encrypted entries, ZIP64, unsupported compression methods, and tar symlinks/devices/hard links are refused explicitly rather than half-read — a silently-wrong extraction is worse than a failed one.

  Format is detected from the bytes, not the extension: a zip named `.tar` is read as a zip. Archives are claimed by the `describe` verb too, so orientation needs no script.

  Alongside it, `EnvFsHandle` now exposes the environment's `limits`. Adapters previously had no way to see the caps they were working inside, so they could only fail late — after inflating an archive that was never going to fit. The gateway still enforces every write; what this buys is the chance to refuse first.

  The glob matching for `include` reuses the core's `globToRegExp` rather than a second implementation. The hand-rolled one shipped with a bug (`**/*.csv` missed files at the archive root), which is the argument against having two.

- [#66](https://github.com/porkytheblack/glove/pull/66) [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988) Thanks [@porkytheblack](https://github.com/porkytheblack)! - New adapter: `glove-env-slides` — build PowerPoint decks and read them back.

  A deck is the one artifact an agent is routinely asked to _produce_ rather than consume, and the environment had no way to make one: `env:documents` writes PDF and DOCX, which are the wrong shape for something meant to be presented.

  ```js
  import { create } from "env:slides";

  await create(
    {
      title: "Q3 Review",
      footer: "Confidential",
      slides: [
        {
          title: "Headline",
          metric: { value: "$4.2M", caption: "revenue, up 12% QoQ" },
        },
        {
          title: "By region",
          table: [
            ["Region", "Revenue"],
            ["EMEA", "$1.8M"],
          ],
        },
        {
          title: "Risks",
          bullets: ["Covenant headroom is thin"],
          notes: "Expect a question here.",
        },
      ],
    },
    "/out/q3.pptx"
  );
  ```

  `describe()` returns the outline — slide count and every title — for a few dozen tokens, because no deck is small enough to read blind. `extract()` returns each slide's text and speaker notes, and `outline()` flattens the deck to markdown you can write to a file and `grep`, which costs a fraction of pulling thirty slides through the response cap.

  **Writing goes through pptxgenjs; reading does not.** Verifying a writer with its own library proves only that it is self-consistent — a title written into the wrong placeholder round-trips perfectly through the library that made the mistake. Reading goes through this package's own ZIP + OOXML reader, which is also the only way to open a deck the environment did not write, and that is most of the review work an agent is actually asked to do. One test skips both readers and runs the system `unzip` to CRC-check the archive and assert every OOXML part the spec requires is present, so a deck only our own code can open still fails.

  Two things that reader gets right and a naive one does not, both found by the tests rather than by reasoning:

  - **Runs are joined within a paragraph.** PowerPoint splits one visual line into several `<a:t>` runs wherever formatting changes, so "Revenue **grew** 12%" is three runs and a naive reader reports three bullets where there is one.
  - **Footers live on the slide master.** Stamped into each slide's own XML, a footer comes back as a body line on every slide — thirty copies of "Confidential" in a thirty-slide deck, inherited by any summary built from the text. Chrome is not content.

  Claims `.pptx` by extension only, deliberately: a pptx is a ZIP and so are `.docx` and `.xlsx`, so claiming the `PK` signature would steal every Office file from the adapter that owns it. `describe()` verifies by looking for `ppt/slides/` inside.

  Also in `glove-working-environment`: the heap-ceiling warning is now reported once per process rather than once per environment. The condition it describes is a property of the process — one flag affecting every worker it will ever start — so a host creating an environment per conversation, or a test suite creating thirty, was getting the same unchanging sentence repeated until it read as log noise. A host that passes its own `execution.onWarning` still gets every occurrence, since that is the caller asking to be told.

- [#81](https://github.com/porkytheblack/glove/pull/81) [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80) Thanks [@porkytheblack](https://github.com/porkytheblack)! - README: list `env:render` and pair `env:motion` with `MOTION_LIMITS`

  The adapter table had a gap — `glove-env-render` was missing from it despite being the module the `view_image` verb depends on. The `env:motion` row now also names `MOTION_LIMITS`, since mounting the adapter without raising `runTimeoutMs` means every render is refused up front.

- [#80](https://github.com/porkytheblack/glove/pull/80) [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `present` labels video and audio deliverables correctly

  `env:motion` renders `.mp4` and `.webm`, and `present` was handing both to the host as `application/octet-stream` — the media type a host uses to decide between a player and a download prompt. Video (`mp4`, `webm`, `mov`, `mkv`) and audio (`mp3`, `wav`, `m4a`, `ogg`) now resolve to their real types, alongside the document and image entries that were already there.
