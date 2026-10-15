import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Next.js integration",
  description:
    "Add Foundry agents to an existing Next.js app: the generated files, the typed client, route handlers, streaming, auth headers and FOUNDRY_URL.",
};

export default function NextjsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Next.js integration</span>
      <h1>Next.js integration</h1>
      <p className="blog-lede">
        Keep your agents in the same repository as the Next.js app that uses them. The
        agents live under <code>foundry/</code> and run in their own Foundry process; your
        route handlers call that process through a typed HTTP client, so nothing from the
        agent graph is bundled into the app.
      </p>

      <h2 id="init">Add Foundry to an app</h2>
      <CodeBlock filename="terminal" language="bash" code={`cd my-next-app
npx glove-foundry init . --target nextjs`} />
      <p>
        <code>--target nextjs</code> is optional: a directory with a{" "}
        <code>next.config.(js|mjs|ts|cjs)</code> file or a <code>next</code> dependency is
        detected. <code>--template</code> picks <code>travel-concierge</code> (default; agent{" "}
        <code>concierge</code>) or <code>minimal</code> (agent <code>assistant</code>). Existing
        files are never overwritten. The command writes:
      </p>
      <table>
        <thead><tr><th>Path</th><th>Contents</th></tr></thead>
        <tbody>
          <tr><td><code>foundry/agents/&lt;agent&gt;/**</code></td><td>The template’s agent and its convention files</td></tr>
          <tr><td><code>foundry/foundry.application.ts</code></td><td>Data adapter, accounts and routes (in-memory to start)</td></tr>
          <tr><td><code>foundry/lib/**</code></td><td>Template helpers (the travel concierge’s demo model)</td></tr>
          <tr><td><code>foundry/package.json</code></td><td><code>{"{ \"type\": \"module\", \"engines\": { \"node\": \">=22\" } }"}</code>, scoping ESM to the agents</td></tr>
          <tr><td><code>foundry/README.md</code></td><td>How to run both processes</td></tr>
          <tr><td><code>foundry.config.mts</code></td><td><code>agentsDir: &quot;foundry/agents&quot;</code>, <code>applicationFile: &quot;foundry/foundry.application.ts&quot;</code>, port 4141</td></tr>
          <tr><td><code>foundry.env.example</code></td><td>Provider variables (<code>OPENROUTER_API_KEY</code>, <code>OPENROUTER_MODEL</code>)</td></tr>
          <tr><td><code>lib/foundry.ts</code></td><td>The typed client your app imports</td></tr>
          <tr><td><code>app/api/&lt;agent&gt;/route.ts</code></td><td>An example route handler</td></tr>
          <tr><td><code>.foundry/routes.d.ts</code></td><td>Generated route types; rewritten on every <code>foundry:dev</code>/<code>foundry:start</code></td></tr>
          <tr><td><code>package.json</code> (merged)</td><td>Adds <code>foundry:dev</code> (<code>glove foundry dev</code>) and <code>foundry:start</code> (<code>glove foundry start</code>) unless scripts with those names exist, plus the dependencies below</td></tr>
        </tbody>
      </table>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          Dependencies are set, not merged: <code>glove-foundry</code>, <code>glove-core</code>,{" "}
          <code>effect</code> and <code>zod</code> (plus <code>glove-js</code>,{" "}
          <code>glove-memory</code> and <code>glove-working-environment</code> for the travel
          concierge) get the exact ranges this Foundry was built against, replacing any range
          your app already had. An app on <code>zod@3</code> is moved to <code>zod@4</code>.
          Review the diff before installing. No <code>tsconfig</code>, ESLint config or{" "}
          <code>.gitignore</code> changes are made; ignore <code>.foundry/</code> and any data
          directory yourself.
        </p>
      </div>

      <h2 id="why-separate">Why the runtime is a separate process</h2>
      <ul>
        <li>
          It owns durable state and timers: instances, conversations, schedules and sleeping
          runs should not restart when a React component hot-reloads.
        </li>
        <li>
          It starts its own execution daemon and one Node process per agent run, which does not
          fit a route handler’s lifecycle.
        </li>
        <li>
          The app only talks HTTP. <code>glove-foundry/client</code> has no runtime imports
          (it needs only <code>fetch</code>), and <code>FoundryRoutes</code> is a type-only import
          erased at build time.
        </li>
        <li>
          Next.js apps are usually CommonJS packages. The nested{" "}
          <code>foundry/package.json</code> makes the agent tree ESM, and the{" "}
          <code>.mts</code> config is ESM whatever the root says, so Foundry’s ESM-only exports
          load correctly.
        </li>
      </ul>

      <h2 id="develop">Run both in development</h2>
      <CodeBlock filename="terminal" language="bash" code={`cp foundry.env.example .env.local   # or merge into your existing .env.local
pnpm install

pnpm foundry:dev   # terminal 1: Foundry runtime + inspector on http://127.0.0.1:4141
pnpm dev           # terminal 2: Next.js on http://localhost:3000`} />
      <p>
        Both processes read the app root’s <code>.env.local</code>. Foundry also reads{" "}
        <code>.env</code> first and never overwrites a variable that is already set.{" "}
        <code>foundry:dev</code> restarts when a file under <code>foundry/agents/</code>,{" "}
        <code>foundry.config.mts</code>, <code>.env</code> or <code>.env.local</code> changes. It
        watches the project root non-recursively, so restart it yourself after editing{" "}
        <code>foundry/foundry.application.ts</code> or <code>foundry/lib/</code>. Open the
        inspector at <code>http://127.0.0.1:4141</code> to watch runs your routes start (see{" "}
        <Link href="/foundry/docs/observability">Inspector &amp; WebChat</Link>).
      </p>

      <h2 id="generated-code">The generated client and route</h2>
      <CodeBlock filename="lib/foundry.ts" language="typescript" code={`/**
 * The Next.js app talks to the Foundry runtime over HTTP, so nothing from
 * the agent graph is bundled into your app. \`FoundryRoutes\` is a type-only
 * import, erased at build time, and it is regenerated on every dev run — so
 * agent("concierge") is checked against the files that actually exist.
 */
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

