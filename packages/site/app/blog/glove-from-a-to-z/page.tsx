import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost } from "@/lib/blog";

const post = getPost("glove-from-a-to-z")!;

export const metadata = {
  title: post.title,
  description: post.summary,
};

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Start with a loop that calls a function. Add one thing at a time, only
        when something breaks. By the end you have a voice-capable, memory-backed,
        multi-agent system in a container — and you understand every piece,
        because you watched each one earn its place.
      </p>

      <p>
        The docs answer &ldquo;how do I do X in Glove&rdquo;. This is the other
        question: <em>why is any of it there</em>. So we build an agent from
        nothing, and at each step we do the smallest thing that works, run into
        the wall that makes it stop working, and reach for the next primitive.
        The order below is roughly the order the framework itself grew in.
      </p>

      <p>
        Everything here is real API. If you want to follow along, the{" "}
        <a href="/docs/getting-started">quickstart</a> gets you a project in
        fifteen minutes.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="the-loop">A. The loop is the whole idea</h2>

      <p>
        An agent is not a model. An agent is a <strong>loop around</strong> a
        model, and it is small enough to write on a napkin:
      </p>

      <CodeBlock
        filename="the agent loop, in full"
        language="typescript"
        code={`let messages = [userMessage];

while (true) {
  const reply = await model.prompt({ messages, tools });
  messages.push(reply);

  if (reply.toolCalls.length === 0) return reply.text;  // it is done talking

  for (const call of reply.toolCalls) {
    const result = await tools[call.name].run(call.input);
    messages.push({ role: "tool", call_id: call.id, result });
  }
}`}
      />

      <p>
        That is it. The model reads a list of tools, picks one, you run it, you
        hand the result back, it decides again. Nothing in there is clever. The
        interesting part is that this loop replaces something we have been
        writing by hand for twenty years: <strong>routing</strong>. Pages,
        navigation hierarchies, wizard steps, &ldquo;if the cart is empty show
        the empty state&rdquo; — that is control flow encoded in UI, and the
        loop above does it from a sentence instead.
      </p>

      <p>
        So if the loop is this simple, what is a framework for? Everything that
        happens the moment you run this in production: the conversation
        outgrowing the context window, the tool that needs to ask the user a
        question mid-run, the fifty tools you cannot afford to send on every
        turn, the second agent, the container it all ships in. Each section
        below is one of those.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="first-agent">B. The smallest agent that does something</h2>

      <p>
        Here is the loop above, in Glove, with one capability attached. No React,
        no server, no database — a script you can run with <code>tsx</code>.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { Glove, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You help people track parcels.",
  serverMode: true,
  compaction_config: {
    compaction_instructions: "Summarise the conversation so far.",
  },
})
  .fold({
    name: "track_parcel",
    description: "Look up the current status of a parcel by its tracking number.",
    inputSchema: z.object({
      tracking: z.string().describe("The carrier tracking number"),
    }),
    async do(input) {
      const status = await carrier.track(input.tracking);
      return { status: "success", data: status };
    },
  })
  .build();

