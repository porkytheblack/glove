# Workspaces: scratchpad, REPLs, VFS, working environment, browsers and sandboxes

> Read when the model should work in code and files instead of a long tool list: glove-scratchpad (SQL over capabilities), glove-js/python/lisp REPLs, glove-vfs, glove-working-environment and its glove-env-* adapters, and glove-execution browsers and sandboxes.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Scratchpad (`glove-scratchpad`)

A **database emulator for LLM tool use.** Instead of loading dozens of tool definitions into the context window, expose an agent's capabilities as a relational database it queries with a **single `execute_sql` tool**. The model already knows SQL fluently at every size, so it discovers, invokes, and composes capabilities by writing queries. **Resources become tables** — a resource is an entity/data type (`github_pr`, `linear_issue`, `emails`, `time`, `images`) and its CRUD verbs map to (possibly different) underlying tools.

It is, at heart, a SQL interpreter: every statement is parsed and inspected *before* any tool runs. That buys discovery (`information_schema`), composition (JOINs / `INSERT … SELECT`), preview (`EXPLAIN`, transactions), and a real security surface (a syntax tree you can reject) — for free, because the database already solved them decades ago.

### When to use it

- The agent has many capabilities and loading every tool definition bloats context. One `execute_sql` tool replaces the whole catalogue; the model discovers capabilities via `information_schema`.
- You want to **compose** across services in one statement (`INSERT INTO notion_page SELECT … FROM github_pr WHERE merged`) without intermediate rows round-tripping back into context.
- You want to **stage and preview** outbound effects (approval-gated writes) with `BEGIN … COMMIT`, or dry-run with `ROLLBACK`.
- You're bridging a large MCP fleet and want a uniform, queryable shape over it (`glove-scratchpad/mcp`).

If you only need a handful of first-party tools, plain `glove.fold(...)` is simpler. Scratchpad earns its keep when the catalogue is large or you want composition/preview.

### Quick start

```ts
import { Database, resourceFromTool, defineResource, mountDatabase } from "glove-scratchpad";
import { z } from "zod";

const db = await Database.create({ policy: { writes: true } });   // writes off by default

// A read-only tool → a one-row `time` table. Columns come from a Zod schema.
db.register(resourceFromTool(getTimeTool, {
  name: "time", volatility: "stable",
  schema: z.object({ now: z.date(), tomorrow: z.string() }),
}));

// A search tool → a volatile `web` table; the tool's required `query` input
// becomes a required-key column pushed down through WHERE.
db.register(resourceFromTool(searchTool, {
  name: "web", volatility: "volatile",
  schema: z.object({ title: z.string(), url: z.string() }),
}));

mountDatabase(agent, { db });   // folds execute_sql (+ explain_sql) and primes the prompt
```

The model then works entirely in SQL: `SELECT table_name FROM information_schema.tables`, `SELECT title, url FROM web WHERE query = 'sql engines'`, etc.

### Resources as tables (Zod-first)

A resource is an entity with columns and any subset of CRUD verbs, each wired independently. **Define it with a Zod `schema` and one object is your columns AND your end-to-end row type** — the schema flows into every resolver, so `select` returns rows of it, `insert` takes them, `update`'s `set` is a partial, and `bindings.one("col")` autocompletes the schema's column names. A typo in a column, key, or write payload is a compile error, not a silent runtime bug.

```ts
import { z } from "zod";

const githubPr = defineResource({
  name: "github_pr",
  volatility: "stable",
  schema: z.object({
    number: z.number().int().describe("PR number"),   // an API argument (see keys)
    title: z.string(),
    merged: z.boolean(),
  }),
  keys: ["number"],                                    // required WHERE-pushdown key(s), typed to the schema
  select: (b) => listPrs({ number: b.one("number") }), // SELECT → a list/get tool (b.one autocompletes columns)
  insert: (rows) => createPr(rows[0]),                 // INSERT → a create tool (rows typed to the schema)
  update: (set, b) => updatePr(b.one("number"), set),  // UPDATE → an update tool (set: Partial<row>)
  delete: (b) => closePr(b.one("number")),             // DELETE → a close tool
});
```

Each verb is OPTIONAL and independently wired: a read-only `time` has only `select`; an `emails` (send) resource is `insert`-only; an `images` generator is a `select`-shaped but **volatile** function-as-relation (`SELECT url FROM images WHERE prompt = '…'` — `prompt` is an argument). Verb presence is the capability gate: SELECTing a write-only resource, or writing one with no writer, is a clear error. Required-key columns are auto-stamped from the pushed-down WHERE, so a `select` may omit them.