export const foundry = createFoundryClient<FoundryRoutes>({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
});


// The agents live in foundry/agents. Start the runtime with
// \`foundry:dev\`; it serves the inspector at http://127.0.0.1:4141.`} />
      <CodeBlock filename="app/api/concierge/route.ts" language="typescript" code={`/**
 * POST /api/concierge — send a message to the agent and wait for its result.
 *
 * This runs on the server, so the Foundry runtime never has to be public.
 * For a streaming UI, subscribe to the runtime's /api/events instead of
 * awaiting run.wait().
 */
import { foundry } from "../../../lib/foundry.js";

export async function POST(request: Request) {
  const { message, workspaceId = "default" } = (await request.json()) as {
    message: string;
    workspaceId?: string;
  };

  // A real app reuses one instance per user rather than creating one per call.
  const agent = await foundry.agent("concierge").create({ workspaceId });
  const conversation = await foundry.createConversation(agent.id);
  const run = await foundry.send(agent.id, conversation.id, message);
  const completed = await run.wait();

  return Response.json({ runId: run.id, output: completed.output });
}`} />
      <p>
        <code>foundry.agent(route)</code> only accepts routes that exist in{" "}
        <code>.foundry/routes.d.ts</code>. <code>run.wait()</code> polls every 150 ms, returns
        once the run is <code>completed</code>, <code>failed</code> or <code>cancelled</code>, and
        throws after 60 s by default. The agent’s answer is <code>completed.output.value</code>.
      </p>

      <h2 id="per-user">One instance and conversation per user</h2>
      <p>
        The example creates a new instance and conversation on every request, so nothing is
        remembered. Give each user a stable instance and reuse its conversation:
      </p>
      <CodeBlock filename="lib/support.ts" language="typescript" code={`import { foundry } from "./foundry.js";

/** One durable instance and conversation per user. Cache the ids in your user table. */
export async function supportSessionFor(userId: string) {
  const id = \`support-\${userId}\`;
  const agent =
    (await foundry.agentInstances("support")).find((item) => item.id === id) ??
    (await foundry.agent("support").create({ id, workspaceId: "support", context: { userId } }));
  const [first] = await foundry.conversations(agent.id);
  const conversation = first ?? (await foundry.createConversation(agent.id, { title: "Support" }));
  return { agent, conversation };
}

// your code: resolve the signed-in user from your session or auth library.
export async function currentUserId(request: Request): Promise<string | null> {
  return request.headers.get("x-demo-user");
}`} />
      <CodeBlock filename="app/api/support/route.ts" language="typescript" code={`import { foundry } from "../../../lib/foundry.js";
import { currentUserId, supportSessionFor } from "../../../lib/support.js";

export async function POST(request: Request) {
  const userId = await currentUserId(request);
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { message } = (await request.json()) as { message: string };

  const { agent, conversation } = await supportSessionFor(userId);
  const run = await foundry.send(agent.id, conversation.id, message);
  // Stop polling if the browser goes away; the run itself keeps going.
  const settled = await run.wait({ timeoutMs: 120_000, signal: request.signal });

  if (settled.status !== "completed") {
    return Response.json({ runId: run.id, error: settled.error ?? settled.status }, { status: 502 });
  }
  return Response.json({ runId: run.id, reply: settled.output?.value });
}`} />
      <p>
        Multi-turn memory also needs a durable conversation store: the templates’{" "}
        <code>MemoryStore</code> gives every run an empty history. See{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h2 id="streaming">Streaming replies</h2>
      <p>
        Foundry’s <code>/v1/chat/completions</code> endpoint streams OpenAI-style chunks when{" "}
        <code>stream: true</code>. A route handler can forward that stream as-is:
      </p>
      <CodeBlock filename="app/api/support/stream/route.ts" language="typescript" code={`import { currentUserId, supportSessionFor } from "../../../../lib/support.js";

const FOUNDRY_URL = process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141";

export async function POST(request: Request) {
  const userId = await currentUserId(request);
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { message } = (await request.json()) as { message: string };
  const { agent } = await supportSessionFor(userId);

  const upstream = await fetch(\`\${FOUNDRY_URL}/v1/chat/completions\`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.FOUNDRY_API_TOKEN ? { authorization: \`Bearer \${process.env.FOUNDRY_API_TOKEN}\` } : {}),
    },
    body: JSON.stringify({
      model: agent.id, // an instance id
      stream: true,
      user: userId, // same user → same durable conversation on that instance
      messages: [{ role: "user", content: message }],
    }),
    signal: request.signal,
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-foundry-conversation-id": upstream.headers.get("x-foundry-conversation-id") ?? "",
    },
  });
}`} />
      <CodeBlock filename="lib/stream-reply.ts" language="typescript" code={`/** Browser helper: read the OpenAI-style chunks your stream route forwards. */
export async function streamReply(message: string, onText: (text: string) => void) {
  const response = await fetch("/api/support/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!response.ok || !response.body) throw new Error(await response.text());
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split("\\n\\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.replace(/^data: /, "");
      if (data === "[DONE]") return;
      const chunk = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
      const text = chunk.choices[0]?.delta.content;
      if (text) onText(text);
    }
  }
}`} />
      <ul>
        <li>
          Text arrives as it is generated when the agent’s model adapter streams (for example{" "}
          <code>createAdapter({"{ …, stream: true }"})</code>); otherwise the final answer arrives as
          one chunk. A failed run ends the stream with a <code>Foundry error: …</code> chunk.
        </li>
        <li>
          <code>model</code> is an instance id, or a definition id when exactly one instance of it
          exists. Chat Completions conversations are keyed by <code>user</code> (or{" "}
          <code>conversation_id</code> / the <code>x-foundry-conversation-id</code> header) into an{" "}
          <code>openai-…</code> conversation on that instance, separate from conversations you
          create with <code>createConversation</code>. See{" "}
          <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>.
        </li>
        <li>
          To stream a native run instead, call <code>foundry.send()</code> and forward{" "}
          <code>GET /v1/runs/:id/events</code> with <code>Accept: text/event-stream</code>; that
          stream ends when the run does and carries <code>agent.text_delta</code> events (see{" "}
          <Link href="/foundry/docs/runtime">Client &amp; HTTP API</Link>).
        </li>
      </ul>

      <h2 id="production">Production: FOUNDRY_URL and credentials</h2>
      <p>
        Deploy the Foundry runtime as its own service (see the{" "}
        <Link href="/foundry/docs/deploy#container">container recipe</Link>), then set{" "}
        <code>FOUNDRY_URL</code> in the Next.js server environment. Keep it server-only: never
        prefix it with <code>NEXT_PUBLIC_</code>, and never call Foundry from the browser. When the
        runtime binds a non-loopback address it requires{" "}
        <Link href="/foundry/docs/deploy#authorization"><code>requestAuthorization</code></Link>, so
        send credentials from the client:
      </p>
      <CodeBlock filename="lib/foundry.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

export const foundry = createFoundryClient<FoundryRoutes>({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
  // Only needed when the runtime enforces requestAuthorization.
  ...(process.env.FOUNDRY_API_TOKEN
    ? {
        authorization: {
          identifier: "next-server",
          headers: () => ({ authorization: \`Bearer \${process.env.FOUNDRY_API_TOKEN}\` }),
        },
      }
    : {}),
});`} />
      <p>
        The <code>headers</code> function runs on every request, so a rotated token is picked
        up without a restart. If your host caps route-handler duration, return the{" "}
        <code>runId</code> right away and poll <code>foundry.getRun(runId)</code> or stream
        instead of waiting on <code>run.wait()</code>.
      </p>

      <h2 id="glove-next">Foundry behind Next.js vs glove-next alone</h2>
      <p>
        <Link href="/docs/next"><code>glove-next</code></Link>’s{" "}
        <code>createChatHandler</code> is a streaming model proxy for{" "}
        <Link href="/docs/react"><code>glove-react</code></Link>: the agent loop, its tools and
        its display stack run in the browser, and the route only forwards model calls. With
        Foundry, the agent runs on your server as a durable instance and the route is a thin
        client.
      </p>
      <table>
        <thead><tr><th>Choose</th><th>When</th></tr></thead>
        <tbody>
          <tr>
            <td><code>glove-react</code> + <code>createChatHandler</code></td>
            <td>A copilot that lives in one page, with tools that render React UI or act on client state, and no server-side history or background work.</td>
          </tr>
          <tr>
            <td>Foundry behind Next.js</td>
            <td>Agents that must remember users across sessions, run on schedules or sleep, receive webhooks or messages through transmissions, ask for approvals, use server-only credentials, or be inspected and steered by operators.</td>
          </tr>
        </tbody>
      </table>
      <p>
        One app can use both for different features. New to Foundry? Start with the{" "}
        <Link href="/foundry/docs/tutorial">tutorial</Link>.
      </p>
    </article>
  );
}
