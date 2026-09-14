import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Virtual Filesystem",
  description:
    "glove-vfs — one tree a working environment, a memory resource store and the REPLs all share, with mounts, access policies, metadata and search.",
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};
const headRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border)" };
const bodyRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border-subtle)" };
const codeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
  verticalAlign: "top",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};
const calloutStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "0.5rem",
  padding: "1rem 1.25rem",
  margin: "1.5rem 0",
  color: "var(--text-secondary)",
  lineHeight: 1.7,
  fontSize: "0.925rem",
};

function Table({ headers, rows }: { headers: string[]; rows: [string, string][] }) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([code, desc]) => (
            <tr key={code} style={bodyRowStyle}>
              <td style={codeCell}>{code}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VfsPage() {
  return (
    <div className="docs-content">
      <h1>Virtual Filesystem</h1>

      <p>
        Glove grew three filesystems independently. The{" "}
        <a href="/docs/working-environment">working environment</a> has a script
        tree. <a href="/docs/memory">Memory</a> has a resource store. A{" "}
        <a href="/docs/code-execution">REPL session</a> has whatever it happened to
        hold in scope. Each solved the same problem privately, and the cost showed
        up at the seams: a file the agent <strong>made</strong> could not be{" "}
        <strong>filed</strong>, a note it had <strong>filed</strong> could not be
        read by a script, and an intermediate it computed in a REPL was addressable
        from nowhere at all.
      </p>

      <p>
        <code>glove-vfs</code> makes the tree one namespace, without asking any of
        them to change what they expose to the model.
      </p>

      <CodeBlock
        language="typescript"
        code={`import { mountFs, inMemoryFs, hostDirectory, cachedRemote, withAccess, withMeta } from "glove-vfs";
import { fsFns } from "glove-vfs/fns";
import { vfsResources } from "glove-vfs/resources";

const fs = withAccess(
  withMeta(
    mountFs([
      { at: "/",       fs: inMemoryFs() },
      { at: "/corpus", fs: hostDirectory("./docs", { mode: "readonly" }) },
      { at: "/memory", fs: await cachedRemote(store, { prefix: \`sessions/\${id}/\` }) },
    ]),
    { lexical: true },
  ),
  { rules: [{ path: "/corpus", access: "read", note: "curated upstream" }] },
);

createWorkingEnvironment({ filesystem: fs });                              // scripts and verbs
useResourcesCurator(glove, vfsResources(fs, { schema, root: "/memory" })); // memory tools
session.registerFns(fsFns(fs));                                           // execute_js / _lisp / _python`}
      />

      <div style={calloutStyle}>
        Three consumers, one tree. What a script writes to{" "}
        <code>/memory/notes/x.md</code> is what <code>glove_resources_read</code>{" "}
        reads, at the same path, with no copy and no export step.
      </div>

      <h2 id="contract">The contract is small on purpose</h2>

      <p>
        <code>Vfs</code> is nine methods over bytes and absolute, normalised paths
        — deliberately less than any one consumer wants, because it is the most
        every backend can promise.
      </p>

      <CodeBlock
        language="typescript"
        code={`interface Vfs {
  read(path): Promise<Uint8Array>;
  write(path, data): Promise<void>;   // creates parents
  rm(path): Promise<void>;            // recursive for directories
  mkdir(path): Promise<void>;
  exists(path): Promise<boolean>;
  stat(path): Promise<VfsStat | null>;
  list(path): Promise<VfsEntry[]>;    // immediate children
  files(): Promise<string[]>;         // every file path, sorted
  totalSize(): Promise<number>;
}`}
      />

      <p>
        Everything richer — summaries, tags, cross-references, provenance,
        embeddings — is an <strong>optional capability</strong> a tree may also
        implement, detected with <code>hasMeta(fs)</code> /{" "}
        <code>hasSearch(fs)</code> rather than required by the base type. That
        split is what lets a plain in-memory tree host a memory resource store
        (wrap it in <code>withMeta</code>) while a purpose-built backend serves the
        same consumer with no wrapper. The consumer asks the tree what it can do;
        it never asks which tree it is.
      </p>

      <h2 id="backends">Backends</h2>

      <Table
        headers={["Backend", "Use it for"]}
        rows={[
          ["inMemoryFs()", "The default. The whole tree is a data structure, so snapshot and restore are near-free."],
          ["hostDirectory(dir, { mode })", "A real directory, copy-on-write. Reads fall through to disk, writes land in an overlay, and nothing on the host changes until commit(). mode: \"readonly\" refuses writes outright."],
          ["cachedRemote(store, { prefix })", "Object storage. You supply get/put/delete/list, so the package depends on no SDK. The structural index stays in memory; only content crosses the network."],
        ]}
      />

      <p>
        For plain &ldquo;persist across restarts&rdquo;, prefer{" "}
        <code>snapshot()</code> to one object over a per-file backend — one round
        trip per session instead of one per file, and atomic.
      </p>

      <h2 id="layers">Layers</h2>

      <p>
        Each returns a <code>Vfs</code>, so they compose and anything downstream is
        unaffected. Order reads outside-in: <code>withAccess</code> wraps{" "}
        <code>withMeta</code> wraps <code>mountFs</code>, so a policy governs the
        metadata surface too rather than being bypassed by it.
      </p>

      <h3>mountFs — several backends, one tree</h3>

      <p>
        Longest prefix wins, whatever the array order. Directories on the way down
        to a mount stay listable — otherwise the mount is unreachable by{" "}
        <code>ls</code> and the agent cannot discover its own filesystem — but they
        are not writable: a write there is refused with the list of real mounts,
        because &ldquo;it silently went somewhere&rdquo; is the worst outcome
        available. A mount point itself cannot be <code>rm</code>&rsquo;d; that is
        a host decision, not an agent one.
      </p>

      <p>
        <code>rooted</code> decides whether paths are translated. By default a
        backend mounted at <code>/memory</code> is called with{" "}
        <code>/notes/x.md</code>, which is what lets an existing tree be grafted
        anywhere. Pass <code>rooted: false</code> when the backend&rsquo;s stored
        paths must stay absolute — anything referencing them from outside the tree
        breaks silently otherwise.
      </p>

      <h3>withAccess — path-scoped read/write/none</h3>

      <CodeBlock
        language="typescript"
        code={`withAccess(fs, {
  default: "none",
  rules: [
    { path: "/corpus", access: "read", note: "curated upstream" },
    { path: "/work", access: "write" },
    { path: "/**/*.locked.md", access: "read" },
  ],
});`}
      />

      <p>
        Rules cascade <strong>last-match-wins</strong> over <code>default</code>{" "}
        (which is <code>&quot;write&quot;</code>). Two behaviours are load-bearing:
      </p>

      <ul>
        <li>
          <strong>A listing filters; a named path refuses.</strong> <code>ls</code>{" "}
          simply omits what you may not see, so an allowlisted tree is navigable
          rather than a minefield. But <code>read</code> of a path you were not
          granted is an explicit refusal — guessing at hidden names must not be a
          probe that quietly succeeds, and must not report &ldquo;no such
          file&rdquo; for real files either. <code>exists</code> returns{" "}
          <code>false</code> rather than throwing, because that is the question you
          ask <em>before</em> you know.
        </li>
        <li>
          <strong>Traversal is not read access.</strong> Directories on the way to
          a granted subtree stay listable so the grant is reachable; that says
          nothing about their own contents.
        </li>
      </ul>

      <p>
        A recursive <code>rm</code> that would reach a protected path is refused
        whole rather than partially applied. <code>totalSize</code> deliberately
        reports the entire tree — the number exists to enforce a budget, and hiding
        a subtree must not buy an agent room to write past one.
      </p>

      <div style={calloutStyle}>
        Enforcement is on the filesystem, not on a tool list, so a write into a
        read-only folder is refused whichever surface asks: a model verb, a
        script&rsquo;s <code>env:fs</code> call, a REPL function, or a host handle.
        The policy also governs the metadata surface — a summary describes bytes,
        so <code>getMeta</code> on an unreadable path is refused, and a semantic
        hit is an existence proof, so searches and link lookups filter to what you
        may see.
      </div>

      <h3>withMeta — summaries, tags, links, provenance, search</h3>

      <p>
        Gives a plain tree the metadata capability, kept in one sidecar index
        inside the same tree (<code>/.vfs/meta.json</code>). One index rather than
        a file-per-file scheme because metadata is small and read constantly while
        content is large and read selectively — on <code>cachedRemote</code>,
        per-file sidecars turn one <code>ls</code> into N network round trips.
      </p>

      <p>
        The sidecar is hidden from <code>files()</code> and <code>list()</code> and
        excluded from <code>totalSize()</code>, so the listing and the byte count
        agree about what is in the tree. A corrupt sidecar loses metadata, never
        content — the bytes are the truth and the index is derived.
      </p>

      <p>
        Search is opt-in and honest: pass an <code>embedder</code> for vector
        search, or <code>lexical: true</code> for in-process token-overlap scoring
        that needs no service at all. With neither, the tree advertises{" "}
        <strong>no</strong> search capability rather than an empty one, and{" "}
        <code>hasSearch()</code> reports that.
      </p>

      <p>
        Writes never index on the hot path. A write marks the path{" "}
        <code>missing</code> (new) or <code>stale</code> (content changed); a host
        drains the queue out of band:
      </p>

      <CodeBlock
        language="typescript"
        code={`const pending = await fs.findNeedingEmbedding({ limit: 50 });
const vectors = await embedder.embed(await Promise.all(pending.map(readText)));
for (const [i, path] of pending.entries()) await fs.setEmbedding(path, vectors[i]);`}
      />

      <h2 id="serialization">Snapshots see stored bytes, not the visible view</h2>

      <p>
        <code>snapshot()</code>, <code>restore()</code> and <code>copyTree()</code>{" "}
        operate on what the backend <strong>stores</strong>, not on what the
        outermost layer <strong>shows</strong> — they call <code>unwrap()</code>{" "}
        first, so they capture the metadata sidecar and any access-fenced paths.
      </p>

      <p>
        That is the only correct answer: a snapshot exists to be restored, so
        anything it omits is data the restore destroys. Take one through a metadata
        layer without unwrapping and every summary, tag, link and provenance entry
        is silently gone on the way back, with the file bytes intact enough to make
        it look like it worked. These are host doors — the host holds the handle
        and is serializing its own storage — not a surface an agent reaches, which
        is where the narrowing belongs and stays.
      </p>

      <h2 id="consumers">Plugging consumers in</h2>

      <Table
        headers={["Consumer", "How"]}
        rows={[
          ["Working environments", "createWorkingEnvironment({ filesystem }) already takes a Vfs — it is now this Vfs. Nothing else changes."],
          ["glove-memory resources", "vfsResources(fs, { schema, root }) returns a resource adapter. root scopes to a subtree; it does not rewrite paths into it, because translation would silently invalidate every stored link target."],
          ["REPLs", "fsFns(fs) returns the filesystem as ToolFns, arriving as fs.read(...) in JS and Python and (fs__read …) in Lisp."],
        ]}
      />

      <p>
        Metadata and search functions appear only when the tree actually provides
        them, so the model never sees a call it cannot make;{" "}
        <code>readOnly: true</code> drops every mutating one. A verb puts every
        answer in the context window, so checking forty files costs forty round
        trips — the same capability as a function lets the model loop and return
        one line.
      </p>

      <CodeBlock
        language="javascript"
        code={`const stale = [];
for (const p of await fs.glob("/memory/**/*.md")) {
  const m = await fs.meta({ path: p });
  if (m && m.embeddingStatus !== "fresh") stale.push(p);
}
stale.length`}
      />

      <h2 id="testing">Testing a backend</h2>

      <p>
        The contract is nine methods, which sounds too small to get wrong and
        isn&rsquo;t. The interesting cases are the ones a real agent finds: writing
        through a path whose parent is a file, listing a directory that only exists
        because something below it does, <code>rm</code> of a subtree, and the byte
        accounting a storage budget depends on.
      </p>

      <CodeBlock
        language="typescript"
        code={`import { runVfsConformance } from "glove-vfs/testing";

test("my backend", async () => {
  await runVfsConformance(() => myBackend());
});`}
      />

      <p>
        Every layer in the package runs the same suite, because a wrapper is a{" "}
        <code>Vfs</code> in its own right and a stack of them is exactly where a
        contract quietly stops holding.
      </p>

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/working-environment">Working Environment</a> — the script
          runtime that sits on this tree.
        </li>
        <li>
          <a href="/docs/memory">Memory</a> — the resource store that can share it.
        </li>
        <li>
          <a href="/docs/code-execution">Code Execution</a> — the REPLs that reach
          it through <code>fsFns</code>.
        </li>
      </ul>
    </div>
  );
}