const result = await agent.processRequest("where is 1Z999AA10123456784?");
console.log(result.messages.at(-1)?.text);`}
      />

      <p>
        Four things are worth naming, because they recur everywhere below.
      </p>

      <p>
        <strong><code>fold</code> adds a capability</strong> and returns the
        builder, so tools chain. It is also legal <em>after</em>{" "}
        <code>build()</code> — that is not a curiosity, it is how tools get
        added mid-conversation later on.
      </p>

      <p>
        <strong>The description is the interface.</strong> Not the function name,
        not the types — the sentence. The model chooses tools by reading it, so
        a vague description is a bug, and every <code>.describe()</code> on a
        schema field is documentation the model actually consumes.
      </p>

      <p>
        <strong>No store was passed.</strong> Glove built one — a{" "}
        <code>MemoryStore</code>, process-local, gone on restart. Fine for a
        script; section D is where that stops being fine.
      </p>

      <p>
        <strong><code>serverMode: true</code></strong> is the canonical &ldquo;I
        am headless&rdquo; flag. It tells the parts of the framework that would
        otherwise try to ask a human something not to.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="tools">C. Tools, and the two audiences of a result</h2>

      <p>
        A tool returns a result, and that result has two readers who want
        different things. The model wants a compact description it can reason
        about. The screen wants everything needed to draw a card. Sending both to
        both is how a context window fills with base64.
      </p>

      <p>So a result is split:</p>

      <CodeBlock
        filename="a tool result"
        language="typescript"
        code={`return {
  status: "success",
  data: \`Delivered 2026-08-05 to the front desk.\`,  // → the model
  renderData: { events, signature, mapTile },        // → your renderers only
};`}
      />

      <p>
        Model adapters strip <code>renderData</code> before the request goes out.
        That makes it the right place for anything the model has no business
        seeing — image bytes, internal ids, a customer&apos;s email address — and
        it is what <code>renderResult</code> reads when redrawing the
        conversation from history.
      </p>

      <p>
        The same split has a second, quieter form. Long results poison later
        turns: a file you read on turn two is still costing tokens on turn
        twenty. Turn on <code>enableToolResultSummary</code>, give a tool a{" "}
        <code>generateToolSummary</code>, and the full payload is swapped for a
        one-line summary <em>once the turn is over</em> — current results stay
        whole, older ones shrink to &ldquo;Read invoice.pdf, 4 pages&rdquo;. The
        store keeps both; only what goes to the model is rewritten.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="display">D. Where the UI went</h2>

      <p>
        The loop returns text. Real apps need to show a product grid, take a
        card number, get a yes or no. The conventional answer is to route to a
        page. Glove&apos;s answer is that a tool <strong>pushes</strong> UI onto
        a stack, and can block on it.
      </p>

      <CodeBlock
        filename="lib/tools.tsx"
        language="tsx"
        code={`const confirmDelivery = defineTool({
  name: "confirm_redelivery",
  description: "Ask the user to confirm a redelivery date before booking it.",
  inputSchema: z.object({ date: z.string(), address: z.string() }),
  displayPropsSchema: z.object({ date: z.string(), address: z.string() }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete",

  async do(input, display) {
    const ok = await display.pushAndWait(input);   // ← the tool pauses here
    if (!ok) return { status: "success", data: "User declined the date." };
    await carrier.book(input);
    return { status: "success", data: "Redelivery booked.", renderData: input };
  },

  render({ props, resolve }) {
    return (
      <Card>
        <p>Redeliver to {props.address} on {props.date}?</p>
        <button onClick={() => resolve(true)}>Yes</button>
        <button onClick={() => resolve(false)}>Pick another day</button>
      </Card>
    );
  },
});`}
      />

      <p>
        <code>pushAndWait</code> suspends the tool — and with it the agent loop —
        until something calls <code>resolve</code>. <code>pushAndForget</code>{" "}
        renders and carries on. That one distinction covers the whole space
        between &ldquo;here are your results&rdquo; and &ldquo;I need an answer
        before I can continue&rdquo;, and it is why a Glove app tends not to have
        routes: the agent decides what is on screen, in the order the
        conversation needs it.
      </p>

      <p>
        The display manager is an adapter, so the same tool works wherever you
        can draw. In React, <code>useGlove()</code> and{" "}
        <code>&lt;Render&gt;</code> handle it. On a server the slot goes over a
        WebSocket and <code>dm.resolve(slotId, value)</code> comes back from
        whatever the client is — a terminal, a Slack message, a phone.
      </p>

      <div className="blog-note">
        <strong>Voice changes this rule.</strong> A tool that blocks on a click
        is unusable when the user is driving. In voice-first apps prefer{" "}
        <code>pushAndForget</code> and put the answer in <code>data</code>, where
        the model can say it out loud.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="store">E. State, and the four things you get for free</h2>

      <p>
        The conversation has to live somewhere. That somewhere is a{" "}
        <code>StoreAdapter</code>: messages in, messages out, plus token and turn
        counters. Implement it over Postgres, Redis, a file, whatever you already
        run.
      </p>

      <p>
        The interesting part is what is <em>optional</em> on that interface.
        Implement more methods and features switch themselves on:
      </p>

      <table>
        <thead>
          <tr>
            <th>Implement</th>
            <th>You get</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>getTasks</code> / <code>addTasks</code> / <code>updateTask</code></td>
            <td>A <code>glove_update_tasks</code> tool — the agent keeps its own to-do list across a long job</td>
          </tr>
          <tr>
            <td><code>getPermission</code> / <code>setPermission</code></td>
            <td>Consent gating for tools marked <code>requiresPermission</code></td>
          </tr>
          <tr>
            <td>The four inbox methods</td>
            <td><code>glove_post_to_inbox</code>, and everything built on it</td>
          </tr>
          <tr>
            <td><code>createSubAgentStore</code></td>
            <td>Subagents with their own isolated (or durable) history</td>
          </tr>
        </tbody>
      </table>

      <p>
        Skip them and they are silently disabled. Nothing to configure, nothing
        to turn off.
      </p>

      <p>
        The <strong>inbox</strong> deserves a paragraph of its own, because it is
        the least obvious primitive in the framework and the most reused. It is a
        mailbox for things that cannot be answered now. The agent posts &ldquo;tell
        me when this parcel actually moves&rdquo;; the conversation ends; three
        hours later a webhook resolves the item; on the next{" "}
        <code>ask()</code> the answer is injected as context and the agent picks
        up where it left off. Nothing polled, nothing held open. Two packages
        further down this page are built on that one mechanism.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="context">F. The conversation outgrows the window</h2>

      <p>
        Every agent hits this. The fix is compaction: past a threshold, the
        conversation so far is summarised into one message, and the model is
        shown the summary plus everything after it.
      </p>

      <p>
        The detail that matters is what the <em>store</em> keeps. Full history —
        always. Compaction splits what the model sees; it does not delete what
        happened. Your transcript UI still renders the whole thing, your
        analytics still see every turn, and a summary message is just a message
        flagged <code>is_compaction: true</code>. Pending inbox items survive the
        summary too, because &ldquo;I am still waiting on something&rdquo; is
        exactly the fact a summariser would otherwise drop.
      </p>

      <p>
        Between tool-result summaries and compaction, context stops being
        something you think about until you are doing something genuinely large —
        at which point section I is the real answer.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="permission">G. Saying no</h2>

      <p>
        An agent that can book a redelivery can book forty. Mark a tool{" "}
        <code>requiresPermission</code> and the executor checks the store before
        it runs.
      </p>

      <p>
        Two details make this usable rather than annoying. Permission is keyed on{" "}
        <strong>tool and input</strong>, not tool alone — approving{" "}
        <code>rm build/</code> does not approve <code>rm /</code>, and repeating
        the identical call reuses the decision. And the gate itself can be a
        function of the input:
      </p>

      <CodeBlock
        filename="one tool, two risk levels"
        language="typescript"
        code={`{
  name: "bash",
  description: "Run a shell command in the project directory.",
  inputSchema: z.object({ cmd: z.string() }),
  requiresPermission: (input) => !/^(ls|cat|grep|git status)\\b/.test(input.cmd),
  async do(input) { /* … */ },
}`}
      />

      <p>
        Reads run free; anything else asks. Your store decides how to answer —
        exact match, a regex allowlist, a prompt on screen, a policy engine. The
        framework only asks the question.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="extensions">H. Shaping the agent from outside the loop</h2>

      <p>
        Three extension points, and the difference between them is <em>when</em>{" "}
        they fire.
      </p>

      <p>
        <strong>Hooks</strong> run before the model does, on a{" "}
        <code>/token</code> in the user&apos;s message. They get the real
        controls: force a compaction, swap the model mid-conversation, rewrite
        the message, or short-circuit the turn entirely so the model is never
        called. <code>/stop</code>, <code>/compact</code>, <code>/model haiku</code> —
        all four lines of code.
      </p>

      <p>
        <strong>Skills</strong> inject context. <code>/concise</code> materialises
        a synthetic user message ahead of the real one, flagged{" "}
        <code>is_skill_injection: true</code> so your transcript can render it
        differently. Mark one <code>exposeToAgent: true</code> and the agent can
        pull it in itself when it decides it needs that context.
      </p>

      <p>
        <strong>Subagents</strong> are a whole second Glove the main one can hand
        a task to. This is the one people reach for too late. A subagent gets its
        own store, its own tool list, and — importantly —{" "}
        <em>none of the parent&apos;s context</em>: the only thing that crosses
        is the prompt string. That isolation is the point. A research subagent
        can burn 60k tokens reading twelve pages and hand back a paragraph, and
        the parent conversation never carries the twelve pages.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`agent.defineSubAgent({
  name: "claims",
  description: "Handles damaged-parcel claims end to end. Use for anything about damage.",
  factory: async ({ parentStore, parentControls }) => {
    const store = await parentStore.createSubAgentStore?.("claims", false);
    return new Glove({
      store,
      model: parentControls.glove.model,               // inherit the parent's model
      displayManager: parentControls.displayManager,   // and its screen
      systemPrompt: "You process damage claims. Answer the prompt and return.",
      compaction_config: { compaction_instructions: "Summarise claim progress." },
    })
      .fold(lookupPolicyTool)
      .fold(fileClaimTool)
      .build();
  },
});`}
      />

      <p>
        Note what the user types: <code>@claims my box arrived crushed</code>.
        Glove does not parse that. The <code>@</code> reaches the model verbatim
        and acts as a routing hint; the model decides whether to call the
        dispatch tool. Invocation is therefore not guaranteed — but two mentions
        in one sentence work with no extra machinery, which is the trade the
        convention is making.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="borrowed-tools">I. Tools you did not write</h2>

      <p>
        At some point the capability you need already exists behind someone
        else&apos;s API — Notion, Linear, Gmail, your own internal service.{" "}
        <a href="/docs/mcp"><code>glove-mcp</code></a> bridges Model Context
        Protocol servers so their tools appear as ordinary Glove tools,{" "}
        <code>notion__search</code> and friends.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`await mountMcp(glove, {
  adapter,     // per-conversation: which servers are active, and how to get a token
  entries,     // the static catalogue your app supports
});`}
      />

      <p>
        The split is deliberate. The <strong>catalogue</strong> is application
        code — identical for every user. The <strong>adapter</strong> is
        per-conversation state: which servers this user has connected, and how to
        resolve a token for them. Credential storage and refresh stay yours,
        because they were always going to be.
      </p>

      <p>
        One contract to know: an expired token surfaces as a normal tool result,{" "}
        <code>{`{ status: "error", message: "auth_expired" }`}</code>. Not a
        thrown exception, not a silent retry. Your app watches for it, refreshes,
        and the next call picks up the new token. That is a &ldquo;Reconnect
        Notion&rdquo; toast in about ten lines.
      </p>

      <p>
        <code>mountMcp</code> also registers a discovery subagent, so the agent
        can go find and activate a server mid-conversation instead of you wiring
        the whole catalogue at boot — which is exactly what the &ldquo;fold after
        build&rdquo; note in section B was for.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="too-many-tools">J. The wall: too many tools</h2>

      <p>
        Now the real problem. Tool definitions are re-sent on <em>every single
        model call</em>. Forty tools with decent descriptions and schemas is tens
        of thousands of tokens per turn, before the conversation has said
        anything. And the failure is not only cost — a model choosing among forty
        similar names chooses worse than one choosing among six.
      </p>

      <p>
        Glove has three answers, and they are genuinely different shapes rather
        than three flavours of the same idea.
      </p>

      <h3>Capabilities as a database</h3>

      <p>
        <a href="/docs/scratchpad"><code>glove-scratchpad</code></a> exposes your
        capabilities as a relational database behind{" "}
        <strong>one <code>execute_sql</code> tool</strong>. Resources become
        tables; their CRUD verbs map to the underlying tools; a <code>WHERE</code>{" "}
        equality is pushed down as an argument.
      </p>

      <CodeBlock
        filename="what the model writes"
        language="sql"
        code={`-- discovery is information_schema; there is no separate mechanism
SELECT table_name FROM information_schema.tables;

-- and composition is a JOIN across two different services
INSERT INTO linear_issue (title, body)
SELECT title, 'Follow-up for ' || url FROM github_pr WHERE merged = true;`}
      />

      <p>
        The reason this works is not cleverness, it is that the model already
        knows SQL fluently at every size. And you inherit the things databases
        solved decades ago for free: discovery is{" "}
        <code>information_schema</code>, dry-run is <code>EXPLAIN</code>{" "}
        (which calls no resolvers at all), and staged approval is{" "}
        <code>BEGIN … COMMIT</code> — inside a transaction, writes are recorded
        with their exact arguments and fired only on commit. Every statement is
        parsed and security-gated before any tool runs, because a syntax tree is
        something you can actually reject.
      </p>

      <p>
        Prefer a different language? The same catalogue is exposed as a Lisp, a
        JavaScript, or a Python REPL (<code>glove-lisp</code>,{" "}
        <code>glove-js</code>, <code>glove-python</code>) behind one{" "}
        <code>execute_*</code> tool. Branch and loop in a single call; keep
        intermediates in variables instead of in the context window.
      </p>

      <h3>A place where state accumulates</h3>

      <p>
        A REPL is stateless per call. When the work is a <em>project</em> —
        forty PDFs to merge, a spreadsheet to reconcile, a deck to build —{" "}
        <a href="/docs/working-environment"><code>glove-working-environment</code></a>{" "}
        gives the agent a sandboxed filesystem and a script runtime instead.
      </p>

      <CodeBlock
        filename="server.ts"
        language="typescript"
        code={`const env = await createWorkingEnvironment({
  stdlib: [documents(), spreadsheets(), render()],
  limits: { runTimeoutMs: 60_000 },
});

mountWorkingEnvironment(agent, { env });`}
      />

      <p>
        The agent writes named, persistent scripts to <code>/scripts</code> and
        runs them in worker threads. Scripts can import <em>only</em> what the
        host injected — no network, no host filesystem, no process — so the
        sandbox is structural rather than policed. State survives between calls:
        write a script, run it, look at the intermediate, fix it, run it again.
      </p>

      <p>
        And one verb changes what the whole thing can be trusted with.{" "}
        <code>view_image</code> lets the agent rasterize what it produced and{" "}
        <em>look at it</em>. A table running off the page, a chart with no bars, a
        title overlapping a figure — none of those are visible in the markup the
        agent generated. It is the difference between &ldquo;the file was
        written&rdquo; and &ldquo;the deliverable is correct&rdquo;.
      </p>

      <div className="blog-note">
        <strong>Measured, not guessed.</strong> Across 90 runs on three open
        models, the single biggest failure was <em>guessed import names</em>. So
        the environment ships worked recipes in <code>/skills</code> with the
        exact import line for every module, and corrects a wrong import at{" "}
        <em>write</em> time rather than spending a run on it. Point your system
        prompt at <code>/skills/README.md</code> first.
      </div>

      <h3>Or just split the agent</h3>

      <p>
        The third answer is the one from section H, and it is often the right
        one: give each subagent the slice of the surface its job needs. This is
        the explicit recommendation for{" "}
        <a href="/docs/memory">memory</a> — do not attach the entity, episodic
        and resource tools to your main agent. Build a{" "}
        <code>lookup</code> subagent, a <code>recall</code> subagent, a{" "}
        <code>find-notes</code> subagent. The prompt surface scales with the
        role rather than with the ontology, and a reader-attached subagent
        cannot write because the affordance is not there — which is a better
        guarantee than any instruction in a prompt.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="memory">K. Remembering across conversations</h2>

      <p>
        Compaction keeps one conversation inside the window. It does nothing for
        the second conversation. <a href="/docs/memory"><code>glove-memory</code></a>{" "}
        is five sibling subsystems, deliberately not one blob:
      </p>

      <table>
        <thead>
          <tr>
            <th>Subsystem</th>
            <th>Shape</th>
            <th>For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Entity</td>
            <td>Typed graph with deterministic identity</td>
            <td>People, orgs, projects and how they relate</td>
          </tr>
          <tr>
            <td>Episodic</td>
            <td>Append-only timeline</td>
            <td>Meetings, decisions, observations — time is a first-class field</td>
          </tr>
          <tr>
            <td>Resources</td>
            <td>POSIX-ish virtual filesystem</td>
            <td>Notes and transcripts the agent navigates with <code>ls</code> / <code>grep</code></td>
          </tr>
          <tr>
            <td>Context</td>
            <td>Injected into the system prompt every turn</td>
            <td>Standing user preferences — &ldquo;always ship to the office&rdquo;</td>
          </tr>
          <tr>
            <td>Forms</td>
            <td>Structured collection over a conversation</td>
            <td>Sixty fields gathered by talking, not by a wizard</td>
          </tr>
        </tbody>
      </table>

      <p>
        Two design choices are worth stealing even if you never use the package.
        Every write carries <strong>provenance</strong> — source, actor,
        timestamp, optional rationale — appended, never replaced, so &ldquo;why
        does the agent believe this&rdquo; is always answerable. And{" "}
        <strong>nothing is ever lost</strong> in forms: an answer is an
        append-only log with a cursor, so correcting, retracting, undoing and
        redoing are all cursor moves over a history that cannot drop a value.
      </p>

      <p>
        Exposure is controlled on two independent axes, and you want both.
        Allowlists (<code>{`{ tools: { deny: ["remove", "move"] } }`}</code>)
        remove the <em>affordance</em> — the tool never reaches the model. Path
        policies (<code>withResourceAccess</code>) remove the{" "}
        <em>capability</em> — the adapter refuses the call however it arrives.
        And <code>layerResources</code> and its siblings merge a shared,
        read-only stratum with a private writable one into a single view: a team
        handbook underneath, the user&apos;s own notes on top, one coherent read,
        with writes routed to whoever owns the target.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="voice">L. Talking to it</h2>

      <p>
        Two paths, and the choice is about latency versus control.
      </p>

      <p>
        The <strong>cascade</strong> (<a href="/docs/voice"><code>glove-voice</code></a>)
        is <em>speech → text → agent → text → speech</em>. Every stage is an
        adapter you pick, the agent in the middle is unchanged, and latency is
        the sum of the parts. Mic audio is speech-gated by default, so a door
        slam is never transcribed and never interrupts the agent mid-sentence.
      </p>

      <p>
        <strong>Speech-to-speech</strong> (<a href="/docs/realtime-voice"><code>glove-voice-s2s</code></a>)
        collapses the stack: the model listens and speaks directly. Your tools,
        display stack and context management still apply — only the transport
        underneath is different. Barge-in does <em>truncation sync</em>, so when
        a caller cuts the agent off the model is told what the caller actually
        heard, not what it had planned to say. Without that it carries on as
        though it delivered a sentence nobody received.
      </p>

      <p>
        Above that sit avatars (a face over the audio) and LiveKit (WebRTC in
        both directions, with barge-in as a server-authoritative buffer flush).
        Three packages rather than one, because a phone agent needs S2S and no
        avatar, and a kiosk needs an avatar and no LiveKit.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="many-agents">M. More than one agent</h2>

      <p>
        Subagents are nested and synchronous — the parent waits. Peers are a
        different shape, and they are built on the inbox from section E.
      </p>

      <p>
        <a href="/docs/mesh"><code>glove-mesh</code></a> gives agents direct
        messages, broadcasts and acknowledgements. When A sends to B, the
        framework drops a resolved inbox item into B&apos;s store, and B&apos;s
        existing inbox-injection path surfaces it on its next turn. No new
        agent-loop semantics — the mechanism was already there. A blocking send
        inserts a pending item that resolves on an ack or a reply, and a reply
        implies an ack, saving the recipient a round trip.
      </p>

      <p>
        <a href="/docs/continuum"><code>glove-continuum-signal</code></a>{" "}
        supervises agents as subprocesses, in two modes.{" "}
        <strong>Triggered</strong> agents are cold: something wakes them, they
        resume a persistent store, run a turn, and go back to sleep — a
        background job whose body is a full agent. <strong>Concurrent</strong>{" "}
        agents stay warm in long-lived subprocesses and are notified inline, with
        no spawn latency.
      </p>

      <div className="blog-note">
        <strong>The one that bites.</strong> A triggered agent without a
        persistent store gets a fresh memory on every wakeup, which defeats the
        entire point. Configure <code>.store(name =&gt; …)</code>. Discovery
        warns you, but it warns into a log.
      </div>

      {/* ---------------------------------------------------------------- */}
      <h2 id="shipping">Z. Shipping it</h2>

      <p>
        Eventually the agent needs ffmpeg, or LibreOffice, or headless Chromium,
        and you do not want those on every machine that runs your app.{" "}
        <a href="/docs/glovebox">Glovebox</a> packages a built agent as a
        sandboxed container with one authenticated WebSocket endpoint.
      </p>

      <CodeBlock
        filename="glovebox.ts"
        language="typescript"
        code={`export default glovebox.wrap(agent, {
  name: "parcel-desk",
  base: "glovebox/docs",                     // pandoc, qpdf, ghostscript, libreoffice
  packages: { apt: ["poppler-utils"] },
  storage: {
    outputs: composite([
      rule.inline({ below: "1MB" }),         // small files ride the wire
      rule.localServer({ ttl: "1h" }),       // big ones get a URL
    ]),
  },
  env: { ANTHROPIC_API_KEY: { required: true, secret: true } },
  limits: { memory: "2GB", timeout: "10m" },
});`}
      />

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`npx glovebox build ./glovebox.ts --out ./dist`}
      />

      <p>
        Out comes a Dockerfile, a nixpacks recipe, a bundled server, a manifest
        and an auth key. Clients send a prompt and files and get back a message
        and output files; they never learn which tools fired. The agent, inside,
        gains a couple of things it did not have to be told about — a{" "}
        <code>workspace</code> skill that lists its mounts, and an{" "}
        <code>/output</code> hook for delivering files it wrote somewhere else.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="through-line">The through-line</h2>

      <p>
        Read back over the list and the same shape keeps appearing. Model, store,
        display, subscriber, MCP, mesh, image model, memory, storage, transport —
        all adapters. Glove ships an in-memory reference implementation of nearly
        every one of them, and a production version of almost none.
      </p>

      <p>
        That is on purpose, and it is the one opinion the framework really holds.
        The parts a framework should own are the ones that are the same
        everywhere: the loop, the tool contract, how a result is split between
        model and screen, what happens when the window fills. The parts it should
        not own are the ones where you already made a decision — your database,
        your auth, your queue, your vector index. A framework that ships those
        is asking you to run a second copy of infrastructure you already have.
      </p>

      <p>
        Which means the honest way to start is small. One tool, one description
        written like you meant it, and the twenty-line script from section B. Add
        a piece from this page when something breaks — not before, because you
        will not know which one you needed until it does.
      </p>

      <p>
        Everything here is MIT and on{" "}
        <a href="https://github.com/porkytheblack/glove">GitHub</a>. The{" "}
        <a href="/docs/getting-started">quickstart</a> is the fifteen-minute
        version of section B, and{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples">
          examples/
        </a>{" "}
        has a runnable project for nearly every section above.
      </p>
    </div>
  );
}
