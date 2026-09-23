import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Browser & sandbox agent" };
const source = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-operator";

export default function BrowserAndSandboxPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world</span>
      <h1>A browser, a workspace,<br />and your next direction.</h1>
      <p className="blog-lede">Operator is a runnable Foundry agent that browses websites, uses Telegram Web after you sign in, writes code, and runs a server in a persistent container. Give it a direction and watch the work in one local console.</p>
      <figure><img src="/foundry/operator/browser.png" alt="Operator showing a public browser session beside the agent conversation" width={1440} height={960} /><figcaption>A real Foundry run against a public page. Personal browser sessions never become documentation assets.</figcaption></figure>
      <p><a href={source}>Open the example source ↗</a> · <a href={`${source}/README.md`}>Setup and operating guide ↗</a></p>

      <h2 id="run">Run Operator locally</h2>
      <p>You need Node 22.13+, pnpm, Docker, and keys for OpenRouter and Steel. The example runs from the Glove repository and reads keys from your environment or private files.</p>
      <CodeBlock language="bash" filename="Terminal" code={`pnpm install
pnpm --filter glove-core --filter glove-js --filter glove-execution --filter glove-foundry build
cd examples/foundry-operator
cp .env.example .env.local
# Set OPENROUTER_API_KEY_FILE and STEEL_API_KEY_FILE.
docker pull node:22-bookworm-slim
pnpm start`} />
      <p>Open <code>http://127.0.0.1:4243</code>. The console lets you give directions, see the browser, preview a running app and inspect agent steps. The full Foundry inspector runs on port 4245. This is a private, single-user local example.</p>
      <p>Steel sessions explicitly set <code>useProxy: true</code> to use its residential proxy network, including when creating the saved profile. Proxy availability and billing depend on your Steel account. There is no unproxied fallback; individual sites can still require sign-in or restrict access. See <a href="https://docs.steel.dev/overview/stealth/proxies">Steel&apos;s proxy documentation</a>.</p>

      <h2 id="mounts">Capabilities attach through mounts</h2>
      <p><code>glove-core</code> has no browser or container dependency. Install the optional <code>glove-execution</code> package and call its mount functions on an existing agent. Station adapters live behind the separate <code>glove-execution/station</code> entrypoint. Another provider can implement the same adapter contracts.</p>
      <CodeBlock language="typescript" filename="agents/operator/agent.ts · mounting pattern" code={`import { defineAgent } from "glove-foundry";
import { mountBrowser, mountSandbox } from "glove-execution";

export default defineAgent({
  description: "Browse, research and build",
  model: () => createModel(),
  async configure(agent, context) {
    const browserAdapter = await createBrowserScope(context);
    let closeBrowser = () => browserAdapter.close();
    context.onCleanup(() => closeBrowser());
    const browser = mountBrowser(agent, {
      adapter: browserAdapter,
    });
    closeBrowser = () => browser.close();

    const sandboxAdapter = await createSandboxScope(context);
    let closeSandbox = () => sandboxAdapter.close();
    context.onCleanup(() => closeSandbox());
    const sandbox = mountSandbox(agent, { adapter: sandboxAdapter });
    closeSandbox = () => sandbox.close();
  },
});`} />
      <p>The scope factories above are application-owned helpers. Operator&apos;s complete implementation constructs Station adapters with explicitly granted resource IDs. Register cleanup immediately after acquiring each resource, so a later setup failure also releases its scope.</p>
      <p>Configure the shared daemon once in the application. Foundry starts one Station instance for agent jobs and the optional browser/sandbox adapters; the console does not create another worker.</p>
      <CodeBlock language="typescript" filename="foundry.application.ts" code={`import { defineApplication } from "glove-foundry";
import { stationDaemon } from "glove-foundry/station";

export default defineApplication({
  name: "Operator",
  daemon: stationDaemon({
    stationId: "operator",
    resources: createResources, // returns { browser, sandbox }
    onReady: connection => savePrivateConnection(connection),
  }),
});`} />
      <p>The resource factory and private connection storage are application-owned. Omit the daemon option for jobs only; omit either provider when it is not needed. Foundry owns startup and shutdown. Agents still receive scoped access through their mounts.</p>
      <figure><img src="/foundry/operator/architecture.svg" alt="Foundry owns a single Station daemon that runs agent jobs and manages Steel browser and Docker sandbox adapters." width={1200} height={530} /><figcaption>One Foundry-managed Station owns jobs and optional resources. Applications choose providers; agents receive scoped mounts.</figcaption></figure>

      <h2 id="scripts">One script can finish a browser workflow</h2>
      <p>The model gets <code>execute_browser</code> and <code>execute_sandbox</code>, each backed by Glove&apos;s bounded JavaScript interpreter. Tool calls resolve automatically. A script can inspect a page, branch on what it sees, fill a form, click and verify without a model round trip for every action.</p>
      <CodeBlock language="javascript" filename="A browser program" code={`const sessionId = browser.sessions({}).sessionIds[0];
browser.navigate({ sessionId, url: "https://example.com" });
const heading = browser.evaluate({
  sessionId,
  expression: "document.querySelector('h1')?.textContent"
});
browser.screenshot({ sessionId });
heading;`} />
      <p>Discover schemas with <code>fns(&quot;browser&quot;)</code> and <code>describe(&quot;browser__interact&quot;)</code>. The workflow interpreter has no ambient host filesystem or network. Page evaluation is a separately granted browser capability. Screenshots enter the next model request as native images after tool results, rather than base64 text in the transcript.</p>

      <h2 id="telegram">Sign in to Telegram yourself</h2>
      <ol><li>Tell the agent: “I want to use Telegram Web. Open it and get to the QR sign-in screen; I’ll scan it.”</li><li>The agent uses its general browser tools to find the site, inspect the sign-in UI and show you the screen. There is no Telegram-specific setup or integration.</li><li>Scan the code with Telegram on your phone, then give your next direction.</li></ol>
      <p>The browser retains a Steel profile so you can reuse the sign-in across sessions. Profile changes persist when Steel releases the session; the live tab and script bindings have separate lifetimes. Telegram can still require another sign-in. Opening Telegram is not permission to send messages: the example instructs the agent to act on messages only when directed.</p>
      <p>Telegram sign-in has not been verified end to end: the earlier QR screen remained loading. The verified browser workflow uses a public page; a proxy does not guarantee a site will accept the session.</p>
      <p>Keep QR codes, signed-in screens and chat transcripts out of public screenshots. The images on this page show public demo data only.</p>

      <h2 id="server">Write code and keep a server running</h2>
      <figure><img src="/foundry/operator/workspace.png" alt="A Field Notes demo app generated by Operator and served from its persistent Docker workspace" width={1440} height={960} /><figcaption>The agent writes the code, starts a managed service and verifies its HTTP response.</figcaption></figure>
      <p>Station&apos;s container adapter supplies a non-root Node workspace with persistent files, bounded commands and managed services. The host supplies the image, resource limits and syscall policy. No host directory, provider key or Docker socket enters the container.</p>
      <p>Use <code>sandbox.writeText</code> to write source code directly. Use <code>sandbox.exec</code> for commands and poll <code>sandbox.command</code> until completion. Use <code>sandbox.startService</code> for a long-lived server. The console previews container port 3000 through a separate-origin, sandboxed HTTP GET bridge. It supports small assets, not WebSocket/HMR or form POSTs. The remote Steel browser cannot directly reach that local preview.</p>

      <h2 id="lifecycle">What survives the next direction?</h2>
      <p>Operator mounts a native Foundry memory profile backed by private SQLite storage. Pinned task checkpoints and preferences are refreshed before each model step. Episodic memory records requests and decisions, entity memory keeps reusable known items, and resource memory holds notes and archived summaries. Each conversation has its own namespace.</p>
      <p>The host preserves the exact current request outside compaction. The separate compaction prompt retains original outcomes, unfinished work, user constraints, evidence, uncertainty and the next action. Full transcripts, native task lists and inbox items survive restarts. Compaction pressure tracks the current context rather than accumulated billing across model calls.</p>
      <table><thead><tr><th>Resource</th><th>Lifetime</th></tr></thead><tbody>
        <tr><td>Conversation and instance</td><td>Private local files across restarts</td></tr>
        <tr><td>Task checkpoints, preferences and recall</td><td>Native SQLite memory across restarts, isolated per conversation</td></tr>
        <tr><td>Browser sign-in</td><td>Steel profile across released sessions</td></tr>
        <tr><td>Live pages</td><td>Until explicit close, idle or provider expiry</td></tr>
        <tr><td>Sandbox files</td><td>Docker volume until explicit deletion</td></tr>
        <tr><td>Server process</td><td>Managed service across agent turns; stops with the host</td></tr>
        <tr><td>Script variables</td><td>Current agent run only</td></tr>
      </tbody></table>
      <p>Operator uses retained browser and sandbox scopes. Closing a mount ends that run&apos;s access; the host retains resources and grants their IDs to the next run. Foundry&apos;s managed daemon remains local and stops with Foundry. The example is not distributed failover or a multi-tenant hosting service.</p>

      <h2 id="verification">A live verification you can repeat</h2>
      <CodeBlock language="bash" filename="With Operator running" code={`pnpm --filter glove-foundry-operator typecheck
pnpm --filter glove-foundry-operator test
pnpm --filter glove-foundry-operator verify
pnpm --filter glove-foundry-operator verify:memory`} />
      <p>The live check uses your provider credits. It asks the agent to inspect Example Domain, build a demo app, start a managed service, and verify its response. The test independently fetches the preview and checks that both mounted tools were used. See the <a href={`${source}/README.md`}>example README</a> for resource cleanup, persistence limits and troubleshooting.</p>
      <p>Verification uses a separate conversation and memory namespace. The memory check saves fictional task details, forces real-model compaction, and checks that a fresh activation recalls the unfinished task and restrictions. It does not change the user&apos;s pinned memory.</p>
    </article>
  );
}
