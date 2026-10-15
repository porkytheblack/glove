import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "FAQ & troubleshooting",
  description:
    "Fixes for the problems people hit in their first week with Foundry: missing tools, lost history, bind and port errors, schedules, 413s and more.",
};

export default function FoundryFaqPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Reference / FAQ</span>
      <h1>FAQ &amp; troubleshooting</h1>
      <p className="blog-lede">
        Concrete answers to the questions people ask in their first week, each with the exact
        error text where there is one, the fix, and where to read more.
      </p>

      <h2 id="tools">Tools and capabilities</h2>

      <h3 id="tool-not-callable">I added a tool to composition.ts but the agent can’t call it</h3>
      <p>
        <code>components: composeAgent(...)</code> is a catalogue of what an instance{" "}
        <em>may</em> use. Shared tools (<code>*.tool.ts</code>), applications and MCP servers are
        mounted only on instances that install them; until then the model sees no such tool, and
        a call fails with <code>No tool called lookup_order exists</code>. Pick one:
      </p>
      <ul>
        <li>
          The tool should exist on every instance: put a plain Glove tool (
          <code>name</code>, <code>description</code>, <code>inputSchema</code>, <code>do</code>) in
          the definition’s <code>tools</code> field instead.
        </li>
        <li>
          It should be per instance: install it with <code>install(def, config)</code> in{" "}
          <code>defineAgentInstance</code>, <code>installations</code> on{" "}
          <code>client.agent(route).create</code>, <code>client.install(agentId, {"{"} kind, id,
          config {"}"})</code>, or <code>PUT /api/installations</code>.
        </li>
      </ul>
      <CodeBlock filename="terminal" language="bash" code={`curl -X PUT http://127.0.0.1:4141/api/installations \\
  -H 'content-type: application/json' \\
  -d '{"agentId":"support-eu","kind":"tool","id":"lookup-order","config":{"region":"eu"}}'`} />
      <p>
        The next run of that instance has the tool; no restart needed. The inspector shows an
        instance’s installations but cannot add them. Memory profiles, layers and subscribers are
        different: they need the catalogue <em>and</em> the <code>memory</code>/
        <code>layers</code>/<code>subscribers</code> field, never an installation. Full table in{" "}
        <Link href="/foundry/docs/project-structure#catalogue-vs-installation">Project
        structure</Link>.
      </p>

      <h3 id="unknown-capability">Installing fails with “Unknown Foundry tool capability”</h3>
      <p>
        The id is not in the catalogue of that instance’s definition. Check that the definition’s{" "}
        <code>composeAgent(...)</code> includes it and that you used the file-derived id:{" "}
        <code>tools/calendar/today.tool.ts</code> is <code>calendar/today</code>, not the tool’s
        model-facing <code>name</code>. Config is checked later: a value that fails the tool’s zod
        schema fails each run with <code>Invalid config for tool &quot;…&quot;</code> and the zod
        issues.
      </p>

      <h3 id="identity-not-bound">“Foundry tool identity has not been bound yet”</h3>
      <p>
        A definition gets its id only when Foundry discovers it: a default export from a
        convention file (<code>*.tool.ts</code>, <code>*.app.ts</code>, …) inside an agent’s
        folder. Defining it in <code>composition.ts</code>, exporting it by name, keeping it in a
        folder that contains no <code>agent.ts</code>, or calling <code>install()</code> from a
        separate client app all leave it unbound. Move it into{" "}
        <code>agents/&lt;agent&gt;/tools/&lt;name&gt;.tool.ts</code>, and from client apps send
        the plain <code>{"{"} kind, id, config {"}"}</code> object.
      </p>

      <h3 id="outbound-binding">My app’s send tool fails with “agent has no enabled bindings”</h3>
      <p>
        Outbound delivery (an installed application’s <code>glove_app_…_send</code> tool,{" "}
        <code>glove_foundry_transmit</code>, or <code>POST /api/transmissions/:route/deliver</code>)
        is authorized per run from the instance’s enabled bindings. Add a{" "}
        <code>defineBinding({"{"} id, agent, application, transmission, account, route, capabilities,
        enabled: true {"}"})</code> for that instance and outbound route to{" "}
        <code>bindings</code> in <code>foundry.application.ts</code> (or{" "}
        <code>client.putBinding</code>). Without a binding for the route, delivery fails with{" "}
        <code>Run &quot;…&quot; is not authorized for outbound route &quot;…&quot;</code>. See{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>

      <h2 id="state">State and persistence</h2>

      <h3 id="forgets-history">My agent forgets earlier messages, and WebChat shows no history</h3>
      <p>
        Every run executes in its own worker process. A <code>store</code> that returns{" "}
        <code>new MemoryStore(...)</code> — what the starters do — is empty at the start of each
        run, so each turn sees only the current message and the transcript endpoint returns
        nothing (with <code>persisted: true</code>). Caching stores in a module-level{" "}
        <code>Map</code> does not help either. Return a store backed by something outside the
        process: the small <code>FileStore</code> from the{" "}
        <Link href="/foundry/docs/tutorial#step-2-agent">tutorial</Link> for one host, or a
        database-backed <code>StoreAdapter</code>. A definition’s <code>store</code> takes
        precedence over the application’s <code>conversationStore</code>.
      </p>

      <h3 id="data-disappears">My instances and conversations disappear on restart</h3>
      <p>
        Your application uses <code>MemoryFoundryDataAdapter</code> (or no <code>data</code> at
        all), which lives in the runtime process. <code>glove foundry dev</code> restarts that
        process whenever you save a file in <code>agents/</code>, <code>.env*</code> or a root
        config file, so instances, conversations, installations and schedules vanish. Projects
        created by <code>glove-foundry init</code> avoid this with file-backed adapters under{" "}
        <code>.data/</code>. Persist four things, separately:
      </p>
      <table>
        <thead><tr><th>What</th><th>Configured by</th><th>Single-host option</th></tr></thead>
        <tbody>
          <tr><td>Runtime data: instances, conversations, installations, activations, workspace entries, inbox, tasks</td><td><code>data</code> in <code>defineApplication</code></td><td><code>new FileFoundryDataAdapter({"{"} file: &quot;.data/foundry.json&quot; {"}"})</code></td></tr>
          <tr><td>Transcripts (Glove messages)</td><td><code>store</code> on the definition, or <code>conversationStore</code></td><td>A file- or database-backed <code>StoreAdapter</code></td></tr>
          <tr><td>Structured memory</td><td>Your memory profile adapters</td><td><code>createSqliteMemoryAdapters</code> from <code>glove-memory/sqlite</code> (Node 22.13+)</td></tr>
          <tr><td>Working-environment files (VFS)</td><td><code>persistence</code> on <code>defineWorkingEnvironment</code></td><td><code>foundryDataEnvironmentPersistence(...)</code> over a durable data adapter</td></tr>
        </tbody>
      </table>
      <p>
        A durable data adapter does not make an in-memory transcript store durable, and vice
        versa. Several hosts need a shared, transactional adapter. See{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h3 id="unknown-definition">Foundry won’t start: “Agent instance … references unknown definition …”</h3>
      <p>
        Durable data outlives code. If you rename or delete an agent folder, startup fails with
        that error; if you remove a tool, app or MCP file that an instance still installs, it fails
        with <code>Unknown Foundry tool capability</code>. Restore the file, start the runtime,
        and remove the reference first (<code>client.uninstall</code>, or{" "}
        <code>client.configureAgent(id, {"{"} installations {"}"})</code>), or edit the record in
        your data store (<code>.data/foundry.json</code> for the file adapter).
      </p>

      <h2 id="server">Running the server</h2>

      <h3 id="bind-refused">Foundry refuses to bind 0.0.0.0</h3>
      <CodeBlock filename="terminal" language="text" code={`Foundry refuses to bind 0.0.0.0 without application.requestAuthorization. Keep the runtime on loopback or provide a user-owned authorization adapter.`} />
      <p>
        The default host is <code>127.0.0.1</code>. Any non-loopback <code>server.host</code> or{" "}
        <code>--host</code> requires an authorization adapter in{" "}
        <code>foundry.application.ts</code>. It sees the method, path, query,{" "}
        <code>Authorization</code> header, cookie and remote address of every request — API,
        inspector, health checks and event streams — and returns only a boolean. A denial is a 401
        with your <code>challenge</code> as <code>WWW-Authenticate</code>.
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { Effect } from "effect";
import { defineApplication } from "glove-foundry";

export default defineApplication({
  name: "support-desk",
  requestAuthorization: {
    identifier: "shared-bearer-token",
    challenge: 'Bearer realm="support-desk"',
    authorize: (request) =>
      Effect.sync(() => {
        const token = process.env.FOUNDRY_CONTROL_TOKEN;
        return Boolean(token) && request.authorization === \`Bearer \${token}\`;
      }),
  },
});`} />
      <p>
        Callers then send the header: <code>createFoundryClient({"{"} authorization: {"{"}{" "}
        identifier, headers: () =&gt; ({"{"} authorization: … {"}"}) {"}"} {"}"})</code>, or the
        OpenAI SDK’s <code>apiKey</code>. Put TLS and a firewall in front. See{" "}
        <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>.
      </p>

      <h3 id="port-in-use">Port 4141 is already in use</h3>
      <CodeBlock filename="terminal" language="text" code={`Error: listen EADDRINUSE: address already in use 127.0.0.1:4141`} />
      <p>
        Another process (often a forgotten <code>pnpm dev</code>) holds the port, and the failed
        runtime may keep running until you press Ctrl+C. Stop the other process, or pick another
        port with <code>pnpm dev --port 4142</code> (<code>npm run dev -- --port 4142</code>) or{" "}
        <code>server: {"{"} port: 4142 {"}"}</code> in <code>foundry.config.ts</code>. Then point
        clients at it (<code>baseUrl</code>, <code>FOUNDRY_URL</code>, the OpenAI{" "}
        <code>baseURL</code>).
      </p>

      <h3 id="node-version">Which Node version do I need? I get SQLite errors</h3>
      <p>
        Foundry requires Node 22 or newer (<code>&quot;engines&quot;: {"{"} &quot;node&quot;:
        &quot;&gt;=22&quot; {"}"}</code>); 22.13+ is recommended. <code>glove-memory/sqlite</code>{" "}
        uses Node’s built-in <code>node:sqlite</code>, which needs 22.13+, so earlier 22.x
        releases fail when that module loads. Check <code>node --version</code> and upgrade.
      </p>

      <h3 id="two-glove-js">TypeScript says two JsSession (or Glove) types are incompatible</h3>
      <p>
        Your project has two copies of a Glove package, typically <code>glove-js</code>: one that{" "}
        <code>glove-foundry</code> depends on and one you added with a different version. Classes
        from different copies do not type-match. Keep <code>glove-core</code>,{" "}
        <code>glove-js</code>, <code>glove-memory</code>, <code>glove-working-environment</code>{" "}
        and friends on the versions your installed <code>glove-foundry</code> declares (see{" "}
        <code>node_modules/glove-foundry/package.json</code>), reinstall, and confirm one copy with{" "}
        <code>pnpm why glove-js</code> or <code>npm ls glove-js</code>. <code>init</code> writes
        those versions for you and prints a warning when it had to fall back to built-in defaults.
      </p>

      <h2 id="calling">Calling agents</h2>

      <h3 id="call-from-app">How do I call an agent from my app?</h3>
      <table>
        <thead><tr><th>Use</th><th>When</th><th>Shape</th></tr></thead>
        <tbody>
          <tr><td>Typed client, <code>glove-foundry/client</code></td><td>A TypeScript backend that manages instances, conversations, installations, approvals and transcripts</td><td><code>createFoundryClient&lt;FoundryRoutes&gt;()</code>, <code>agent(route).create</code>, <code>createConversation</code>, <code>send</code>, <code>run.wait()</code></td></tr>
          <tr><td>OpenAI-compatible, <code>/v1/chat/completions</code> and <code>/v1/responses</code></td><td>Existing OpenAI SDK code, any language, chat UIs</td><td><code>model</code> = instance id; continue with <code>x-foundry-conversation-id</code>, <code>conversation_id</code> or <code>user</code></td></tr>
          <tr><td>Automation API, <code>/v1/runs</code></td><td>Job runners and other services that start work and follow it</td><td><code>POST /v1/runs</code> <code>{"{"} model, input {"}"}</code> → 202; <code>GET /v1/runs/:id</code>, <code>/events</code> (SSE with <code>Accept: text/event-stream</code>), <code>POST /stop</code>, <code>/steer</code></td></tr>
        </tbody>
      </table>
      <p>
        All three resolve to a persisted instance and write into a durable conversation, and all
        three show up in the inspector. From a browser, go through your own server route rather
        than exposing the runtime. See <Link href="/foundry/docs/runtime">Client &amp; HTTP API</Link>{" "}
        and <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>.
      </p>

      <h3 id="wait-timeout">run.wait() throws “Timed out waiting for Foundry run”</h3>
      <p>
        <code>wait()</code> polls every 150 ms for up to 60 s by default. Pass{" "}
        <code>run.wait({"{"} timeoutMs: 300_000 {"}"})</code> for longer work. Timing out does not
        cancel the run (use <code>run.cancel()</code>). A run paused on an approval stays{" "}
        <code>running</code> until someone decides.
      </p>

      <h3 id="credentials">Where do API keys and other credentials go?</h3>
      <ul>
        <li>
          <strong>Model provider keys</strong> are environment variables your model adapter reads,
          e.g. <code>OPENROUTER_API_KEY</code>. The CLI loads <code>.env</code> and then{" "}
          <code>.env.local</code> from the project root into the runtime and every run’s worker,
          never overwriting a variable that is already set — so the shell beats both files, and{" "}
          <code>.env</code> beats <code>.env.local</code> for the same key. The dev server restarts
          when either file changes.
        </li>
        <li>
          <strong>Integration credentials</strong> never enter Foundry. An account (
          <code>defineAccount</code>) holds metadata and an opaque <code>accessRef</code>; your{" "}
          <code>accountSessions</code> adapter on the agent definition turns that into a live
          session inside <code>withAccountSession</code>. MCP auth comes from your{" "}
          <code>mcpAdapter</code> (<code>getAuthHeaders</code>, <code>getAccessToken</code>,{" "}
          <code>getStdioEnvironment</code>).
        </li>
        <li>
          Never put secrets in installation config, instance context, prompts or manifests; those
          are stored and displayed. Incoming HTTP auth is{" "}
          <Link href="#bind-refused"><code>requestAuthorization</code></Link>, which also stores
          nothing.
        </li>
      </ul>

      <h3 id="large-images">Sending an image returns 413 “Request body exceeds the 1048576-byte limit”</h3>
      <p>
        JSON bodies are capped at 1 MB by default, and base64 adds about a third to a file’s size.
        Raise the cap for trusted multimodal clients:
      </p>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4141, messageBodyBytes: 40 * 1024 * 1024 },
});`} />
      <p>
        Allowed values are 1048576 to 134217728 (128 MB). The setting applies to message-bearing
        endpoints — <code>POST /api/conversations/:id/messages</code>, run steering,{" "}
        <code>/v1/chat/completions</code>, <code>/v1/responses</code>, <code>/v1/runs</code> and
        its steer route — while other endpoints stay at 1 MB. For large media, prefer URL sources
        over base64.
      </p>

      <h2 id="automation">Schedules and approvals</h2>

      <h3 id="schedule-did-not-fire">Why didn’t my schedule fire, and where do I see it?</h3>
      <ul>
        <li>
          <strong>It was never armed.</strong> A <code>schedules</code> entry becomes an activation
          only when that instance next runs. An instance that has never run has none.
        </li>
        <li>
          <strong>It was lost.</strong> Activations live in the data adapter; with{" "}
          <code>MemoryFoundryDataAdapter</code> every restart (including dev hot restarts) drops
          them. Use a durable adapter. Activations fire only while the runtime is running.
        </li>
        <li>
          <strong>Wrong clock.</strong> Cron <code>timezone</code> defaults to <code>UTC</code>.
        </li>
        <li>
          <strong>It was paused or cancelled.</strong> The agent can pause, resume and cancel its
          own schedules with <code>glove_foundry_schedules</code>. Once a definition schedule’s
          activation is cancelled for an instance, Foundry does not re-arm it for that instance.
        </li>
      </ul>
      <p>
        See them on the inspector’s <strong>Automations</strong> page, with{" "}
        <code>client.activations(workspaceId)</code>, or at{" "}
        <code>GET /api/activations?workspace=…</code>. A run it starts appears in{" "}
        <strong>Runs</strong> with source <code>activation</code>. See{" "}
        <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>.
      </p>

      <h3 id="approvals">My permission-gated tool never asks, or is always denied</h3>
      <p>
        Foundry turns <code>requiresPermission</code> into an approval record only through its
        default display manager; if the definition sets <code>displayManager</code>, requests go
        to yours instead. Records expire after 5 minutes and do not survive a runtime restart.
        Programmatic tool calling from a REPL refuses to run a tool whose input needs approval;
        the model must call it directly. Denied, expired and undeliverable requests fail closed:
        the tool does not run and the model receives{" "}
        <code>Permission denied for tool &quot;…&quot;</code>. List pending requests with{" "}
        <code>client.approvals({"{"} status: &quot;pending&quot; {"}"})</code> or on the
        inspector’s Overview. See <Link href="/foundry/docs/approvals">Approvals &amp;
        steering</Link>.
      </p>

      <h2 id="choosing">Choosing Foundry</h2>

      <h3 id="foundry-vs-core">Do I need Foundry, or is glove-core enough?</h3>
      <p>
        <code>glove-core</code> is the agent loop: a model adapter, tools, a store and a display
        manager, running inside your process. Use it alone to embed one agent in an existing
        server, a <Link href="/docs/next">Next.js route</Link>, a{" "}
        <Link href="/docs/react">React app</Link> or a script, where you own hosting and state.
      </p>
      <p>
        Add Foundry when you need what sits around the loop: many persisted instances of one
        definition, durable conversations, per-instance installations, schedules and sleep,
        inbound and outbound transports, human approvals, an inspector with WebChat, a typed
        client, and OpenAI-compatible endpoints. A Foundry agent is still a Glove agent — its tools
        are Glove tools and its <code>store</code> is a Glove <code>StoreAdapter</code> — so you
        can start with <code>glove-core</code> and move later.
      </p>
    </article>
  );
}
