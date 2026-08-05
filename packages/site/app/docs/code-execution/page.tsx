import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Code Execution",
  description:
    "One eval tool instead of fifty tool definitions — sandboxed JavaScript, Python and Lisp REPLs over a shared function catalog.",
};

export default function CodeExecutionPage() {
  return (
    <div className="docs-content">
      <h1>Code Execution</h1>

      <p>
        Loading fifty tool definitions into a context window is expensive and,
        past a point, counter-productive. The alternative Glove ships is{" "}
        <strong>one eval tool</strong>: expose the agent&apos;s capabilities as
        functions in a tiny sandboxed interpreter, and let the model discover,
        call and compose them by writing programs.
      </p>

      <p>
        Three surfaces, one catalog. <code>glove-js</code>,{" "}
        <code>glove-python</code> and <code>glove-lisp</code> all consume the
        same <code>ToolFn</code> catalog from <code>glove-scratchpad</code>, so
        a set of functions mounts on any of them unchanged. Pick the language
        your models are most fluent in.
      </p>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Tool</th>
            <th>Bet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>glove-js</code>
            </td>
            <td>
              <code>execute_js</code>
            </td>
            <td>JavaScript — the most-represented language in training data</td>
          </tr>
          <tr>
            <td>
              <code>glove-python</code>
            </td>
            <td>
              <code>execute_python</code>
            </td>
            <td>Python — what models reach for when the task is data manipulation</td>
          </tr>
          <tr>
            <td>
              <code>glove-lisp</code>
            </td>
            <td>
              <code>execute_lisp</code>
            </td>
            <td>
              A Clojure-flavored Lisp — plus the scratchpad&apos;s staged-effect
              contract
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="why">Why a REPL beats more tools</h2>

      <p>
        The <a href="/docs/scratchpad">scratchpad</a> work showed that folding
        capabilities behind ONE code-eval tool beats loading dozens of tool
        definitions — on correctness, on context, and on cost — because the
        model computes over results <em>in the sandbox</em> rather than
        round-tripping every intermediate through its context window. What each
        surface keeps from that work:
      </p>

      <ul>
        <li>
          <strong>One tool, progressive in-band discovery.</strong> Nothing is
          primed by default. The model jumps straight to matches with{" "}
          <code>search(&quot;open pull requests&quot;)</code>, or browses{" "}
          <code>servers()</code> → <code>fns(&quot;github&quot;)</code> →{" "}
          <code>describe(&quot;name&quot;)</code>. The same tiers also exist as
          native tools (<code>search_functions</code>, <code>list_servers</code>
          , <code>list_functions</code>, <code>describe_function</code>) so a
          weak model can fire them as tool calls and a capable one can script
          the whole sweep in one program.
        </li>
        <li>
          <strong>Off-context data flow.</strong>{" "}
          <code>const prs = github.list_pull_requests()</code> stores the rows
          in the REPL and echoes only a summary; the model then works with{" "}
          <code>prs.length</code> and <code>prs.slice(0, 5)</code>.
        </li>
        <li>
          <strong>Branch in one program.</strong> Decide-and-act is ONE call,
          not a read, a look, and a second call.
        </li>
        <li>
          <strong>Exactly-once effects by construction.</strong> A tool call
          fires when its expression evaluates — there is no planner that might
          re-run it.
        </li>
        <li>
          <strong>Persistent session.</strong> Top-level bindings survive across
          calls, so the model builds up state without re-fetching.
        </li>
        <li>
          <strong>Bounded output.</strong> What crosses back into context is
          structurally elided (arrays past 25 items, strings past 300 chars)
          with a marker naming the true size.
        </li>
      </ul>

      <h2 id="quick-start">Quick start</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-js glove-scratchpad     # or glove-python / glove-lisp`}
      />

      <CodeBlock
        filename="repl.ts"
        language="typescript"
        code={`import { JsSession, mountJs } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = JsSession.create();

// A whole MCP server becomes functions: github__list_pull_requests, …
session.registerAll(await fnsFromMcp(githubConn));

mountJs(agent, { session });   // folds execute_js + discovery tools, primes the prompt`}
      />

      <p>Now the model works entirely in JavaScript through one tool:</p>

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
        One call. The rows never enter the model&apos;s context — only the
        answer string does.
      </p>

      <h2 id="catalog">The function catalog</h2>

      <p>
        A capability is a <code>ToolFn</code>: a name, an optional input schema
        (JSON Schema or Zod), and a <code>call</code>. There are no columns, no
        pushdown keys and no volatility classes to declare — which is exactly
        what makes this the right surface when the tools are{" "}
        <strong>unknown up front</strong>, like an arbitrary MCP server
        discovered at runtime.
      </p>

      <CodeBlock
        filename="catalog.ts"
        language="typescript"
        code={`import { defineFn, fnFromTool } from "glove-scratchpad";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { z } from "zod";

// A whole MCP server → functions
session.registerAll(await fnsFromMcp(conn));

// An existing Glove tool → a function
session.register(fnFromTool(myTool));

// Or author one inline
session.register(defineFn({
  name: "email__send",
  input: z.object({ to: z.string(), subject: z.string() }),
  readOnlyHint: false,
  handler: (args) => sendEmail(args),
}));`}
      />

      <p>
        A <code>__</code> in a name becomes a namespace:{" "}
        <code>github__list_pull_requests</code> binds both the flat name and{" "}
        <code>github.list_pull_requests</code>.{" "}
        <strong>Calling an effectful function FIRES it immediately</strong> —
        there is no staging or undo on the JS/Python surfaces; the write verb is
        the function. (The Lisp surface adds staging — see below.)
      </p>

      <h2 id="languages">The languages</h2>

      <h3 id="javascript">JavaScript</h3>

      <p>
        A deliberately small subset — the JavaScript a model reaches for when it
        thinks &ldquo;transform this data&rdquo;, and nothing else:{" "}
        <code>const</code>/<code>let</code>, arrow functions, template literals,
        destructuring, spread, optional chaining, the usual control flow, the
        array and string methods, <code>Object.*</code>, <code>Math</code>,{" "}
        <code>JSON</code>, <code>Set</code>/<code>Map</code>/<code>Date</code>/
        <code>RegExp</code>, and captured <code>console.log</code>. Tool calls
        are async functions whose promises resolve automatically, so{" "}
        <code>await</code> is optional.
      </p>

      <p>
        Rejected with a targeted message rather than gibberish:{" "}
        <code>class</code>, <code>import</code>/<code>require</code>,{" "}
        <code>eval</code>, <code>Function</code>, <code>this</code>,
        prototypes, <code>fetch</code>, <code>for…in</code>, <code>var</code>,{" "}
        <code>in</code>/<code>instanceof</code>, generators.
      </p>

      <h3 id="python">Python</h3>

      <CodeBlock
        filename="what the model writes"
        language="python"
        code={`prs = github.list_pull_requests(state="open")
stale = [p for p in prs if p["age_days"] > 30]
"all fresh" if len(stale) == 0 else f"{len(stale)} stale"`}
      />

      <h3 id="lisp">Lisp</h3>

      <p>
        The Lisp surface is built on the scratchpad&apos;s{" "}
        <code>ResourceTable</code> contract as well as the function catalog — so
        it can stage several outbound effects, preview them, and commit or
        discard as a real dry run:
      </p>

      <CodeBlock
        filename="what the model writes"
        language="clojure"
        code={`;; discover
(tables)
(describe :github_pull_requests)

;; keep big intermediates in the REPL, out of context
(def prs (github_pull_requests))     ; echoes {:defined "prs" :count 320}
(frequencies :state prs)

;; BRANCH in one call — decide-and-act
(if (empty? (pagerduty_incidents {:urgency "high" :status "triggered"}))
  (insert! :slack_messages {:channel "ops" :text "All clear."})
  (insert! :emails {:to_addr "oncall@acme.io" :subject "Incidents live"}))

;; stage several effects, preview, then fire — or discard
(stage (insert! :emails {:to_addr "a@b.io" :subject "one"})
       (insert! :emails {:to_addr "c@d.io" :subject "two"}))
(commit!)   ; or (rollback!)`}
      />

      <h2 id="sandbox">How a program runs</h2>

      <p>
        <code>parse → validate → run</code>. The parser builds the full program;
        a whitelist walk rejects unsupported constructs{" "}
        <em>before anything executes</em>. Then an async tree-walking evaluator
        runs it with a <strong>fuel budget</strong> (per node and per loop
        back-edge, so <code>while (true) {"{}"}</code> cannot hang), a{" "}
        <strong>recursion-depth cap</strong>, and <code>AbortSignal</code>{" "}
        support.
      </p>

      <p>
        Every member read and method call goes through a sandbox boundary that
        blocks the escape keys (<code>constructor</code>, <code>__proto__</code>
        , <code>prototype</code>, <code>call</code>/<code>apply</code>/
        <code>bind</code>) and exposes a fixed allowlist — a program cannot
        climb a constructor chain back to the host.
      </p>

      <h2 id="framing">Framing: repl, program, or workflow</h2>

      <p>
        The eval tool ships three interchangeable framings, chosen at mount
        time. The runtime is identical — only the tool <em>name</em> and the
        primed preamble change:
      </p>

      <CodeBlock
        filename="repl.ts"
        language="typescript"
        code={`mountJs(agent, { session });                     // execute_js          (default)
mountJs(agent, { session, frame: "program" });   // execute_js_program
mountJs(agent, { session, frame: "workflow" });  // execute_js_workflow`}
      />

      <p>
        The bet: the token &ldquo;REPL&rdquo; pattern-matches to an interactive,
        line-by-line <em>session</em>, so models degrade the surface back into
        an incremental tool-call loop — peek at a row, then run a second
        program. The <code>workflow</code> framing never says REPL; it frames
        the call as ONE complete program carrying the task start to finish, and
        demotes cross-call persistence to a retry-only recovery aid.{" "}
        <code>program</code> is the half-step, so a benchmark can separate{" "}
        <em>the name alone</em> from the full reframing.
      </p>

      <h2 id="discovery">Discovery modes</h2>

      <p>
        Result shapes warm lazily — a function&apos;s row type is sampled the
        first time it is described, not for the whole catalog at mount, and
        surfaces as a TS-like type in <code>describe(...)</code>:
      </p>

      <CodeBlock
        filename="describe output"
        language="text"
        code={`sentry__list_issues(…) → { …, count: number,
                            status: "unresolved"|"resolved"|"ignored" }[]`}
      />

      <p>
        <code>discovery: &quot;full&quot;</code> primes every signature up front
        for small catalogs; <code>&quot;auto&quot;</code> picks per size. Result-shape
        discovery is what closed the weak-model gap in the live A/B — the
        JavaScript arm moved 78% → 90% → 97% over two hardening batches, above
        Lisp (95%) and SQL (92%), for a modest peak-context increase.
      </p>

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/scratchpad">Scratchpad</a> — the SQL surface over the
          same idea, with typed resources and staged writes
        </li>
        <li>
          <a href="/docs/egress">Egress Control</a> — make this boundary a
          measured, enforced privacy boundary
        </li>
        <li>
          <a href="/docs/working-environment">Working Environment</a> — when the
          agent needs state that accumulates across calls
        </li>
        <li>
          <a href="/docs/mcp">MCP</a> — where a runtime-discovered catalog
          usually comes from
        </li>
      </ul>
    </div>
  );
}
