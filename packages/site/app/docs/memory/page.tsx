import { CodeBlock } from "@/components/code-block";

export default async function MemoryPage() {
  return (
    <div className="docs-content">
      <h1>Memory</h1>

      <p>
        <code>glove-memory</code> is the memory layer for Glove. Storage-agnostic
        adapter contracts, schema-first ontology, and auto-registered tool
        surfaces. Four complementary, independently usable subsystems with
        bring-your-own storage.
      </p>

      <p>
        Entity, episodic, and resources use a <strong>reader / curator split</strong>{" "}
        — readers attach to the conversational agent, curators run as
        orchestrator-driven extractors. Context is different: it&apos;s
        user-configured rather than curator-extracted, so it uses a single
        registration that gives the agent both read and write tools plus
        system-prompt injection.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The four subsystems</h2>

      <p>
        <strong>Entity memory.</strong> Graph-shaped, schema-first, deterministic
        identity resolution. Nodes have a class (<code>Person</code>,{" "}
        <code>Organization</code>, …), a Zod-validated property bag, and
        identity keys that the curator uses to upsert without duplicates.
        Relationships connect nodes by typed edges. The query DSL supports
        traversal, predicates, and bounded fan-out.
      </p>

      <p>
        <strong>Episodic memory.</strong> Timeline-bound, append-only, semantically
        searchable. An <code>Episode</code> has a registered <em>kind</em>{" "}
        (e.g. <code>meeting</code>), a list of participant entity ids, an
        occurrence time, free-form properties, and a <code>content</code> field
        that gets embedded out-of-band for semantic search.
      </p>

      <p>
        <strong>Resources.</strong> A POSIX-style virtual filesystem the agent
        navigates with <code>ls</code> / <code>read</code> / <code>grep</code>{" "}
        / <code>glob</code> / <code>edit</code>. Roots are declared in the
        schema so the agent only ever sees configured trees. Files carry
        metadata including <code>links</code> that point at entity ids,
        episodes, or other paths — the same reverse-lookup primitive the
        reconciliation primitives consume.
      </p>

      <p>
        <strong>Context.</strong> User-configured ambient context, auto-injected
        into the system prompt every turn. Small surface (4 tools), the
        agent both reads and writes, and a wrapper composes pinned entries
        after the developer&apos;s system prompt before each model call.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Subpath exports</h2>

      <p>
        The package ships a top-level barrel plus subpath exports that keep
        consumer dependencies tight.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Import</th>
            <th>Contents</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glove-memory</code></td>
            <td>Barrel</td>
          </tr>
          <tr>
            <td><code>glove-memory/core</code></td>
            <td>
              Shared types — <code>Provenance</code>, <code>Link</code>,{" "}
              <code>EmbeddingAdapter</code>, <code>MemorySchema</code>, errors
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/entity</code></td>
            <td>
              <code>EntityMemoryAdapter</code> contract, query DSL, types
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/episodic</code></td>
            <td>
              <code>EpisodicMemoryAdapter</code> contract, <code>Episode</code>{" "}
              types, semantic-search opts
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/resources</code></td>
            <td>
              <code>ResourceFsAdapter</code> contract, file types, POSIX path
              helpers
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/context</code></td>
            <td>
              <code>ContextAdapter</code> contract, <code>ContextEntry</code>{" "}
              type, default markdown rendering
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/tools</code></td>
            <td>
              Auto-registered read/write tool factories and{" "}
              <code>useMemory*</code> / <code>useEpisodic*</code> /{" "}
              <code>useResources*</code> / <code>useContext</code> helpers
            </td>
          </tr>
          <tr>
            <td><code>glove-memory/in-memory</code></td>
            <td>Reference in-process adapters for dev/test</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Schema</h2>

      <p>
        Every memory deployment starts with a <code>MemorySchema</code>. It
        declares node classes (with identity keys for deterministic upsert),
        relationship types, episode kinds, and resource roots. Tool
        descriptions render only the slice of the schema each role needs, so
        the schema is also what bounds prompt surface.
      </p>

      <CodeBlock
        filename="schema definition"
        language="ts"
        code={`import { MemorySchema } from "glove-memory";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],
    searchableProperties: ["name", "email"],
  })
  .defineNodeClass({
    name: "Organization",
    schema: z.object({ name: z.string(), domain: z.string().optional() }),
    identityKeys: [["domain"], ["name"]],
    searchableProperties: ["name"],
  })
  .defineRelationship({ type: "worksAt", from: "Person", to: "Organization" })
  .defineEpisodeKind({ name: "meeting", description: "A scheduled gathering." })
  .defineResourceRoot({ path: "/research", description: "External research artifacts." })
  .defineResourceRoot({ path: "/transcripts", description: "Meeting transcripts." });`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Don&apos;t attach memory tools to your main Glove</h2>

      <p>
        <strong>
          If you&apos;re building an agent that needs memory access, we advise
          against attaching the entity / episodic / resources tools directly to
          your main Glove instance.
        </strong>{" "}
        Build subagents — one per retrieval task — and register them on the
        main agent. Each subagent attaches <strong>only the adapter slice it
        needs</strong>; the main agent stays small and routes to the right
        subagent based on what the user asked for.
      </p>

      <p>Why:</p>

      <ul>
        <li>
          <strong>Bounded prompt surface.</strong> The main agent&apos;s tool
          descriptions don&apos;t render every node class, every relationship,
          every episode kind, and every resource root on every turn. Each
          subagent renders only the schema slice for its role. Token cost
          scales with role, not with total ontology size.
        </li>
        <li>
          <strong>Sharper routing.</strong> Subagent names and descriptions are
          themselves part of the model&apos;s reasoning surface. &quot;When the
          user asks about a person, route to <code>lookup</code>&quot; is a
          tighter signal than &quot;you have these eight memory tools, decide
          which to call.&quot;
        </li>
        <li>
          <strong>Mutation scope is explicit.</strong> A retrieval subagent
          attached with <code>useMemoryReader</code> <em>cannot</em> write —
          the affordance isn&apos;t there. The main agent never has to be told
          &quot;don&apos;t accidentally create entities mid-conversation&quot;;
          it structurally can&apos;t.
        </li>
        <li>
          <strong>Adapters are still shared.</strong> All subagents read and
          write to the same underlying graph, timeline, and filesystem.
          Splitting <em>memory</em> across subagents would defeat the point;
          splitting <em>tools</em> does not.
        </li>
      </ul>

      <p>
        The exception is <code>useContext</code>. Context is small (4 tools),
        user-driven (&quot;remember that…&quot;), and ships with the
        system-prompt-injection wrapper that has to live on the agent the user
        actually talks to. Keep <code>useContext</code> on the main agent.
      </p>

      <CodeBlock
        filename="reader subagents on a main Glove"
        language="ts"
        code={`import { Glove } from "glove-core";
import {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
  useMemoryReader,
  useEpisodicReader,
  useResourcesReader,
  useContext,
} from "glove-memory";

const entity = new InMemoryEntityAdapter({ schema });
const episodic = new InMemoryEpisodicAdapter({ schema, embedder });
const resources = new InMemoryResourcesAdapter({ schema, embedder });
const context = new InMemoryContextAdapter({ schema });

// \`lookup\` — answers "who is Don?", "what do you know about Acme?". Sees
// only the entity graph; doesn't render episode kinds or resource roots.
const lookupFactory = ({ parentStore, parentControls }) =>
  useMemoryReader(
    new Glove({
      store: parentStore,
      model,
      displayManager: parentControls.displayManager,
      systemPrompt:
        "You answer factual questions about people, organizations, and their " +
        "relationships. Use glove_memory_find for fuzzy lookups, glove_memory_get " +
        "for one-hop neighbourhoods, glove_memory_query for deeper traversal.",
      compaction_config: { compaction_instructions: "..." },
      serverMode: true,
    }),
    entity,
  );

// \`recall\` — answers "what did we discuss with Don last week?". Reads
// episodes; reads entity for resolving names to ids.
const recallFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You answer questions about past events. Resolve participant names to " +
      "ids via glove_memory_find first, then use glove_episodic_timeline / " +
      "glove_episodic_find / glove_episodic_search depending on whether the " +
      "user asked about a specific person, a window, or a topic.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  return glove;
};

// \`find-notes\` — answers "what notes do we have on Aptos regulation?".
// Browses the filesystem; reads entity for "notes about <person>".
const findNotesFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You find research notes, transcripts, and link collections in the " +
      "resource filesystem. Use glove_resources_grep / _glob / _search to " +
      "locate files; glove_resources_read to fetch their contents. When the " +
      "user asks for notes about a specific person or organization, look up " +
      "the entity id first and use glove_resources_links_for to find " +
      "everything that links to it.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useResourcesReader(glove, resources);
  return glove;
};

// Main agent — keeps useContext for the system-prompt injection and the
// small "remember that..." tool surface, but offloads every other memory
// task to a subagent.
const main = useContext(new Glove({ /* ... */ }), context)
  .defineSubAgent({ name: "lookup", description: "Look up people, organizations, and their relationships.", factory: lookupFactory })
  .defineSubAgent({ name: "recall", description: "Recall past meetings, decisions, and events.", factory: recallFactory })
  .defineSubAgent({ name: "find-notes", description: "Find research notes, transcripts, and links.", factory: findNotesFactory })
  .build();`}
      />

      <p>
        The shape generalises: any subagent the developer registers picks the
        smallest combination of <code>use*Reader</code> /{" "}
        <code>use*Curator</code> calls that makes its job possible. Reader-only
        when it&apos;s just resolving ids or summaries; curator when it
        actually needs to mutate; nothing at all when memory isn&apos;t
        relevant.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Curator composition — same pattern on the write side</h2>

      <p>
        The same advice applies to the curator. A parent curator that routes
        to specialised write-side subagents — entity-linker, episode-recorder,
        resource-writer — is preferable to a single curator with every write
        tool attached. Each subagent attaches <strong>only the adapters it
        needs</strong>, so its tool descriptions render only the schema slice
        for its role. The entity-linker never sees episode kinds; the
        episode-recorder gets a read-only view of entity classes (so it can
        resolve participant ids) plus the episode-kind list for writes; the
        resource-writer gets read access to entities and episodes so it can
        populate <code>metadata.links</code> correctly.
      </p>

      <p>
        Subagents share the parent&apos;s adapters — there&apos;s no
        per-subagent memory namespace. What the linker writes, the recorder
        immediately reads.
      </p>

      <CodeBlock
        filename="curator routing to scoped write-side subagents"
        language="ts"
        code={`import { Glove } from "glove-core";
import {
  useMemoryCurator,
  useMemoryReader,
  useEpisodicCurator,
  useEpisodicReader,
  useResourcesCurator,
} from "glove-memory";

// Sees: node classes, relationships. NOT episode kinds, NOT resource roots.
const linkerFactory = ({ parentStore, parentControls }) =>
  useMemoryCurator(
    new Glove({ /* ... */ }),
    entity,
  );

// Sees: episode kinds (for writes) + read-only entity classes (to resolve
// participant ids). Does NOT see resource roots.
const recorderFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({ /* ... */ });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicCurator(glove, episodic);
  return glove;
};

// Sees: resource roots + read-only entities and episodes (so metadata.links
// points at real ids). Does NOT see write tools for entity / episodic.
const filerFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({ /* ... */ });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  glove = useResourcesCurator(glove, resources);
  return glove;
};

// The parent curator owns no memory tools itself — it just routes. Its job
// is reading the conversation slice and dispatching to the right subagent
// in sequence (linker -> recorder -> filer).
const curator = new Glove({ /* ... */ })
  .defineSubAgent({ name: "linker", description: "Extract entities and relationships.", factory: linkerFactory })
  .defineSubAgent({ name: "recorder", description: "Record episodes; resolves participant ids first.", factory: recorderFactory })
  .defineSubAgent({ name: "filer", description: "File research artifacts; resolves link targets first.", factory: filerFactory })
  .build();`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Tool surfaces</h2>

      <p>
        Each subsystem auto-registers a focused set of tools. Read-on-demand
        tools attach via <code>use*Reader</code>; write tools attach via{" "}
        <code>use*Curator</code>. Context is the exception — it has a single
        registration that attaches read and write tools and the
        system-prompt-injection wrapper.
      </p>

      <h3>Entity reader / curator</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>glove_memory_find</code></td><td>Find nodes by class + filter, optional fuzzy</td></tr>
          <tr><td><code>glove_memory_get</code></td><td>Fetch a node by id + one-hop neighbourhood</td></tr>
          <tr><td><code>glove_memory_query</code></td><td>Full structured query via the query DSL</td></tr>
          <tr><td><code>glove_memory_add_node</code></td><td>Create or upsert a node by identity keys <em>(curator)</em></td></tr>
          <tr><td><code>glove_memory_update_node</code></td><td>Patch a node&apos;s properties <em>(curator)</em></td></tr>
          <tr><td><code>glove_memory_connect</code></td><td>Create or update an edge <em>(curator)</em></td></tr>
          <tr><td><code>glove_memory_disconnect</code></td><td>Remove an edge <em>(curator)</em></td></tr>
          <tr><td><code>glove_memory_merge_nodes</code></td><td>Fold one node into another <em>(curator)</em></td></tr>
        </tbody>
      </table>

      <h3>Episodic reader / curator</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>glove_episodic_search</code></td><td>Content search over episodes — embedding-based semantic or in-process fuzzy/lexical, depending on the adapter <em>(only registered when adapter advertises <code>supportsSemanticSearch</code>)</em></td></tr>
          <tr><td><code>glove_episodic_find</code></td><td>Structured filter — by kind, participant, time range, properties</td></tr>
          <tr><td><code>glove_episodic_timeline</code></td><td>Chronological listing for an entity or time window</td></tr>
          <tr><td><code>glove_episodic_record</code></td><td>Append a new episode <em>(curator)</em></td></tr>
          <tr><td><code>glove_episodic_update</code></td><td>Patch an existing episode <em>(curator)</em></td></tr>
          <tr><td><code>glove_episodic_delete</code></td><td>Remove an episode <em>(curator)</em></td></tr>
        </tbody>
      </table>

      <h3>Resources reader / curator</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>glove_resources_ls</code></td><td>List directory contents</td></tr>
          <tr><td><code>glove_resources_read</code></td><td>Read a file body, with optional line range</td></tr>
          <tr><td><code>glove_resources_stat</code></td><td>Get metadata about a single path</td></tr>
          <tr><td><code>glove_resources_grep</code></td><td>Text/regex search across the tree</td></tr>
          <tr><td><code>glove_resources_glob</code></td><td>Find paths by name pattern</td></tr>
          <tr><td><code>glove_resources_search</code></td><td>Semantic search <em>(only registered when adapter advertises <code>supportsSemanticSearch</code>)</em></td></tr>
          <tr><td><code>glove_resources_links_for</code></td><td>Reverse-lookup: find resources linking to a target</td></tr>
          <tr><td><code>glove_resources_write</code></td><td>Create or overwrite a file <em>(curator)</em></td></tr>
          <tr><td><code>glove_resources_edit</code></td><td>Replace a unique substring <em>(curator)</em></td></tr>
          <tr><td><code>glove_resources_mkdir</code></td><td>Create an empty directory <em>(curator)</em></td></tr>
          <tr><td><code>glove_resources_move</code></td><td>Rename or relocate <em>(curator)</em></td></tr>
          <tr><td><code>glove_resources_remove</code></td><td>Delete a file or directory <em>(curator)</em></td></tr>
          <tr><td><code>glove_resources_set_metadata</code></td><td>Patch metadata without rewriting body <em>(curator)</em></td></tr>
        </tbody>
      </table>

      <h3>Context</h3>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>glove_context_get</code></td><td>Read entries by section or list all</td></tr>
          <tr><td><code>glove_context_set</code></td><td>Add a new entry</td></tr>
          <tr><td><code>glove_context_update</code></td><td>Patch an existing entry in place</td></tr>
          <tr><td><code>glove_context_unset</code></td><td>Remove an entry or wipe an entire section</td></tr>
        </tbody>
      </table>

      <p>
        <code>useContext</code> wraps <code>Glove.processRequest</code>. On
        every turn it calls <code>adapter.render()</code> to materialise pinned
        entries as a markdown block, composes <code>&lt;base systemPrompt&gt;</code>{" "}
        + <code>\n\n</code> + <code>&lt;rendered context&gt;</code>, and calls{" "}
        <code>setSystemPrompt</code>. Pinned context goes <strong>after</strong>{" "}
        the developer&apos;s system prompt — developer prompt sets agent
        character and guardrails; user context modifies engagement for this
        specific user. Re-rendering happens every turn, so external updates the
        user made between turns are reflected immediately.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Embedding lifecycle</h2>

      <p>
        Episodic and resources adapters generate embeddings <strong>out-of-band</strong>.
        Writes mark records <code>embeddingStatus: &quot;missing&quot;</code>{" "}
        (initial) or <code>&quot;stale&quot;</code> (content change) and return
        immediately. A separate process — typically a{" "}
        <a href="https://station.dterminal.net">Station</a> signal — picks
        them up via <code>findEpisodesNeedingEmbedding</code> /{" "}
        <code>findFilesNeedingEmbedding</code>, calls the configured{" "}
        <code>EmbeddingAdapter</code>, and writes vectors back via{" "}
        <code>setEmbedding</code>.
      </p>

      <p>
        The <code>EmbeddingAdapter</code> contract is intentionally tiny —
        consumers plug in whatever provider they want without the package
        taking on a model dependency. The same <code>embeddingStatus</code> /{" "}
        <code>findEpisodesNeedingEmbedding</code> / <code>setEmbedding</code>{" "}
        lifecycle doubles as a{" "}
        <strong>generic background-indexing seam</strong> for any search
        backend — not just embeddings (see below).
      </p>

      {/* ------------------------------------------------------------------ */}
      <h3>Content search without embeddings (fuzzy mode)</h3>

      <p>
        Embeddings are <strong>opt-in, not required</strong>.{" "}
        <code>glove_episodic_find</code> (kind / participant / time / property
        filters) and <code>glove_episodic_timeline</code> need nothing. Only{" "}
        <code>glove_episodic_search</code> needs a ranking backend, and that
        backend doesn&apos;t have to be vectors. Pass{" "}
        <code>fuzzySearch: true</code> (and no <code>embedder</code>) to{" "}
        <code>InMemoryEpisodicAdapter</code> for in-process lexical search over
        episode content — exact-phrase and substring hits plus a bigram-Dice
        fuzzy fallback that tolerates typos. It sets{" "}
        <code>supportsSemanticSearch: true</code> with zero external services,
        no vectors, and no out-of-band embed loop. <code>embedder</code> wins
        when both are supplied.
      </p>

      <CodeBlock
        filename="content search, no embeddings"
        language="ts"
        code={`// No embeddings, no external service — content search still works.
const episodic = new InMemoryEpisodicAdapter({ schema, fuzzySearch: true });`}
      />

      {/* ------------------------------------------------------------------ */}
      <h3>Custom adapter with a background-built index (BYO search)</h3>

      <p>
        For production, implement your own{" "}
        <code>EpisodicMemoryAdapter</code>. The <code>embeddingStatus</code> +{" "}
        <code>findEpisodesNeedingEmbedding</code> + <code>setEmbedding</code>{" "}
        methods are a{" "}
        <strong>generic background-indexing lifecycle</strong> — the index can
        be a vector store, SQLite FTS5, Postgres <code>tsvector</code>, BM25,
        Meilisearch, Tantivy. To back <code>glove_episodic_search</code> with
        it, set <code>supportsSemanticSearch: true</code> and implement{" "}
        <code>searchEpisodes</code>.
      </p>

      <ul>
        <li>
          <strong>Writes</strong> (<code>recordEpisode</code> /{" "}
          <code>updateEpisode</code> / <code>deleteEpisode</code>) persist to
          the primary store, mark the row <code>missing</code> /{" "}
          <code>stale</code>, and return immediately — no indexing on the hot
          path.
        </li>
        <li>
          <strong>Structured reads</strong> (<code>findEpisodes</code> /{" "}
          <code>episodesForEntity</code> / <code>episodesBetween</code>) query
          the primary store directly and stay current — they don&apos;t depend
          on the index.
        </li>
        <li>
          <strong>Index lifecycle</strong>:{" "}
          <code>findEpisodesNeedingEmbedding</code> returns the dirty rows; the
          background worker builds the index artifact and calls{" "}
          <code>setEmbedding(id, vector)</code> to commit it and mark the row{" "}
          <code>fresh</code>.
        </li>
        <li>
          <strong>
            <code>searchEpisodes(query, opts)</code>
          </strong>{" "}
          queries the index, applies <code>opts.filter</code>, and returns{" "}
          <code>&#123; episode, score, distance &#125;</code> sorted by{" "}
          <code>score</code> descending (strip <code>provenance</code>;
          normalize relevance to [0, 1] before the recency blend).
        </li>
      </ul>

      <CodeBlock
        filename="out-of-band reindex worker"
        language="ts"
        code={`// A Station signal, cron, or queue consumer. Index type is your choice.
async function reindexPass() {
  const pending = await adapter.findEpisodesNeedingEmbedding({ limit: 100 });
  if (!pending.length) return;
  const artifacts = await buildIndex(pending.map((p) => p.content)); // vectors | FTS docs | BM25 postings
  for (let i = 0; i < pending.length; i++) {
    await adapter.setEmbedding(pending[i].id, artifacts[i]); // commit + mark fresh
  }
}`}
      />

      <p>
        A just-recorded episode is visible to <code>find</code> /{" "}
        <code>timeline</code> immediately but to <code>search</code> only after
        the worker catches up (eventual consistency).{" "}
        <code>setEmbedding</code>&apos;s <code>vector</code> param is only
        meaningful for a vector index — for FTS / BM25 / an external service,
        ignore it and treat <code>setEmbedding</code> as{" "}
        &quot;write my doc + mark fresh&quot;.
      </p>

      <h3>Implementation choices in the in-memory adapters</h3>

      <ul>
        <li>
          <strong>Stale marking is content-only on episodes.</strong>{" "}
          <code>updateEpisode</code> flips{" "}
          <code>embeddingStatus: &quot;stale&quot;</code> and drops the cached
          vector only when the <code>content</code> field changes — kind /
          participant / property / <code>occurredAt</code> patches don&apos;t
          re-embed. The embedding represents <code>content</code>; the spec is
          silent on the others. Consumers wanting different behaviour can
          delete + re-record.
        </li>
        <li>
          <strong>Recency blend uses a 30-day half-life.</strong>{" "}
          <code>searchEpisodes</code> ranks by{" "}
          <code>(1 - recencyWeight) * semanticScore + recencyWeight * recencyScore</code>{" "}
          where <code>recencyScore = exp(-ln(2) * ageMs / halfLifeMs)</code>,{" "}
          <code>halfLifeMs = 30 days</code>. Default{" "}
          <code>recencyWeight = 0.2</code>. Companion adapters (sqlite/postgres)
          may pick different curves; only the shape of the blend is fixed by
          the spec.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Reconciliation primitives</h2>

      <p>
        The package&apos;s contract is deliberately narrow: store, query,
        write, search. It does <strong>not</strong> cascade across adapters.
        When an entity is merged or deleted, episodes that reference its old
        id don&apos;t update on their own. Orchestrators reach for the
        cross-adapter primitives instead — most importantly{" "}
        <code>episodic.replaceParticipantId</code> and{" "}
        <code>resources.replaceLinkTarget</code> for the merge case.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Primitive</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Entity merged</td>
            <td>
              <code>episodic.replaceParticipantId(oldId, newId, prov)</code>,{" "}
              <code>resources.replaceLinkTarget(&quot;entity&quot;, oldId, newId, prov)</code>
            </td>
          </tr>
          <tr>
            <td>Entity deleted</td>
            <td>
              <code>episodic.findEpisodes(&#123; where: &#123; participantIds: [id] &#125; &#125;)</code>,{" "}
              <code>resources.linksFor(&quot;entity&quot;, id)</code> then
              orchestrator decides
            </td>
          </tr>
          <tr>
            <td>Resource moved</td>
            <td>
              <code>resources.replaceLinkTarget(&quot;resource&quot;, fromPath, toPath, prov)</code>
            </td>
          </tr>
          <tr>
            <td>Episode deleted</td>
            <td>
              <code>resources.linksFor(&quot;episode&quot;, id)</code> then
              orchestrator decides
            </td>
          </tr>
          <tr>
            <td>Stale embeddings</td>
            <td>
              <code>findEpisodesNeedingEmbedding</code> /{" "}
              <code>findFilesNeedingEmbedding</code> → embed →{" "}
              <code>setEmbedding</code>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Reference adapters</h2>

      <p>
        The package ships in-process reference adapters under{" "}
        <code>glove-memory/in-memory</code>:{" "}
        <code>InMemoryEntityAdapter</code>,{" "}
        <code>InMemoryEpisodicAdapter</code>,{" "}
        <code>InMemoryResourcesAdapter</code>, and{" "}
        <code>InMemoryContextAdapter</code>. They&apos;re intended for
        development and tests — every adapter contract is implemented end to
        end so you can wire up a full schema, exercise the tool surfaces, and
        write integration tests without standing up a database.
      </p>

      <p>
        Companion storage backends ship as separate packages —{" "}
        <code>glove-memory-sqlite</code> and <code>glove-memory-postgres</code>{" "}
        — and are not part of the v0.1 release.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What this package doesn&apos;t own</h2>

      <ul>
        <li>Triggering, scheduling, or pipeline orchestration (<a href="https://station.dterminal.net">Station</a>&apos;s territory).</li>
        <li>The curation logic itself (configured by the consumer).</li>
        <li>
          Embedding <em>generation</em> — consumers plug in their own{" "}
          <code>EmbeddingAdapter</code>.
        </li>
        <li>
          Schema persistence or migration — schema lives in code; consistency
          across deployments is the consumer&apos;s concern.
        </li>
        <li>
          Cross-adapter cascade on entity merge, episode delete, or resource
          rename — that&apos;s reconciliation, an orchestrator responsibility.
        </li>
        <li>
          The user-side write path for context — the adapter exposes{" "}
          <code>set</code> / <code>update</code> / <code>unset</code>; the UI /
          API / form / wherever users edit their preferences calls those
          directly.
        </li>
        <li>Binary resources. Resources is text-only.</li>
        <li>
          <code>.</code> and <code>..</code> path resolution. All paths are
          absolute.
        </li>
      </ul>
    </div>
  );
}
