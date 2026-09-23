import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { getPost, postMetadata } from "@/lib/blog";
const post = getPost("agents-with-browsers-and-sandboxes")!;
export const metadata = postMetadata(post);

export default function Post() {
  return <article className="docs-content">
    <BlogPostHeader post={post} />
    <p className="blog-lede">An agent that can research a website, write a small application, and keep its server running needs several kinds of state. Glove's new execution package gives those capabilities explicit mounts. Foundry can host their resources on the same Station daemon that runs the agent's jobs.</p>
    <p>Consider a direction such as “Visit this site, find the information I need, and build a small dashboard.” The agent needs a browser session, a place to write files, commands that can outlive a model response, and a way to inspect what happened. Those resources have different owners and different lifetimes. Treating them all as conversation history loses that distinction.</p>
    <h2 id="family">A new member of the Glove family</h2>
    <p><code>glove-execution</code> attaches browser and sandbox capabilities to an existing runnable. <code>glove-core</code> continues to supply the portable agent loop. The model still belongs to the agent. Browser providers, container runtimes and Station clients stay in optional packages and application configuration.</p>
    <figure><img src="/foundry/operator/family.svg" width={1200} height={610} alt="The new execution package alongside Glove's independent scripting, memory and workspace packages, with Foundry providing optional managed hosting." /><figcaption>The execution package connects resource lifecycles to capabilities the agent can use. Existing memory and workspace packages keep their own responsibilities.</figcaption></figure>
    <p>This follows the same ownership principle as <code>glove-mcp</code>: mount capabilities onto the runnable the application already built. A browser mount should never ask for the main model or silently wrap it. Screenshots use portable native content parts supplied through transient runtime context.</p>
    <CodeBlock language="typescript" code={`const browser = mountBrowser(agent, { adapter: browserAdapter });
const sandbox = mountSandbox(agent, { adapter: sandboxAdapter });`} />
    <p>The familiar working environment remains useful for virtual files, scripts, checkpoints and artifact formats. A remote coding sandbox adds a live operating-system environment with commands and services. An application can compose both. They do not automatically share a filesystem merely because they belong to the same agent.</p>
    <h2 id="scripts">A workflow can be a program</h2>
    <p>A browser interaction often has a predictable middle: inspect the page, choose an element, fill it, click, and check the result. Making each line a separate model turn adds delay and scatters intermediate state through the conversation.</p>
    <p>The default mount exposes one browser scripting tool and one sandbox scripting tool, backed by <code>glove-js</code>. The interpreter can call registered functions, branch and reuse values within a run. Tool schemas are discoverable inside the program, so the model can inspect an unfamiliar operation before using it.</p>
    <CodeBlock language="javascript" filename="One browser program" code={`const page = browser.open({});
browser.navigate({ sessionId: page.id, url: "https://example.com" });
const observed = browser.observe({ sessionId: page.id });
browser.screenshot({ sessionId: page.id });
observed;`} />
    <p>Functions resolve automatically. The interpreter has no ambient host access, and evaluating JavaScript inside the page requires a separate grant. Screenshots reach the next model turn as images after the complete tool-result batch. A script can act on structured observations immediately; interpreting a screenshot still requires the model.</p>
    <p>Effects happen as the program runs. If the last line fails, an earlier click may already have succeeded. Unknown outcomes must be inspected before repeating a mutation. The mount does not replay an entire failed workflow.</p>
    <h2 id="daemon">One Station, owned by Foundry</h2>
    <p>Foundry now starts a managed Station 3 daemon for agent execution. An application can optionally provide browser and sandbox adapters to that same instance. A second resource server is unnecessary for the local setup.</p>
    <CodeBlock language="typescript" filename="foundry.application.ts" code={`import { defineApplication } from "glove-foundry";
import { stationDaemon } from "glove-foundry/station";

export default defineApplication({
  name: "Operator",
  daemon: stationDaemon({
    stationId: "operator",
    resources: createResources,
    onReady: savePrivateConnection,
  }),
});`} />
    <p>The two callback functions are application code: one returns provider adapters, and the other stores the private connection for trusted clients. Foundry loads the resource factory once inside the daemon. It owns startup, shutdown and cleanup after failed startup. Agents still receive explicitly scoped mounts on each run; enabling a provider does not grant every agent access to it.</p>
    <figure><img src="/foundry/operator/architecture.svg" width={1200} height={530} alt="One Foundry-managed Station contains agent jobs and optional resource adapters connected to Steel and Docker." /><figcaption>Foundry manages the Station process. Applications select providers and resource grants.</figcaption></figure>
    <p>Omitting the daemon adapter keeps the jobs-only configuration. Applications can also mount adapters connected to external workers. The managed daemon is local and stops with Foundry; it does not provide distributed failover or restore interrupted live jobs. Node 22+ is required for this Foundry runtime, while the execution package's default entrypoint remains portable.</p>
    <h2 id="state">Keep responsibility where it belongs</h2>
    <p>Conversation memory starts with an agent conversation. Applications can retrieve additional knowledge or preferences from wider scopes when that fits their design. The framework does not decide that one user's browser observations should become another conversation's memory.</p>
    <p>The same distinction applies to task continuity and provider availability. An application chooses checkpoint instructions, compaction policy, persistence, and whether to acquire a capability eagerly or lazily. Mounting a browser does not make those product decisions on its behalf.</p>
    <p>Operator demonstrates one composition: SQLite-backed native memory, exact-request archives, pinned task context and a dedicated compaction prompt. These are application choices. Tests show that saved state survives reconstruction and compaction; they do not guarantee that a model will always save the right checkpoint. A successful tool call is evidence about that operation, not proof that the user's whole task is complete.</p>
    <h2 id="operator">A runnable application, not a site-specific integration</h2>
    <p>The Operator example uses Steel with proxies and a persistent browser profile, plus a Docker-backed coding workspace. Users give ordinary directions. A request to open a messaging site uses the same browser tools as a research request; there is no preloaded Telegram workflow. Human sign-in remains a handoff to the user.</p>
    <figure><img src="/foundry/operator/workspace.png" width={1440} height={960} alt="Operator's public Field Notes demo running in its sandbox preview." /><figcaption>A captured demo application built and served from the sandbox. Documentation assets contain public demo data.</figcaption></figure>
    <p>Live checks exercised a public page through Steel, native screenshot delivery, code creation, a managed container service and an HTTP response. A subsequent check verified browser and sandbox access through the single Foundry-owned Station. Telegram sign-in has not been verified end to end; the earlier QR screen remained loading. A proxy is a provider option, not a promise that every site will accept the session.</p>
    <p>The practical addition is a consistent path from a user's direction to resources the agent can inspect and control. Start with the <a href="/docs/execution">execution guide</a> for the package boundaries, then run the <a href="/foundry/docs/browser-and-sandbox">Operator walkthrough</a>. The <a href="/foundry/llms-full.txt">machine-readable reference</a> includes the same mounting and daemon setup.</p>
  </article>;
}
