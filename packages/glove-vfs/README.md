# glove-vfs

**One virtual filesystem for a whole agent.**

Glove grew three filesystems independently. `glove-working-environment` has a
script tree. `glove-memory` has a resource store. A REPL session
(`glove-js` / `glove-lisp` / `glove-python`) has whatever it happened to hold
in scope. Each solved the same problem privately, and the cost showed up at
the seams:

- a file the agent **made** could not be **filed**,
- a note it had **filed** could not be **read by a script**,
- an intermediate it computed in a REPL was addressable from nowhere at all.

The tree is the natural shared namespace for all three. This package makes it
one, without asking any of them to change what they expose to the model.

```bash
pnpm add glove-vfs
```

```ts
import { mountFs, inMemoryFs, hostDirectory, cachedRemote, withMeta, withAccess } from "glove-vfs";
import { fsFns } from "glove-vfs/fns";
import { vfsResources } from "glove-vfs/resources";

const fs = withAccess(
  withMeta(
    mountFs([
      { at: "/",       fs: inMemoryFs() },
      { at: "/corpus", fs: hostDirectory("./docs", { mode: "readonly" }), access: "read" },
      { at: "/memory", fs: await cachedRemote(store, { prefix: "sessions/abc/" }) },
    ]),
    { lexical: true },
  ),
  { rules: [{ path: "/corpus", access: "read", note: "curated upstream" }] },
);

createWorkingEnvironment({ filesystem: fs });              // scripts and verbs
useResourcesCurator(glove, vfsResources(fs, { schema, root: "/memory" }));
session.registerFns(fsFns(fs));                            // execute_js / _lisp / _python
```

Three consumers, one tree. What a script writes to `/memory/notes/x.md` is
what `glove_resources_read` reads, at the same path, with no copy and no
export step.

## The contract is small on purpose

`Vfs` is nine methods over bytes and paths — deliberately less than any one
consumer wants, because it is the most every backend can promise:

```ts
interface Vfs {
  read(path): Promise<Uint8Array>;
  write(path, data): Promise<void>;   // creates parents
  rm(path): Promise<void>;            // recursive for directories
  mkdir(path): Promise<void>;
  exists(path): Promise<boolean>;
  stat(path): Promise<VfsStat | null>;
  list(path): Promise<VfsEntry[]>;    // immediate children
  files(): Promise<string[]>;         // every file path, sorted
  totalSize(): Promise<number>;
}
```

Everything richer — summaries, tags, cross-references, provenance, embeddings
— is an **optional capability** a tree may also implement, detected with
`hasMeta(fs)` / `hasSearch(fs)` rather than required by the base type. That
split is what lets a plain in-memory tree host a memory resource store (wrap
it in `withMeta`) while a purpose-built backend serves the same consumer with
no wrapper. The consumer asks the tree what it can do; it never asks which
tree it is.

## Backends

| Backend | Use it for |
|---|---|
| `inMemoryFs()` | The default. The whole tree is a data structure, so snapshot/restore is near-free. |
| `hostDirectory(dir, { mode })` | A real directory, copy-on-write. Reads fall through to disk; writes land in an overlay; nothing on the host changes until `commit()`. `mode: "readonly"` refuses writes outright. |
| `cachedRemote(store, { prefix })` | Object storage. You supply `get`/`put`/`delete`/`list`, so the package depends on no SDK. The structural index stays in memory; only content crosses the network. |

For plain "persist across restarts", prefer `snapshot()` to one object over a
per-file backend — one round trip per session instead of one per file, and
atomic.

`snapshot()`, `restore()` and `copyTree()` operate on what the backend
**stores**, not on what the outermost layer **shows** — they call `unwrap()`
first, so they capture the metadata sidecar and any access-fenced paths. That
is the only correct answer: a snapshot exists to be restored, so anything it
omits is data the restore destroys. Take one through a metadata layer without
unwrapping and every summary, tag, link and provenance entry is silently gone
on the way back, with the file bytes intact enough to make it look like it
worked. These are host doors — the host holds the handle and is serializing
its own storage — not a surface an agent reaches, which is where the narrowing
belongs and stays.

## Layers

Each returns a `Vfs`, so they compose and anything downstream is unaffected.
Order reads outside-in: `withAccess` wraps `withMeta` wraps `mountFs`, so a
policy governs the metadata surface too rather than being bypassed by it.

### `mountFs(mounts)` — several backends, one tree

Longest prefix wins, whatever the array order. Directories on the way down to
a mount stay listable (otherwise the mount is unreachable by `ls` and the
agent cannot discover its own filesystem), but they are not writable — a write
there is refused with the list of real mounts, because "it silently went
somewhere" is the worst outcome available. A mount point itself cannot be
`rm`'d; that is a host decision, not an agent one.

`rooted` decides whether paths are translated. By default a backend mounted at
`/memory` is called with `/notes/x.md`, which is what lets an existing tree be
grafted anywhere. Pass `rooted: false` when the backend's stored paths must
stay absolute — anything referencing them from outside the tree (memory
resource links are stored, unvalidated, as absolute paths) breaks silently
otherwise.