**Zod → Postgres type mapping** (via `columnsFromZod`, exported standalone):

| Zod | Postgres column type |
|-----|----------------------|
| `z.number().int()`, `z.bigint()` | `bigint` |
| `z.number()` | `double precision` |
| `z.boolean()` | `boolean` |
| `z.string()` | `text` |
| `z.date()`, `z.iso.datetime()` | `timestamptz` |
| `z.object(...)`, `z.array(...)`, unrepresentable | `jsonb` (reachable via `-> / ->>`) |
| any field `.meta({ pgType: "…" })` | that exact type (override wins) |

`.describe(...)` on a field becomes the column description — that's where authors put enum / allowed-value hints (`status: unresolved | resolved | ignored`) the model reads via `information_schema` and the primed catalog. Prefer the schema, but a raw `columns: [{ name, type, requiredKey? }]` list still works when you'd rather write the pg types by hand.

`resourceFromTool(tool, spec)` is the convenience for the trivial single-verb case (turn ONE tool into a one-verb resource). It derives required-key columns from the tool's own input schema (a required Zod field or `jsonSchema.required` entry) and takes `schema` (or `columns`) for the OUTPUT columns; `op` picks the verb (default `"select"`). A volatile SELECT MUST declare its columns (a stable schema can't be inferred from a zero-row first call).

### Volatility

Every resource declares Postgres's `immutable | stable | volatile`. The interpreter resolves a resource EXACTLY ONCE per `execute` regardless (so an effectful read is never invoked N times by the planner); volatility additionally governs caching:

- **immutable** — cached for the database's lifetime (pure lookups).
- **stable** — cached within one `execute` (a turn-stable read, e.g. `time`).
- **volatile** — re-resolved each statement, never cached (effectful/nondeterministic reads and all writes).

### How a query runs (pre-resolution)

`glove-sql` is synchronous; resources are async and effectful, so `Database.execute` can't hook resolution inside the engine — it **pre-resolves**: **parse** → **security-gate** (statement-kind whitelist, read-only by default, `CREATE`/`DROP` refused, multi-statement only as a `BEGIN … COMMIT` script) → **collect** every referenced relation → **push down** the `WHERE`/`JOIN-ON` equalities as arguments (missing required keys are a clear error) → **resolve** each resource once → **materialize** its rows into the engine → **run** the now-synchronous query → **tear down** the ephemeral tables. Resolving once up front is what makes the volatility guarantee hold.

Read-your-writes: `policy.readYourWrites` (default true) folds this session's own fired writes back into later reads of the same table, so a row you INSERT shows up in a subsequent SELECT even though the upstream live view hasn't caught up.

### Discovery, transactions, EXPLAIN

- **Discovery is `information_schema`.** No separate step — resources are advertised in `information_schema.tables` / `.columns` (via a catalog callback), so the agent lands in an unfamiliar database, lists tables, inspects columns, and figures out its own capabilities.
- **Transactions = preview & staging.** A write against a resource is a side-effecting tool call. Inside `BEGIN … COMMIT` it is **staged**, not fired — recorded with the exact resolver + arguments. `db.preview()` (and the `staged` field on the result) is the approval surface; `COMMIT` fires them in order; `ROLLBACK` discards — a true dry run. A single write outside a transaction fires immediately. Writes are off unless the `Database` is created with `policy: { writes: true }`.
- **EXPLAIN** (`db.explain(sql)`, the `explain_sql` tool, or `EXPLAIN <stmt>` through `execute_sql`) runs the pre-pass only — **no resolver calls** — and reports which resources a statement will hit, each one's volatility, read/write access, and the resolved arguments. Explaining a `generate_image` query costs nothing.

### MCP servers → tables (`glove-scratchpad/mcp`)

Most MCP tools are CRUD over some resource type, so decompose a server into resources and give each a table. `glove-mcp` is an optional peer dependency. To keep tools off the surface, set `excludeTools` / `filterTools` on `connectMcp` — `mcpResources` / `mountMcpDatabase` bridge exactly `conn.listTools()`, so an excluded tool never becomes a table (same knob as `mountMcp`). The `table(tool) → null` hook is the finer per-bridge skip.

