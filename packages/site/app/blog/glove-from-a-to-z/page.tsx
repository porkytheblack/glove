import { CodeBlock } from "@/components/code-block";
import { BlogPostHeader } from "@/components/blog-post-header";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("glove-from-a-to-z")!;

export const metadata = postMetadata(post);

export default async function Post() {
  return (
    <div className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Start with a loop that calls a function. Add one thing at a time, only
        when something breaks. By the end you have an agent that runs code,
        remembers, answers the phone with a face on it, and ships in a container —
        and you understand every piece, because you watched each one earn its
        place.
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
        at which point section J is the real answer.
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
      <h2 id="code-execution">J. Stop calling tools. Run code.</h2>

      <p>
        Now the real problem, and the one with the most interesting answer. Tool
        definitions are re-sent on <em>every single model call</em>. And results
        come back <em>to the model</em>: ask &ldquo;how many of these forty PRs
        are stale&rdquo; and the whole list pages through the context window so
        the model can count them by eye.
      </p>

      <p>
        Both costs grow with your integrations, and we{" "}
        <a href="https://github.com/porkytheblack/glove/blob/main/benches/scratchpad-bench/PAPER.md">
          measured
        </a>{" "}
        where that ends. A production-shaped fleet — <strong>40 servers, 367 tools</strong>, of
        which any given task needs at most four — costs a conventional agent{" "}
        <strong>~39k tokens of standing tool schemas</strong> before the
        conversation has said anything. At that scale the conventional arm does
        not just get expensive, it <strong>inverts</strong>: it becomes the{" "}
        <em>least</em> accurate arm in the suite, at 12× the peak context and
        roughly 6× the cost of a single code-execution tool. Folding tools is
        fine at six and actively harmful at three hundred.
      </p>

      <p>
        So: stop giving the model a menu. Give it a{" "}
        <strong>runtime, and one tool to run code in it</strong>. Your
        capabilities become <em>functions</em> — a shared{" "}
        <code>ToolFn</code> catalogue that mounts on any of the surfaces below
        unchanged, and which an MCP connection can populate in one line.
      </p>

      <h3>The JavaScript REPL</h3>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { JsSession, mountJs } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = JsSession.create();
session.registerAll(await fnsFromMcp(githubConn));  // github__list_pull_requests, …

mountJs(agent, { session });   // one tool: execute_js`}
      />

      <p>Now the model works by writing programs:</p>

      <CodeBlock
        filename="what the model writes"
        language="javascript"
        code={`const prs = github.list_pull_requests({ state: "open" });
const stale = prs.filter(p => p.age_days > 30);

stale.length === 0
  ? "all fresh"
  : \`\${stale.length} stale: \${stale.map(p => p.number).join(", ")}\`;`}
      />

      <p>
        One call. Forty rows were fetched, filtered and counted — and the only
        thing that crossed back into the context window is a sentence. That is
        the whole argument, and it has four consequences worth naming.
      </p>

      <p>
        <strong>Data flow goes off-context.</strong>{" "}
        <code>const prs = …</code> parks the rows in the REPL and echoes a
        summary. The model then works with <code>prs.length</code> and{" "}
        <code>prs.slice(0, 5)</code> rather than with the corpus. Values past a
        bound are structurally elided with a marker naming the true size, so a
        careless <code>console.log</code> cannot blow up the turn.
      </p>

      <p>
        <strong>Decide-and-act is one call.</strong>{" "}
        <code>if (incidents.length === 0) slack.post(…) else email.send(…)</code>{" "}
        — a read, a decision and an effect, without the model round-tripping to
        look at the read first. On a benchmark scenario graded on which side
        effect actually fired, this was the only surface where every model
        passed, and three of them did the whole thing in a single tool call.
      </p>

      <p>
        <strong>Effects are exactly-once by construction.</strong> A function
        fires when its expression evaluates. There is no planner that might
        re-run it, which is a much stronger guarantee than a prompt asking
        nicely.
      </p>

      <p>
        <strong>Discovery is progressive and in-band.</strong> Nothing is primed
        by default. The model calls <code>search(&quot;open pull requests&quot;)</code>{" "}
        to jump straight to matching functions, or browses{" "}
        <code>servers()</code> → <code>fns(&quot;github&quot;)</code> →{" "}
        <code>describe(name)</code>. The same tiers also exist as native tools,
        and those names work <em>inside</em> the code as aliases — so a model
        primed on the tool names lands its call whichever way it reaches.
      </p>

      <h3>The Python REPL</h3>

      <p>
        The identical catalogue, a different language. Tool calls take keyword
        arguments; comprehensions, f-strings, slicing and <code>def</code> are
        all in the subset.
      </p>

      <CodeBlock
        filename="the same job, in execute_python"
        language="python"
        code={`prs = github.list_pull_requests(state="open")
stale = [p for p in prs if p["age_days"] > 30]

"all fresh" if not stale else f"{len(stale)} stale: " + ", ".join(str(p["number"]) for p in stale)`}
      />

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const session = PySession.create();
session.registerAll(await fnsFromMcp(githubConn));

mountPy(agent, { session });   // one tool: execute_python`}
      />

      <p>
        Pick the language your models are most fluent in — that is the entire
        selection criterion, and it is measurable. Hardening the JS surface
        against real transcripts moved it from <strong>78% to 97%</strong> on the
        benchmark; Python, built with that tuning already baked in, landed
        parity-class from day one. Fluency is not a property you hope for, it is
        a knob you turn — and the turning is unglamorous: every place a surface
        silently deviated from what the model expected was a place a weak model
        failed, and every fix that made truth cheaper to see bought more
        capability than any prompt instruction.
      </p>

      <div className="blog-note">
        <strong>The sandbox is structural.</strong> A program is parsed,
        whitelist-validated and only then run — by a tree-walking evaluator with
        a fuel budget (so <code>while (true) &#123;&#125;</code> cannot hang), a
        recursion cap, and an abort signal. Every property read and method call
        goes through a boundary that blocks <code>constructor</code>,{" "}
        <code>__proto__</code>, <code>call</code>/<code>apply</code>/
        <code>bind</code>. No <code>import</code>, no <code>eval</code>, no{" "}
        <code>fetch</code>. A program cannot climb back to the host.
      </div>

      <h3>The same capabilities as a database</h3>

      <p>
        <a href="/docs/scratchpad"><code>glove-scratchpad</code></a> is where all
        of this started, and it is still the right surface for a particular
        shape of work. Same idea — one <code>execute_sql</code> tool instead of a
        catalogue — but capabilities are modelled as <strong>tables</strong>
        rather than functions: resources with columns, CRUD verbs wired
        independently, and <code>WHERE</code> equalities pushed down as
        arguments.
      </p>

      <CodeBlock
        filename="what the model writes"
        language="sql"
        code={`-- composition across two services, executed inside the engine
INSERT INTO linear_issue (title, body)
SELECT title, 'Follow-up for ' || url FROM github_pr WHERE merged = true;`}
      />

      <p>
        Reach for it when the work is <em>aggregation and composition</em> —
        grouping, joining, piping one service into another — or when you want the
        things a database solved decades ago: discovery through{" "}
        <code>information_schema</code>, a genuine dry run via{" "}
        <code>EXPLAIN</code> (it calls no resolvers at all), and{" "}
        <strong>staged writes</strong> inside <code>BEGIN … COMMIT</code>, where
        each effect is recorded with its exact arguments and fired only on
        commit. That staging surface is the best approval gate in the framework,
        and it is the one thing the REPLs deliberately do not have — there, the
        write verb <em>is</em> the function, and calling it fires it.
      </p>

      <p>
        The honest trade runs the other way too. SQL cannot express conditional
        branching in one statement, so decide-and-act is two round trips; its
        exactly-once guarantee needed a whole pre-resolution subsystem to build;
        and a table needs modelling up front, which you cannot do for an
        arbitrary MCP server discovered at runtime. Functions need none of that.
        You can also mount both surfaces on one catalogue — measured at no cost,
        and models pick SQL for shaping data and the REPL for branching, without
        being told to.
      </p>

      <h3>A place where state accumulates</h3>

      <p>
        A REPL session keeps variables. It does not keep <em>artifacts</em>. When
        the work is a project rather than a query — forty PDFs to merge, a
        spreadsheet to reconcile, a deck to build and check —{" "}
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
        prompt at <code>/skills/README.md</code> first. Six more bugs from this
        subsystem — every one of which <em>reported success</em> — are in{" "}
        <a href="/blog/silent-failures">Every failure in this one was silent</a>.
      </div>

      <h3>Or just split the agent</h3>

      <p>
        The last answer is the one from section H, and it is often the right
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
        One design choice is worth stealing even if you never use the package:
        every write carries <strong>provenance</strong> — source, actor,
        timestamp, optional rationale — appended, never replaced. &ldquo;Why does
        the agent believe this&rdquo; stays answerable a year later.
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

      <h3 id="forms">Forms: the wizard, deleted</h3>

      <p>
        The fifth subsystem is the one that changes what an app looks like, so it
        gets its own section. A form — an insurance claim, an onboarding flow, a
        support intake — is conventionally a sequence of screens, and the
        sequence <em>is</em> the product: you cannot answer question six while
        being asked question two, and correcting question one means going back
        through three, four and five.
      </p>

      <p>
        Glove forms delete the sequence and keep the structure. The definition is{" "}
        <strong>code</strong> — Zod schemas, gate closures and executors in one
        type-threaded chain — and the agent never reads it. It reads a projection
        of evaluated state.
      </p>

      <CodeBlock
        filename="forms/travel-claim.ts"
        language="typescript"
        code={`export const travelClaim = defineForm({
  id: "travel-claim",
  name: "Travel reimbursement claim",
  conduct: "Conversational — one or two questions at a time. Don't read the field list aloud.",
})
  .step("claimant", { title: "Claimant", preview: "name, staff id, email" }, (s) =>
    s
      .field("fullName", { schema: z.string().min(2), label: "Full name" })
      .field("email", { schema: z.string().email(), label: "Work email" }),
  )
  .step("travel", { title: "Travel", preview: "mode, mileage or ticket" }, (s) =>
    s
      .field("mode", { schema: z.enum(["car", "rail", "air"]), label: "Mode" })
      .field("mileage", {
        schema: z.number().int().min(1).optional(),
        label: "Miles driven",
        when: (v) => v.mode === "car",     // applicability, not ask-order
      }),
  )
  .checkpoint("policy-cap", {
    when: (v) => v.total > 750,
    blocking: true,
    run: () => ({ fail: "Over the limit — needs Finance pre-approval." }),
  })
  .onComplete(async (ctx) => {
    await ctx.memory.upsertNode("Person", { name: ctx.values.fullName });
  })
  .build();`}
      />

      <p>
        Every <code>.field()</code> widens the accumulated values type, so{" "}
        <code>ctx.values.mode</code> narrows to its enum and{" "}
        <code>ctx.values.mileage</code> is <code>number | undefined</code> at
        every downstream callsite. There is no <code>required</code> option and
        no field-type vocabulary: a field is optional <em>iff</em> its schema
        accepts <code>undefined</code>, and the type description the agent
        reads (&ldquo;email address&rdquo;, &ldquo;one of: car | rail |
        air&rdquo;) is rendered from the schema. Both derived, neither declared.
      </p>

      <p>
        Four properties fall out of that, and each one deletes a class of code
        you would otherwise write.
      </p>

      <p>
        <strong>Writes are never gated.</strong> No locks, no
        &ldquo;complete step 2 first&rdquo;. A patch can carry any field ids at
        once, each validated independently so one bad value does not reject the
        rest, and an answer that is not applicable <em>yet</em> is held rather
        than dropped. A user who answers question six while being asked question
        two has answered question six. Field ids are forgiving too —{" "}
        <code>full_name</code>, <code>Full name</code> and <code>fullName</code>{" "}
        all land, and a miss comes back with <code>did_you_mean</code>.
      </p>

      <p>
        <strong>Nothing is ever lost.</strong> Each field is an append-only log
        of revisions plus a cursor naming the one in force. A correction appends.
        A retraction is itself a revision — which makes retract, undo and redo
        pure cursor moves over a history that cannot drop an answer, and every
        one of them reversible. The agent reaches all four through one{" "}
        <code>action</code> parameter rather than four verbs, because tool
        schemas are re-sent every call and an eval put four verbs at ~75% of this
        surface&apos;s entire context cost.
      </p>

      <p>
        <strong>Triggers steer the conversation.</strong> A checkpoint is a
        condition over values and <em>state</em> — <code>stepComplete(id)</code>,{" "}
        <code>checkpointFired(id)</code> — fired on its rising edge, and what it
        returns can move the conversation: <code>{`{ patch }`}</code> to stamp a
        value, <code>{`{ jump }`}</code> to route forward <em>or back to a step
        that already finished</em>, <code>{`{ fail }`}</code> to record a
        rejection and carry on, <code>{`{ terminate }`}</code> to stop collection
        outright when continuing would be wrong rather than merely unfinished. A
        backwards jump is a revisit, not a reset: the answers stay filled but
        come back asking, and the next write into that step releases the
        override.
      </p>

      <p>
        <strong>It costs almost nothing to have.</strong> Tier 0 is a single line
        injected into the system prompt each turn — the open step, its pending
        field labels, and a one-line preview of what is still to come. Tier 1 is
        the open step in full, on request; tier 2 is any other step, one field,
        or the whole outline. Form modules are not even imported until an
        instance starts, so a registered sixty-field form costs a name and a
        description until someone needs it.
      </p>

      <CodeBlock
        filename="tier 0 — the whole standing cost"
        language="text"
        code={`[form: travel-claim] step 2/4 "Trip" · pending: Destination, Departure date
later: Travel (mode, mileage or ticket) · Approval (cost centre, manager)`}
      />

      <p>
        Wiring is one call. <code>useFormRunner</code> folds the tools, wraps{" "}
        <code>processRequest</code> for that tier-0 line, and hands back the
        runner so your own code can start instances and resolve blocking
        checkpoints without going through the model at all.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const { runner } = useFormRunner(glove, adapter, {
  registry,                    // lazy: { load: () => import("./forms/travel-claim") }
  subject: conversationId,
  memory: { entity, episodic, resources, context },   // executors can write to all four
});`}
      />

      <p>
        That <code>memory</code> bridge is the point of putting forms in this
        package rather than in a package of their own. A completed claim is not a
        JSON blob to hand off — it is a person in the entity graph, an episode on
        the timeline, and a document in the resource tree, all written with
        engine-supplied provenance by an <code>onComplete</code> that runs on the
        commit that finished the form. The decisions behind all of that, and the
        five defects an agentic eval found that reading the code had not, are in{" "}
        <a href="/blog/shipping-forms">Shipping Forms</a>.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="realtime">L. Realtime: a voice, and a face to put it on</h2>

      <p>
        Everything so far assumed typing. Realtime is where the same agent
        answers a phone call or looks back at you from a screen, and it is a
        stack you climb one layer at a time — each layer useful without the ones
        above it.
      </p>

      <h3>The cascade</h3>

      <p>
        <a href="/docs/voice"><code>glove-voice</code></a> is{" "}
        <em>speech → text → agent → text → speech</em>. Every stage is an adapter
        you choose, the agent in the middle is untouched, and text streams into
        TTS sentence by sentence as the model produces it rather than waiting for
        the turn to finish.
      </p>

      <p>
        The part worth knowing is what happens to <strong>noise</strong>. By
        default mic audio is speech-gated: it sits in a rolling pre-roll buffer
        and is released to the speech-to-text provider only once the voice
        detector confirms real speech survived a minimum duration. A door slam is
        never transcribed, never hallucinated into words, and never interrupts
        the agent mid-sentence — its audio is discarded outright. That is the
        difference between a demo and something usable in a kitchen.
      </p>

      <h3>Speech-to-speech</h3>

      <p>
        The cascade&apos;s latency is the sum of its parts.{" "}
        <a href="/docs/realtime-voice"><code>glove-voice-s2s</code></a> collapses
        the stack: the model listens and speaks directly, and turn-taking is
        decided by something that can actually hear the caller. Your tools,
        display stack and context management all still apply — only the transport
        underneath changed.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`const agent = new Glove({
  store,
  // The model slot CARRIES the realtime config, so the agent definition stays
  // the single source of truth and RealtimeAgent derives the session from it.
  model: s2sDrivenModel({
    provider: "openai",                  // or "gemini"
    turnDetection: { type: "server_vad", silence_duration_ms: 450 },
  }),
  displayManager: new Displaymanager(),
  systemPrompt: "...",
  serverMode: true,
}).fold(bookTableTool);                  // tools work exactly as before

const rt = new RealtimeAgent({ agent });
await rt.start();

rt.sendAudio(pcm);                       // caller's mic in
rt.adapter.on("audio", (pcm) => { /* agent speech out */ });
rt.adapter.on("interrupted", () => { /* flush your playback */ });`}
      />

      <p>
        Two details took the longest and matter the most. Turn-taking knobs are{" "}
        <strong>typed</strong> rather than raw JSON, because a silence threshold
        is the difference between an agent that talks over people and one that
        feels patient — that is a number you will tune, so it should
        autocomplete. And barge-in does <strong>truncation sync</strong>: when a
        caller cuts the agent off, the model is told what the caller actually{" "}
        <em>heard</em>, not what it had planned to say. Without it the agent
        carries on as though it delivered a sentence nobody received, and every
        later turn is built on that false belief.
      </p>

      <div className="blog-note">
        <strong>The layering that works in practice.</strong> Keep the S2S model
        as a <em>thin front agent</em> — it is the ears and the mouth, and it
        should stay responsive. Heavy lookups get delegated to a capable worker
        agent over the mesh (section N). A realtime model held up mid-sentence by
        a three-second database query sounds exactly as bad as it is.
      </div>

      <h3>A face</h3>

      <p>
        An avatar provider is, structurally, a lip-sync renderer over an audio
        stream: PCM in, a talking face out on a WebRTC surface. Which is exactly
        the shape of the audio the S2S layer already emits — so{" "}
        <code>glove-voice-avatar</code> is a <em>rendering layer</em> over the
        stack rather than a replacement for any of it. The mic path, the tools
        and the delegation are untouched.
      </p>

      <CodeBlock
        filename="the whole integration"
        language="typescript"
        code={`const rt = new RealtimeAgent({ agent });
await rt.start();

const avatar = new TavusEchoAdapter({ apiKey: process.env.TAVUS_API_KEY! });
const detach = await attachAvatar(rt, avatar);
// audio → sendAudio · speech-stop → endUtterance · interrupted → interrupt`}
      />

      <p>
        <code>AvatarAdapter</code> is the contract — <code>connect()</code>{" "}
        returns a <em>view</em> clients attach to (a WebRTC room URL, or an SDK
        session token, as a tagged union), plus <code>sendAudio</code>,{" "}
        <code>endUtterance</code> and an <code>interrupt</code> that is{" "}
        <em>always</em> safe to call. That last guarantee is not documentation, it
        is enforced: every adapter has to pass a behavioural conformance suite
        against a fake transport before it ships. Two do today — Tavus in echo
        mode and Anam in audio-passthrough mode, both configured so the
        provider&apos;s own language model and voice stay out of the loop. Your
        agent is the brain; the provider is the face.
      </p>

      <h3>WebRTC both ways</h3>

      <p>
        <code>glove-voice-livekit</code> replaces the hand-rolled audio duct with
        a real transport. The browser side shrinks to <code>Room.connect</code>{" "}
        plus a microphone toggle; barge-in becomes a server-authoritative buffer
        flush instead of a client-side race. And the avatars compose with it: the
        provider&apos;s worker joins <em>your</em> LiveKit room as a participant
        and publishes the voice on the agent&apos;s behalf — at which point you
        set <code>publishAgentAudio: false</code>, because otherwise the caller
        hears the agent twice.
      </p>

      <p>
        Three packages rather than one, for the reason the layers are separable
        at all: a phone agent needs speech-to-speech and no avatar, a kiosk needs
        an avatar and no LiveKit, and nobody should carry three vendors&apos;
        dependencies to use one of them. What the wire taught us while building
        all of that — including the bugs every test suite passed through — is its
        own post: <a href="/blog/building-the-voice-stack">what only live calls
        told us</a>.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="images">M. Image workflows</h2>

      <p>
        The same trajectory happens with images, and it is worth watching because
        it is the clearest example in the framework of a one-line tool turning
        into a subsystem.
      </p>

      <p>
        You start with <code>generate_image(prompt)</code>. It shells out to a
        provider and returns a URL, and it works — exactly once. The moment
        images are a repeated job, four things break at the same time:
      </p>

      <ul>
        <li>
          <strong>Prompts are built, not typed.</strong> The useful prompt is the
          user&apos;s intent <em>plus</em> house style <em>plus</em> the
          character&apos;s canonical description <em>plus</em> the scene&apos;s
          palette <em>plus</em> a model-specific rewrite. That is a pipeline, and
          every app rebuilds it inline and loses the intermediate states.
        </li>
        <li>
          <strong>Recurring subjects drift.</strong> &ldquo;Draw Mira again, but
          at the harbour&rdquo; only works if Mira is a durable thing, not a
          phrase the model half-remembers from six turns ago.
        </li>
        <li>
          <strong>Existing images are inputs.</strong> Users bring photos;
          earlier generations become references. Image bytes need a home that is
          not the context window.
        </li>
        <li>
          <strong>Nobody knows what it cost.</strong> Until the invoice arrives.
        </li>
      </ul>

      <p>
        <a href="/docs/image"><code>glove-image</code></a> makes each of those a
        named primitive.
      </p>

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`await mountImage(glove, {
  adapter: openrouterImages(),              // BYO image model
  assets: new InMemoryImageAssetStore(),    // where bytes live
  library: new InMemoryImageLibrary(),      // characters + scenes

  // The prompt pipeline: ordered "inbetweens" that build every request.
  pipeline: [
    expandCharacters(),                     // splices canonical wording verbatim
    expandScenes(),
    styleDirective("gouache, muted palette"),
    llmEnhance(),                           // one rewrite pass, characters preserved
  ],

  usage: meter,
  onUsage: (source, usage) => billing.record(source, usage),
});`}
      />

      <p>
        A generation never sends raw model text to the image model. An intent
        becomes a draft, the draft runs through the inbetweens in order, and each
        stage appends a <strong>trace entry</strong> recording what it changed.
        The <em>intent is never mutated</em> — you can always see what was asked
        for next to what was actually sent.
      </p>

      <p>
        <strong>Characters and scenes are durable identities</strong> whose
        wording is spliced into every prompt <em>verbatim</em>. That is the whole
        trick, and it is deliberately unglamorous: consistency comes from
        repetition, not from the model remembering. Promoting a good generation
        to a character reference image is the &ldquo;lock in this look&rdquo;
        move.
      </p>

      <p>
        The last stage of the pipeline is always <code>fitToModel()</code>,
        appended whether you ask for it or not, and it is the one I would steal
        for any provider-backed feature. It reconciles the request against what
        the adapter can actually do — folds a negative prompt into the text when
        the model has no negative slot, drops unsupported reference roles, clamps
        the reference count identity-first, snaps the size, drops an unsupported
        seed — and <strong>writes every degradation into the trace</strong>. The
        request is never silently changed. You get told what you did not get.
      </p>

      <p>
        Two more primitives fall out of having a pipeline at all.{" "}
        <strong>Lineage</strong>: every derived image records the recipe that
        made it, so &ldquo;same, but at dusk&rdquo; is one call that replays the
        recipe through the <em>current</em> library — edit a character, regenerate,
        and the edit is picked up. <strong>Cost</strong>: every model-touching
        call is metered at four scopes — per call, per image, per session, and
        per host — in real dollars where the provider reports them, including the
        enhancer&apos;s own tokens and any vision review.
      </p>

      <div className="blog-note">
        <strong>Bytes never enter <code>data</code>.</strong> Model-facing results
        carry asset ids, dimensions and degradations; thumbnails ride on{" "}
        <code>renderData</code> for your renderers. Context cost is flat no matter
        how many images a session touches — which is section C&apos;s split doing
        real work.
      </div>

      <p>
        And the honest part, which belongs in the docs as much as the capability
        does: these are generative approximations. Woven, textile and craft goods
        hold up well. A product carrying an exact logo, a precise colourway or
        fine hardware detail will not reproduce faithfully — not even with its
        own packshot pinned as a reference image.
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 id="many-agents">N. More than one agent</h2>

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
