import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Browsers & Sandboxes",
  description: "Mount browser scripting and persistent sandbox capabilities on Glove agents, with optional shared Station hosting in Foundry.",
};
export default function ExecutionPage() {
  return <article className="docs-content">
    <h1>Browsers &amp; sandboxes</h1>
    <p className="blog-lede"><code>glove-execution</code> gives an existing agent browser workflows and a persistent coding sandbox. The agent keeps its model; adapters own the connection to the resource backend.</p>
    <p>Use it when the agent needs to inspect websites, interact with a page, write files, execute commands, or run a service. Station 3 is the first backend. The default package entrypoint uses portable JavaScript and Web APIs; Station integration lives in the separate <code>glove-execution/station</code> entrypoint.</p>
    <h2 id="family">Where it fits</h2>
    <figure><img src="/foundry/operator/family.svg" width={1200} height={610} alt="Glove core supplies the agent loop, independent packages mount capabilities, and Foundry optionally hosts their resources on its managed Station." /><figcaption>Choose capability packages independently, then choose the application's hosting and persistence adapters.</figcaption></figure>
    <table><thead><tr><th>Package</th><th>Responsibility</th></tr></thead><tbody>
      <tr><td><code>glove-core</code></td><td>Portable agent loop, model, tools, stores and transient context.</td></tr>
      <tr><td><code>glove-js</code></td><td>A bounded interpreter for composing registered functions into one program.</td></tr>
      <tr><td><code>glove-execution</code></td><td>Browser and sandbox mounts, with scoped resource access through adapters.</td></tr>
      <tr><td><code>glove-working-environment</code> / <code>glove-vfs</code></td><td>Workspace files, scripts, checkpoints and artifact composition. They remain distinct from a live container or browser process.</td></tr>
      <tr><td><code>glove-memory</code></td><td>Context, entities, episodes and resources. Applications choose scope and what to retrieve.</td></tr>
      <tr><td><code>glove-foundry</code></td><td>Application assembly, instances, conversations, schedules and managed execution.</td></tr>
    </tbody></table>
    <h2 id="mount">Mount on an existing agent</h2>
    <CodeBlock language="bash" code="pnpm add glove-execution station-browser-use station-client" />
    <CodeBlock language="typescript" filename="Agent setup" code={`import { mountBrowser, mountSandbox } from "glove-execution";

// The application supplies scoped adapters. Configure the agent's model normally.
const browser = mountBrowser(agent, { adapter: browserAdapter });
const sandbox = mountSandbox(agent, { adapter: sandboxAdapter });

try {
  await agent.processRequest("Inspect a site and build a small demo.");
} finally {
  await Promise.allSettled([browser.close(), sandbox.close()]);
}`} />
    <p>Mounting exposes <code>execute_browser</code> and <code>execute_sandbox</code>. It does not open a browser or create a sandbox automatically. <code>surface: &quot;tools&quot;</code> exposes direct operations instead of scripting. The mount neither requires nor replaces a model.</p>
    <h2 id="workflow">Compose a workflow in one call</h2>
    <CodeBlock language="javascript" filename="execute_browser program" code={`const page = browser.open({});
browser.navigate({ sessionId: page.id, url: "https://example.com" });
const observation = browser.observe({ sessionId: page.id });
browser.screenshot({ sessionId: page.id });
observation;`} />
    <p>Registered functions resolve automatically; <code>await</code> is optional. Use <code>fns(&quot;browser&quot;)</code> and <code>describe(&quot;browser__interact&quot;)</code> to discover schemas. Branch, inspect and act in the same program. The interpreter has no ambient host filesystem, imports or network access. Page evaluation is a separate adapter grant.</p>
    <p>The newest screenshot reaches the next model iteration as native image content after the tool results. It is transient and bounded; image bytes stay out of script output, saved conversation history and runtime-context telemetry. Visual reasoning still requires a model turn. A failed script may already have changed the external resource, so it is not automatically replayed.</p>
    <p>To judge a page without reading it, wrap the adapter with <code>withClassifier(adapter, &#123; classifier: jev() &#125;)</code> from <a href="/docs/classifier#browser">glove-classifier</a>. The added <code>browser.judge(&#123; sessionId, questions &#125;)</code> observes the page and returns only typed answers. Questions like &ldquo;is this a login wall?&rdquo; or &ldquo;did checkout succeed?&rdquo; get answered without the DOM entering context.</p>
    <h2 id="foundry">Let Foundry own one Station</h2>
    <CodeBlock language="typescript" filename="foundry.application.ts" code={`import { defineApplication } from "glove-foundry";
import { stationDaemon } from "glove-foundry/station";

export default defineApplication({
  name: "Assistant",
  daemon: stationDaemon({
    stationId: "assistant",
    resources: createResources, // application factory: { browser, sandbox }
    onReady: savePrivateConnection,
  }),
});`} />
    <p>The application supplies the factory and private connection storage. Foundry invokes the factory once inside its managed Station daemon and owns startup and shutdown. The same Station runs agent jobs and resource APIs. Omit this option for jobs only, or return only the provider you need. Agent definitions continue to mount explicitly with per-run grants.</p>
    <p><code>onReady</code> receives a private operator connection, never a value to put in model context or frontend code. Station 3's operator API requires admin scope. Provider credentials remain in the resource adapters. Programmatic runtime setup supplies <code>applicationFilePath</code> so the daemon can load the application itself.</p>
    <h2 id="lifetimes">Choose lifetimes in the application</h2>
    <p>Browser pages, browser profiles, sandbox files, services, script bindings and conversation memory have different lifetimes. Retaining a scope does not keep its daemon alive. Persisted files and profiles depend on provider adapters; unfinished task tracking depends on the application's memory and prompting choices. Conversation-scoped memory remains the default.</p>
    <p>Foundry requires Node 22+; Operator's SQLite memory needs Node 22.13+. Managed execution is local and stops with Foundry. The queue is currently in memory; durable Foundry activations can be reconstructed, but an interrupted live process is not restored.</p>
    <p>Continue with the <a href="/foundry/docs/browser-and-sandbox">illustrated Operator walkthrough</a>, <a href="https://github.com/porkytheblack/glove/blob/main/packages/glove-execution/README.md">adapter and lifecycle reference</a>, or <a href="/blog/agents-with-browsers-and-sandboxes">design story</a>.</p>
  </article>;
}