```ts
import { connectMcp } from "glove-mcp";
import { mountMcpDatabase } from "glove-scratchpad/mcp";

const conn = await connectMcp({ namespace: "github", url, excludeTools: ["delete_repository"] });
await mountMcpDatabase(db, conn, {
  table: (t) => t.name === "list_pull_requests"
    ? { name: "github_pr", op: "select", volatility: "stable",
        schema: z.object({ title: z.string(), merged: z.boolean() }),
        rows: (d) => JSON.parse(d as string) }
    : null,                       // skip the rest, or map them too
});
// → INSERT INTO linear_issue SELECT … FROM github_pr WHERE merged  composes two servers in one statement.
```

A read tool (`readOnlyHint`) defaults to a `select` resource; others default to a volatile `insert`. MCP results rarely carry clean column lists, so declare `schema`/`columns` (and a `rows` extractor) via `table(tool)` to make a server's data genuinely queryable beyond the default single `result` column.

### Backends

The manipulation surface is a defined Postgres subset; the backend is swappable (`ScratchpadBackend`).

- **`glove-sql`** (default) — a zero-dependency pure-JS Postgres-subset engine: joins, `GROUP BY`/`HAVING`, CTEs, set ops, correlated subqueries, window functions, `jsonb` access, scalar functions, `information_schema`, `INSERT … SELECT`, `UPDATE`. Anything outside the subset throws a clear error rather than mis-answering.
- **`PgliteBackend`** (`glove-scratchpad/pglite`) — embedded Postgres (WASM) for a full dialect. `@electric-sql/pglite` is an optional peer.
- **Bring your own** — implement `ScratchpadBackend` over real Postgres, SQLite, or a remote service.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Create the interpreter | `Database.create({ policy?, backend?, actor? })` from `glove-scratchpad` |
| Author a resource (Zod-first) | `defineResource({ name, schema, keys?, volatility, select?, insert?, update?, delete? })` |
| Author a resource (explicit columns) | `defineResource({ name, columns, volatility, … })` |
| One tool → one resource | `resourceFromTool(tool, { name, volatility, schema \| columns, op? })` |
| Zod object → columns (standalone) | `columnsFromZod(schema, keys?)` |
| Typed pushed-down args in a resolver | `TypedBindings<Row>` (`b.one("col")` autocompletes) |
| Run / preview SQL | `db.execute(sql, opts)` / `db.explain(sql)` / `db.preview()` |
| Fold the single agent tool + prime | `mountDatabase(glove, { db, prime?, explain?, allowWrites? })` |
| MCP servers → tables | `mcpResources` / `mountMcpDatabase` from `glove-scratchpad/mcp` |
| Full Postgres dialect backend | `PgliteBackend` from `glove-scratchpad/pglite` |
| BYO backend contract | `ScratchpadBackend` |

