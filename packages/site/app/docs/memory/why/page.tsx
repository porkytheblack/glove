export default async function WhyMemoryPage() {
  return (
    <div className="docs-content">
      <h1>Why Memory</h1>

      <p>
        Agents need to remember. That much is obvious. What isn&apos;t obvious
        — and what most agent frameworks get wrong — is that &quot;memory&quot;
        is several different things wearing the same name, each with its own
        shape, access pattern, and write rules. Treat them as one thing and
        the system rots; build them as separate primitives and the agent gets
        sharper with every conversation.
      </p>

      <p>
        Glove&apos;s memory layer started as a single graph database for
        entities and grew into four orthogonal primitives. Each one earned its
        place by being structurally different from what already existed. This
        is the journey, and the philosophy that crystallised along the way.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The first cut: who&apos;s actually writing?</h2>

      <p>
        The first design instinct is to give the conversational agent tools to
        add, link, and update memory as it talks. This is the wrong instinct.
        An agent in a conversation has narrow context, time pressure from the
        user waiting on a response, and an incentive to commit prematurely. It
        will create duplicate entities, miss merges, write half-formed records,
        and leave the graph in worse shape than it found it.
      </p>

      <p>
        So Glove draws a hard line: the conversational agent{" "}
        <strong>only reads memory</strong>. A separate <strong>curator</strong>
        {" "}— itself a Glove instance, but one triggered by orchestration
        rather than by a user message — runs over conversation history
        asynchronously, extracts what&apos;s worth keeping, dedupes, links,
        merges. It can take its time. It can reason carefully. It can run
        multiple specialised subagents in sequence: classify, then link
        entities, then record events, then file artifacts.
      </p>

      <p>
        This split is the spine of the whole system. Everything else falls out
        of it.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Entity memory: things that recur</h2>

      <p>
        The first primitive is a typed graph. Node classes are registered up
        front (<code>Person</code>, <code>Organization</code>,{" "}
        <code>Project</code>); relationships connect them with their own typed
        properties (<code>worksAt</code>, <code>contributesTo</code>); identity
        is deterministic via configured key sets. When the curator says
        &quot;add a Person named Don with email don@cradle.io,&quot; the
        adapter checks the email key set, finds the existing node, and folds
        the write in rather than creating a duplicate.
      </p>

      <p>
        The trick that makes this hold up over time is{" "}
        <strong>multi-set identity keys</strong>. Real entities aren&apos;t
        uniquely identified by one field — a Person might be matchable by
        email <em>or</em> by (name + organizationId). Single-key identity is
        a toy; multi-set is the realistic case. Get this right at the contract
        level and the graph stays clean for years.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Episodic memory: things that happened</h2>

      <p>
        Entity memory captures stable facts. It doesn&apos;t capture events.
        &quot;Don completed the Q3 presentation on April 15&quot; isn&apos;t
        an entity — it&apos;s an episode. It happened once, at a moment, and
        is then a permanent fact about the timeline. Identity keys make no
        sense; semantic search over content does; time is a first-class field.
      </p>

      <p>
        Episodic memory is its own adapter — append-only, time-indexed, keyed
        off natural-language content rather than typed identity. The
        participants reference entity node IDs, but the two adapters stay
        decoupled — the episodic adapter just stores strings and trusts the
        curator to keep them coherent. Episode kinds are registered alongside
        node classes (<code>meeting</code>, <code>milestone</code>,{" "}
        <code>decision</code>) so the curator picks from a known vocabulary.
      </p>

      <p>
        Embedding for semantic search runs <strong>out of band</strong> —{" "}
        <code>recordEpisode</code> writes immediately and marks the embedding
        status as missing; a separate process picks up missing embeddings
        later and fills them in. This keeps writes fast and decouples
        embedding cost from the curator&apos;s hot path.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Resources: things the agent browses</h2>

      <p>
        Then a third gap appeared. Research dossiers, whitepapers,
        transcripts, link collections, agent-generated notes — these
        aren&apos;t entities (they don&apos;t recur) and they aren&apos;t
        episodes (they aren&apos;t events). They&apos;re <em>artifacts</em>.
        Substantial content the agent should know exists and can read on
        demand, but shouldn&apos;t always pull into context.
      </p>

      <p>
        The first sketch invented a bucket-and-topic structure. The reframe
        that cracked it: don&apos;t invent a new abstraction — give the agent
        a <strong>filesystem</strong>. A POSIX-style virtual filesystem with{" "}
        <code>ls</code>, <code>read</code>, <code>grep</code>,{" "}
        <code>glob</code>, <code>edit</code>. Code-trained models already know
        how to navigate filesystems; giving them one removes the need to
        teach a new mental model.
      </p>

      <p>
        Files are text-only (markdown, plain text, URLs with optional cached
        extracts — binary deliberately excluded; if the data isn&apos;t
        textual, it doesn&apos;t belong here). Reads are line-bounded by
        default, fifty lines at a time, expandable on request. Edit follows
        the unique-substring-replace pattern Claude Code uses. Both the
        curator and the user can write — the user drops research notes via
        a UI, the curator enriches them with metadata and entity links later.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Context: the standing brief</h2>

      <p>
        The fourth primitive is the one I almost didn&apos;t build, then
        realised I&apos;d been hand-rolling it in every agent project for
        years. <strong>Context</strong> is the user&apos;s standing brief on
        themselves: identity, preferences, glossary, current task scope. The
        plumbing every agent needs and that nobody wants to write again from
        scratch.
      </p>

      <p>
        Context is structurally different from the other three. It&apos;s not
        curator-extracted — it&apos;s user-configured. It&apos;s not lazily
        browsed — it&apos;s auto-injected into the system prompt at every
        turn so the agent always has it. It&apos;s not reader/curator-split —
        there&apos;s just one builder method, <code>useContext(adapter)</code>,
        and the conversational agent gets both read and write tools because
        users naturally tell agents &quot;remember that I prefer X.&quot;
      </p>

      <p>
        External updates are out of scope for the package — the adapter
        exposes <code>set</code> / <code>update</code> / <code>unset</code>{" "}
        and however your settings UI or API talks to it is up to you. The
        package&apos;s job is just to provide the contract and to handle the
        system-prompt composition cleanly: developer prompt first (character,
        guardrails), user context after (preferences, glossary), regenerated
        every turn so external updates are reflected immediately.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>The philosophy that emerged</h2>

      <p>Across all four primitives, the same patterns held:</p>

      <p>
        <strong>Adapters all the way down.</strong> Same shape Glove already
        uses for storage, models, display. BYO backend; the contract is what
        matters. Storage backends ship as separate packages so consumers
        don&apos;t pull in dependencies they don&apos;t need.
      </p>

      <p>
        <strong>Composition over configuration.</strong> When the question
        came up about whether large schemas would balloon tool-description
        token costs, the answer turned out to be architectural rather than
        configurational. You don&apos;t add scope-restricting API knobs; you
        split the curator into specialist subagents, each attaching only the
        adapters it needs. Each subagent&apos;s tool descriptions render only
        the slice of schema relevant to its role. The system scales by adding
        agents, not by adding flags.
      </p>

      <p>
        <strong>Provenance on every write.</strong> Every node, edge, episode,
        file, and context entry carries an append-only log of who wrote what
        when, with what intent. This is what makes the system debuggable —
        without it you have a database; with it you have a memory you can
        reason about.
      </p>

      <p>
        <strong>Primitives, not policies.</strong> The package provides strong
        primitives (identity-keyed upsert, link target rewrites, participant
        rewrites, async embedding lifecycle) and stays out of orchestration
        policy. When to run the curator, how to retry, what to do on conflict
        — that&apos;s all{" "}
        <a href="https://station.dterminal.net">Station</a>&apos;s territory
        or the consumer&apos;s. <code>glove-memory</code> just gives you
        something solid to build that on.
      </p>

      <p>
        <strong>Reconciliation is explicit.</strong> The package doesn&apos;t
        cascade across adapters. When you merge two entities, episodes that
        referenced the old ID don&apos;t update on their own — but{" "}
        <code>replaceParticipantId</code> is right there as the primitive the
        orchestrator reaches for. Cleaner than implicit cascades because you
        always know what&apos;s happening.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What this gives you</h2>

      <p>
        Four primitives, one package, one adapter pattern. Plug in whichever
        subset you need. The conversational agent gets readers; a{" "}
        <a href="https://station.dterminal.net">Station</a>-orchestrated
        curator gets writers; users plug into resources and context directly.
        Memory becomes something you compose rather than something you
        configure.
      </p>

      <p>Less plumbing. More shape.</p>

      <p style={{ marginTop: "2.5rem", fontSize: "0.9rem", opacity: 0.7 }}>
        See <a href="/docs/memory">Memory</a> for the full API reference.
      </p>
    </div>
  );
}