### `withAccess(fs, policy)` — path-scoped read/write/none

```ts
withAccess(fs, {
  default: "none",
  rules: [
    { path: "/corpus", access: "read", note: "curated upstream" },
    { path: "/work", access: "write" },
    { path: "/**/*.locked.md", access: "read" },
  ],
});
```

Rules cascade **last-match-wins** over `default` (which is `"write"`). Two
behaviours are load-bearing:

- **A listing filters; a named path refuses.** `ls` simply omits what you may
  not see, so an allowlisted tree is navigable rather than a minefield. But
  `read` of a path you were not granted is an explicit refusal — guessing at
  hidden names must not be a probe that quietly succeeds, and must not report
  "no such file" for real files either. `exists` returns `false` rather than
  throwing, because that is the question you ask *before* you know.
- **Traversal is not read access.** Directories on the way to a granted
  subtree stay listable so the grant is reachable; that says nothing about
  their own contents.

A recursive `rm` that would reach a protected path is refused whole rather
than partially applied. `totalSize` deliberately reports the entire tree — the
number exists to enforce a budget, and hiding a subtree must not buy an agent
room to write past one.

Enforcement is on the filesystem, not on a tool list, so a write into a
read-only folder is refused whichever surface asks: a model verb, a script's
`env:fs` call, a REPL function, or a host handle.

### `withMeta(fs, opts)` — summaries, tags, links, provenance, search

Gives a plain tree the metadata capability, kept in one sidecar index inside
the same tree (`/.vfs/meta.json`). One index rather than a file-per-file
scheme because metadata is small and read constantly while content is large
and read selectively — on `cachedRemote`, per-file sidecars turn one `ls` into
N network round trips.

The sidecar is hidden from `files()` and `list()` (it is bookkeeping, not
content, and a memory adapter would otherwise surface it as a resource) and
excluded from `totalSize()`, so the listing and the byte count agree about
what is in the tree. It stays visible to `read`/`stat`/`exists` for hosts that
want to inspect or back it up. A corrupt sidecar loses metadata, never
content — the bytes are the truth and the index is derived.

Search is opt-in and honest: pass an `embedder` for vector search, or
`lexical: true` for in-process token-overlap scoring that needs no service at
all. With neither, the tree advertises **no** search capability rather than an
empty one, and `hasSearch()` reports that.

Writes never index on the hot path. A write marks the path `missing` (new) or
`stale` (content changed); a host drains the queue out of band:

```ts
const pending = await fs.findNeedingEmbedding({ limit: 50 });
const vectors = await embedder.embed(await Promise.all(pending.map(readText)));
for (const [i, path] of pending.entries()) await fs.setEmbedding(path, vectors[i]);
```

## Plugging consumers in

### Working environments

`createWorkingEnvironment({ filesystem })` already takes a `Vfs` — it is now
*this* `Vfs`. Nothing else changes.

### `glove-memory` resources

`vfsResources(fs, { schema, root })` returns a `ResourceFsAdapter`. Two
decisions worth knowing:

- **Paths are not translated.** `root` *scopes* the adapter to a subtree; it
  does not rewrite paths into it. Translation would silently invalidate every
  stored `metadata.links` target, which is unvalidated absolute-path data the
  package does not own.
- **A file nobody wrote through the adapter is still a resource.** It reads
  back as `text` (or `markdown` for `.md`) with empty metadata — because the
  alternative, refusing to show a file that plainly exists, is how you end up
  back with two filesystems.

Metadata needs a metadata-capable tree; over a plain one the adapter still
reads, lists, greps and writes, and metadata simply comes back empty rather
than throwing.

### REPLs

`fsFns(fs)` returns the filesystem as `ToolFn`s in the shape
`glove-scratchpad/fns` defines, namespaced so they arrive as `fs.read(...)` in
JS and Python and `(fs__read …)` in Lisp:

```js
const stale = [];
for (const p of await fs.glob("/memory/**/*.md")) {
  const m = await fs.meta({ path: p });
  if (m && m.embeddingStatus !== "fresh") stale.push(p);
}
stale.length
```

A verb puts every answer in the context window, so checking forty files costs
forty round trips. The same capability as a function lets the model loop and
return one line. Metadata and search functions appear only when the tree
actually provides them, so the model never sees a call it cannot make;
`readOnly: true` drops every mutating one.

## Testing a backend

The contract is nine methods, which sounds too small to get wrong and isn't.
The interesting cases are the ones a real agent finds: writing through a path
whose parent is a file, listing a directory that only exists because something
below it does, `rm` of a subtree, and the byte accounting a storage budget
depends on.

```ts
import { runVfsConformance } from "glove-vfs/testing";

test("my backend", async () => {
  await runVfsConformance(() => myBackend());
});
```

Every layer in this package runs the same suite, because a wrapper is a `Vfs`
in its own right and a stack of them is exactly where a contract quietly stops
holding.

## Status

Draft v0.1. Zero runtime dependencies.

MIT © dterminal