See [`examples/scratchpad-agent`](https://github.com/porkytheblack/glove/tree/main/examples/scratchpad-agent) for a runnable, no-API-key tour (`pnpm scratchpad:db`).

## Virtual Filesystem (`glove-vfs`)

The tree three surfaces share. A working environment, a `glove-memory` resource store and a REPL session each used to keep a private filesystem, and the cost showed up at the seams: a file the agent **made** could not be **filed**, a note it had **filed** could not be read by a script. Mount one tree into all three instead.

```ts
import { mountFs, inMemoryFs, hostDirectory, cachedRemote, withAccess, withMeta } from "glove-vfs";
import { fsFns } from "glove-vfs/fns";
import { vfsResources } from "glove-vfs/resources";

const fs = withAccess(
  withMeta(
    mountFs([
      { at: "/",       fs: inMemoryFs() },
      { at: "/corpus", fs: hostDirectory("./docs", { mode: "readonly" }) },
      { at: "/memory", fs: await cachedRemote(store, { prefix: `sessions/${id}/` }) },
    ]),
    { lexical: true },
  ),
  { rules: [{ path: "/corpus", access: "read", note: "curated upstream" }] },
);

createWorkingEnvironment({ filesystem: fs });                              // scripts and verbs
useResourcesCurator(glove, vfsResources(fs, { schema, root: "/memory" })); // memory tools
session.registerFns(fsFns(fs));                                           // execute_js / _lisp / _python
```

What a script writes to `/memory/notes/x.md` is what `glove_resources_read` reads, at the same path.

### The contract is small on purpose

`Vfs` is nine methods over bytes and absolute, normalised paths — `read`, `write` (creates parents), `rm` (recursive for directories), `mkdir`, `exists`, `stat`, `list`, `files`, `totalSize`. It is deliberately less than any one consumer wants, because it is the most every backend can promise.

Summaries, tags, cross-references, provenance and search are **optional capabilities** a tree may also implement, detected with `hasMeta(fs)` / `hasSearch(fs)` rather than required by the base type. That split is what lets a plain in-memory tree host a memory resource store (wrap it in `withMeta`) while a purpose-built backend serves the same consumer with no wrapper. **Ask the tree what it can do; never ask which tree it is.**

### Layers compose outside-in

Each returns a `Vfs`, so anything downstream is unaffected. Order matters: `withAccess` wraps `withMeta` wraps `mountFs`, so a policy governs the metadata surface too rather than being bypassed by it.

- **`mountFs(mounts)`** — longest prefix wins, whatever the array order. Directories on the way down to a mount stay listable (otherwise the mount is unreachable by `ls` and the agent cannot discover its own filesystem) but are not writable — a write there is refused with the list of real mounts, because "it silently went somewhere" is the worst outcome available. `rooted: false` when a backend's stored paths must stay absolute; memory resource links are stored as unvalidated absolute paths and break silently otherwise.
- **`withAccess(fs, policy)`** — rules cascade **last-match-wins** over `default` (which is `"write"`). **A listing filters; a named path refuses.** `ls` omits what you may not see, so an allowlisted tree is navigable rather than a minefield; but `read` of an ungranted path is an explicit refusal, because guessing at hidden names must not be a probe that quietly succeeds — and must not report "no such file" for real files either. `exists` returns `false` rather than throwing, since that is the question you ask *before* you know. A recursive `rm` reaching a protected path is refused whole, never partially applied. `totalSize` deliberately reports the **entire** tree: the number enforces a budget, and hiding a subtree must not buy room to write past one.
- **`withMeta(fs, opts)`** — one sidecar index at `/.vfs/meta.json`, not a file per file: metadata is small and read constantly while content is large and read selectively, and per-file sidecars turn one `ls` into N round trips on `cachedRemote`. The sidecar is hidden from `files()`/`list()` **and** excluded from `totalSize()`, so the listing and the byte count agree about what is in the tree. A corrupt sidecar loses metadata, never content — the bytes are the truth and the index is derived.

Search is opt-in and honest: pass an `embedder` for vectors, or `lexical: true` for in-process token overlap that needs no service. With neither, the tree advertises **no** search capability and `hasSearch()` reports that. Writes never index on the hot path — a write marks the path `missing` or `stale` and the host drains `findNeedingEmbedding()` → `setEmbedding()` out of band.

### Serialization sees stored bytes, not the visible view

`snapshot()` / `restore()` / `copyTree()` call `unwrap()` first, so they capture the metadata sidecar and access-fenced paths. This is the only correct answer: a snapshot exists to be restored, so anything it omits is data the restore **destroys**. Take one through a metadata layer without unwrapping and every summary, tag, link and provenance entry is silently gone on the way back — with the file bytes intact enough to make it look like it worked. These are host doors, where the host holds the handle and is serializing its own storage; they are not a surface an agent reaches, which is where the narrowing belongs and stays.

### Writing a backend

`runVfsConformance(() => myBackend())` from `glove-vfs/testing`. Nine methods sounds too small to get wrong and isn't: the interesting cases are writing through a path whose parent is a file, listing a directory that exists only because something below it does, `rm` of a subtree, and the byte accounting a storage budget depends on. Every layer in the package runs the same suite against itself, because a wrapper is a `Vfs` too and a stack of them is exactly where a contract quietly stops holding.

## Working Environment (`glove-working-environment`)

A filesystem and a script runtime the model writes code against, instead of a fixed menu of tools. Use it when the work is open-ended over files — documents, spreadsheets, decks, archives — and the useful next step is a script rather than a call.

```ts
import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { documents } from "glove-env-documents";
import { spreadsheets } from "glove-env-spreadsheets";

const env = await createWorkingEnvironment({
  stdlib: [documents(), spreadsheets()],
  limits: { runTimeoutMs: 60_000 },
  execution: { size: 1 },
});

mountWorkingEnvironment(agent, { env });   // structural — no glove-core dependency
```

### The tree

`/inbox` (host-mounted inputs) · `/scripts` (the model's persistent library, with generated `.d.ts` siblings) · `/skills` (worked recipes, materialised at startup) · `/std` (one directory per module, its types and README) · `/tmp` · `/out` (deliverables) · `/.env` (bookkeeping).

Host doors: `env.mount(bytes|path|{text}, dest)` in, `env.export(glob)` out, `env.snapshot()` / `fromSnapshot` to persist, `env.close()` to release worker threads.

**Handing work over.** Wire `onPresent({ path, name, bytes, mediaType, caption })` and a `present` verb appears; without it, absent. Writing to `/out` makes a file, `present` *delivers* one — by the end of a task `/out` also holds drafts and intermediates, and only the agent knows which was the answer. Paths outside `/out` are refused with the fix. `mediaType` comes from the extension (magic bytes only for extensionless files), so the host can choose a player over a download prompt.

**Read-only zones.** `readOnlyPaths: ["/corpus"]` makes a subtree readable, greppable and describable but never writable. Enforcement sits at the single core mutation gateway, so one check binds every surface: model verbs, scripts going through `env:fs`, adapter handles, and `undo`. `env.mount()` deliberately bypasses it — seeding content the agent can only read is the point — while `env.fs`, the *guarded* host handle, obeys the same rules as the model. Zones are announced in the orientation file and `mkdir`'d at startup so the boundary is learned by reading, not by being refused. Pairs with `hostDirectory` for "here is a real project, `/src` is reference-only". Not stored in snapshots — the host re-supplies it, like `stdlib`.

**Where the tree lives.** `filesystem` takes any `Vfs` — the contract, the backends and the composition layers all live in **`glove-vfs`** now (re-exported here, so existing imports are unchanged). Three backends ship: `inMemoryFs()` (default), `hostDirectory(dir)` (copy-on-write over a real directory — the agent cannot damage the source until `commit()`), and `cachedRemote(store, { prefix })` (object storage; you supply `get`/`put`/`delete`/`list`, so no SDK dependency). For plain persistence across restarts prefer `snapshot()` to one object — one round trip per session instead of one per file, and atomic. `cachedRemote` keeps the structural index (paths, sizes, mtimes, dirs) in memory because `totalSize()` runs on every write and `files()` backs glob/grep/rm -r; only content crosses the network. No distributed locking — one prefix per session.

**Sharing the tree.** Because `filesystem` is a `glove-vfs` tree, the SAME tree can back a `glove-memory` resource store (`vfsResources(fs, { schema, root })`) and the REPL surfaces (`fsFns(fs)`) at once — what a script writes to `/memory/notes/x.md` is what `glove_resources_read` reads, at that path, with no copy. `mountFs([...])` grafts several backends into one namespace and `withAccess(fs, policy)` fences subtrees at the filesystem rather than per surface. See the Virtual Filesystem section above. `readOnlyPaths` remains the environment-local shorthand for the common case.

### Four routes to expose a capability — pick by shape

This is the decision implementers get wrong. The shape of the thing picks the route:

| Shape | Route | Call style |
|---|---|---|
| Does I/O — reads/writes files, calls out | `defineAdapter` | `async` |
| Stateful builder — `new X()`, chained mutation, terminal save | `defineBuilder` / `defineBuilders` | `async` |
| Pure computation — no I/O, no state | `definePureModule` | **synchronous** |
| A *capability*, not a library — MCP server, model, HTTP API | `defineTools` | `async` |

`defineTools({ name, description, fns, docs })` mounts a list of `ToolFn`s as an `env:` module — structurally the `glove-scratchpad/fns` catalog, so `fnsFromMcp(conn)` produces the list directly and an MCP server becomes importable with no adapter written. The argument for it is loop economics: a *verb* puts every answer in the context window, so checking forty rendered pages costs forty round trips; the same capability as a function lets a script loop and return one line. Same module shape, same import line, no `types` to hand-write.

```ts
// Pure computation: imported INSIDE the worker, bound into the vm context.
// Calls never cross a thread, so they stay synchronous.
definePureModule({
  name: "lodash",
  from: "lodash",
  description: "Lodash utilities for shaping data.",
  pick: ["groupBy", "sumBy", "orderBy", "uniqBy", "camelCase"],
})
```

`pick` is the **sandbox boundary**, not a convenience — picked functions run in the worker's realm, outside the vm. Never pick a string-to-code member (`_.template` runs `Function(source)` host-side). Prototype members are refused at definition time. Every name is verified against the real module at environment creation, so a typo fails there rather than as `undefined` in a script.

Why sync matters: `await` on a plain value is a no-op, but a **missed** `await` on a promise is silent garbage — `sumBy(rows, 'n')` through an async binding returns a stringified promise and the run reports success. Sync is the forgiving direction, so a synchronous library must be exposed synchronously.

`defineBuilder` exposes a builder API *unchanged* — calls are recorded in-context as a flat op list and replayed host-side on the terminal call, so `new Pptx()`, chained methods, and passing one node into another all work across the worker boundary. `glove-env-slides` and `glove-env-spreadsheets` use it to expose pptxgenjs and exceljs verbatim.

### HTTP files and scoped secrets

Use `fetchFiles()` from `glove-env-fetch` for `env:fetch.request/download/upload`, including JSON, forms and multipart bodies. Use `secret()` from `glove-env-secret` for host-backed key metadata and references. Read [HTTP files and host secrets](https://github.com/porkytheblack/glove/blob/main/packages/glove-working-environment/HTTP-AND-SECRETS.md) for host setup, the script API, safety limits, cancellation and persistence; do not invent a shell/curl bridge or put credentials in VFS files.

Keep network grants and credential aliases in host configuration. Native fetch blocks non-public DNS/IP destinations; private services need exact `privateNetworkOrigins` opt-ins. Replacement transports own equivalent DNS/IP/TLS enforcement. Scope a persistent `SecretStore` to the tenant and re-supply it on restore; references grant no access by themselves, and reveal/writes default off. Adapter calls belong inside the script's default export. Read `ctx.signal` inside bindings to abort host I/O when a run ends.

### Authoring and testing an adapter

`defineAdapter({ name, description, types, docs, skills?, create(vfs, ctx) })`. `create` is the capability boundary and is called **twice** — once read-only, for write-time script validation. Every exposed function is wrapped so failures read `env:<name>.<fn>: …`, and arguments arrive deep-copied as host-realm values.

Test with `glove-working-environment/testing`: `createAdapterTestEnv(adapter)` returns `{ env, fs, script(), runScript(), audit() }`. **`audit()` fails the build when `types` and the real bindings disagree in either direction** — including the Promise rule, which *inverts* for pure modules (declaring `Promise<…>` on a synchronous binding is the lie there).

### Hosting it in Next.js

Two traps, both of which surface far from their cause:

1. **Every environment package must be in `serverExternalPackages`.** The worker pool locates its entry relative to its own module URL; bundled, that URL points into a Next chunk and the worker is not beside it. Fails at the first `run_script`, not at build time. `sharp` (via `env:images`) must be external for its own reasons.
2. **In a pnpm monorepo that is not enough.** Next matches `serverExternalPackages` against the *resolved* path and resolves with `symlinks: true` hardcoded; a workspace link resolves to `../../packages/<name>`, which has no `node_modules` segment, so the match never fires. Symptom: `Can't resolve './worker-dev.mjs'`. Add an explicit webpack external to bypass the heuristic.

The agent must run **server-side** — `createChatHandler` is a model proxy for client-side tools and is the wrong shape here. Run `processRequest` in a route and forward the agent's own event stream as SSE. See `examples/document-desk`.

### Rendering motion (`glove-env-motion`)

Mount `motion()` **with `limits: MOTION_LIMITS`** — the two travel together. A frame is a browser screenshot (~330ms), so a render is refused up front when the environment's `runTimeoutMs` cannot cover it; the refusal names the exact `limits: { runTimeoutMs: N }` to set, but it is still a refusal. In Next, add `glove-env-motion` *and* `playwright-core` to `serverExternalPackages`: the adapter resolves its own toolchain off its package root at runtime and a bundled copy has no package root.

Five failure modes cost a diagnostic round each during development, and every one of them fails **silently** — frame 1 renders, nothing moves, no error. They are all internal to the package now, so do not re-introduce them by "helpfully" configuring around it: worklets need the Babel plugin (esbuild does not run Babel, so `useAnimatedStyle(() => …)` becomes a never-called closure); the plugin's preset calls `api.assertVersion(7)`, so Babel 8 fails misleadingly; `.web.js` must resolve before `.js` or the native runtime bundles; the clock shim must install before the bundle; and **`page.setContent()` does not run `addInitScript` — only navigation does**, so the page is written to disk and reached with `goto()`.

Two things to tell a user rather than debug: a render needs a browser (`glove-motion-doctor` prints per-row fixes), and a Chromium built without proprietary codecs — including the one `playwright-core install` places — cannot decode H.264, showing a black rectangle with working controls and no error. The mp4 is fine; Chrome/Edge/Safari/Firefox play it. Render `.webm` for a codec-free Chromium.

### What actually makes models succeed

Measured across 90 runs on three open models: **guessed imports are the #1 failure**, which is why `/skills/imports.md` exists and why the environment corrects wrong import names at *write* time, before a run is spent. Point the system prompt at `/skills/README.md` first. Tell the model to `describe` a file rather than read it — an 80-page PDF is ~200KB of text against an 8KB response cap. Exposing a library's real API beat a simplified wrapper: the scenario requiring the genuine pptxgenjs surface scored highest in the suite.

## REPLs: code as the tool surface (`glove-js`, `glove-python`, `glove-lisp`)

Use a REPL when a task needs several reads, loops, filters or branches. The model writes one program against a catalogue of functions behind one `execute_*` tool, and only the program's last value returns to context. Big intermediates stay bound in the interpreter instead of the transcript.

```ts
import { JsSession, mountJs, defineFn, fnFromTool } from "glove-js"; // defineFn/fnFromTool re-exported from glove-scratchpad
import { z } from "zod";

const session = JsSession.create();
session.register(defineFn({
  name: "customers__active",            // server__function: shows up as customers.active(...)
  description: "List active customers",
  input: z.object({ region: z.string().optional() }),
  readOnlyHint: true,
  handler: (input) => customerAdapter.listActive(input),
}));
session.register(fnFromTool(existingGloveTool)); // reuse a tool you already fold
mountJs(glove, { session });                     // folds execute_js + discovery tools, primes the prompt
```

- `glove-python`: `PySession.create()` + `mountPy(glove, { session })`, tool calls take keyword args.
- `glove-lisp`: `LispSession.create()` + `mountLisp(glove, { session })`; `registerAll(resourceTables)` for table mode, `registerFns(fns)` for function mode.
- MCP servers become functions with `fnsFromMcp(conn)` from `glove-scratchpad/fns/mcp`; a VFS becomes functions with `fsFns(fs)` from `glove-vfs/fns`; classifiers with `classifierFns(clf)` from `glove-classifier`.
- REPL bindings are run-scoped. Anything that must survive goes into a VFS / working environment, not interpreter variables.
- In Foundry, use `defineRepl(...)` and its `programmaticTools` selector instead of mounting by hand; see the `glove-foundry` skill.

Guide: https://glove.dterminal.net/docs/code-execution

## Browsers and sandboxes (`glove-execution`)

`mountBrowser(glove, { adapter })` folds `execute_browser`; `mountSandbox(glove, { adapter })` folds `execute_sandbox`. The model scripts a whole observe → act → verify loop in one call (default scripts run on `glove-js`); screenshots arrive as native images in the next model request via a transient context provider. Mounting never wraps or replaces the agent's model. Pass `surface: "tools"` for individual `glove_browser_*` / `glove_sandbox_*` tools instead of scripts.

```ts
import { mountBrowser, mountSandbox } from "glove-execution";
const browser = mountBrowser(glove, { adapter: browserAdapter });
const sandbox = mountSandbox(glove, { adapter: sandboxAdapter });
try {
  await glove.processRequest("Complete the task");
} finally {
  await Promise.allSettled([browser.close(), sandbox.close()]);
}
```

- Backends: Station 3 adapters live in `glove-execution/station` (`stationBrowserClient`, `stationSandbox`, `stationLocalSandbox`). Any other backend implements `BrowserAdapter` / `SandboxAdapter`, or a `SandboxBackend` passed to `createSandboxAdapter`, which handles grants, capacity, bounded results and retain/destroy cleanup.
- Closing a sandbox scope retains files and services by default; `cleanup: "destroy-created"` deletes only sandboxes the scope created. Never automatically retry a mutation whose outcome is unknown.
- In Foundry, mount inside `configure(agent, context)` and register `context.onCleanup` right after acquiring the adapter. `stationDaemon({ stationId, resources, onReady })` from `glove-foundry/station` hosts browser/sandbox providers on Foundry's own managed Station.
- Page content is untrusted evidence. `allowEvaluate: true` is an explicit host grant for in-page JavaScript.

Guide: https://glove.dterminal.net/docs/execution · package README: https://github.com/porkytheblack/glove/blob/main/packages/glove-execution/README.md
