import Link from "next/link";
import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("introducing-glove-foundry")!;
export const metadata = postMetadata(post);

export default function FoundryLaunchPost() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        For a decade, software asked us to draw the workflow before anyone could do
        the work. Glove Foundry starts from a different premise: define capable agents,
        give them a world, and let the route emerge from the user&apos;s intent.
      </p>

      <p>
        We built Glove as a set of faculties. Models and tools. Rendered interfaces.
        Memory and inboxes. Voice and images. A mesh. A working environment in which an
        agent can write code, make a document, inspect the result, and try again. The
        pieces were useful on their own, but building a complete agent product still
        required every team to invent the same missing layer: discovery, composition,
        runtime identity, installation, event handling, scheduling, persistence,
        observability, and a place to see what was actually happening.
      </p>

      <p>
        <Link href="/foundry">Glove Foundry</Link> is that layer. It is a file-routed,
        Effect-native application framework for agent systems. If Glove is the set of
        organs, Foundry is the body that gives them a life together.
      </p>

      <div className="blog-note">
        <strong>The short version.</strong> Put typed definitions in files. Persist the
        choices that make one agent instance different from another. Foundry reconstructs
        the right agent for this message, runs it, and correlates everything it does.
      </div>

      <h2 id="application-framework">Agents needed an application framework</h2>
      <p>
        Next.js did not become useful by inventing buttons. It made routing, rendering,
        loading, bundling, development, and deployment feel like parts of one system.
        Agent development has reached the same moment. A model loop is not an application
        framework. A tracing dashboard is not an application framework. A graph of
        functions is not an application framework.
      </p>
      <p>
        Foundry gives agent products a conventional shape: <code>agents/</code> is the
        route tree; <code>agent.ts</code> describes the possible agent; colocated files
        define the capabilities that change with it. The development server discovers
        those files, generates route types, assembles instances, starts the runtime, and
        exposes the inspection workbench.
      </p>

      <CodeBlock filename="agents/creative-director/agent.ts" language="typescript" code={`export default defineAgent({
  description: "Turns strategy into a reviewable brand world",
  model: (_agent, ctx) => modelFor(ctx.message, ctx.agentInstance),
  tools: (_agent, ctx) => toolsFor(ctx.installations, ctx.message),
  memory: (_agent, ctx) => memoryFor(ctx.workspaceId, ctx.message),
  workingEnvironment: (_agent, ctx) =>
    ctx.messageText.includes("campaign") ? creativeWorkspace : undefined,
  systemPrompt: (_agent, ctx) =>
    creativeDirection(ctx.message, ctx.history, ctx.agentInstance.context),
});`} />

      <p>
        Notice what is absent: no request input schema, no declared response shape, no
        station signal, no hard-coded instance. <code>defineAgent</code> defines a data
        structure. The runtime owns requests and results. The data layer owns instances
        and conversations. Every major capability can be assembled lazily from the
        current message.
      </p>

      <h2 id="definition-instance">The definition is not the agent</h2>
      <p>
        This distinction is the center of Foundry. A definition is code: what this kind
        of agent may use and how its parts can resolve. Its ID comes from the file. An
        instance is data: which applications were installed, which account metadata is
        attached, which playbooks and schedules are active, which workspace it belongs
        to, and what context makes it this particular agent.
      </p>
      <p>
        A frontend can provision an agent, install a support application, subscribe it
        to two inbound events, give it a brand workspace, and change all of that later.
        No source file is rewritten. On the next run, Foundry loads the instance record,
        imports the current definition, and assembles the agent again.
      </p>

      <h2 id="workflow">The workflow is no longer the product</h2>
      <p>
        Most workflow software begins with the boxes and arrows. A person predicts the
        states, writes the branches, chooses which function follows which, and turns a
        messy human intention into a rigid executable diagram. That is valuable when the
        route is known and the cost of variation is high. It is also a strange default
        for work whose defining property is that the route is not known yet.
      </p>
      <p>
        Ask for a launch campaign. One request may need research, positioning, three
        creative territories, image generation, a critical review, a deck, and a phone
        briefing. Another may already have the research and need only retail adaptations.
        Encoding both as the same graph either wastes work or grows a forest of branches.
      </p>
      <p>
        In Foundry, the stable things are the capabilities and the contracts. The lead
        understands the intention, opens the work, provisions specialists, creates
        conversations, hands off artifacts through the workspace, and schedules a review.
        The agents can imagine the workflow and then build the artifacts that make the
        workflow real. The run is observable without requiring the path to have been
        drawn in advance.
      </p>

      <blockquote>
        The user describes the outcome. The system invents the work. The artifacts are
        not exhaust from a workflow; they are the material through which agents collaborate.
      </blockquote>

      <h2 id="events">Applications make agents reachable</h2>
      <p>
        Applications are installed on instances, not globally baked into definitions.
        Each app can own several inbound and outbound transmissions. Inbound transmissions
        authenticate, normalize, classify, and predicate external events. Outbound
        transmissions become tools only after installation and account resolution.
      </p>
      <p>
        Playbooks sit between the two as serializable runtime data. They say which
        classified event matters, how to merge it into a conversation, what directive
        the agent should follow, and where an answer may go. A playbook subscription can
        even provision one or many subscribed agents when an event arrives and no instance
        exists yet.
      </p>
      <p>
        Credentials remain outside Foundry. You decide how they are acquired, stored,
        selected, scoped, and refreshed. Foundry asks your adapter for the capability a
        run is allowed to use. It never turns a framework database into a secret vault by accident.
      </p>

      <h2 id="world">Glove gives the workforce a world</h2>
      <p>
        This release is powerful because Foundry does not stop at orchestration. Every
        native Glove surface can be mounted through the same composition model:
      </p>
      <ul>
        <li><strong>Memory and inboxes</strong> load for the current instance and message, rather than becoming global static configuration.</li>
        <li><strong>Working environments</strong> give agents a VFS, scripts, renderers, OCR, documents, spreadsheets, slides, images, audio, video, and artifact export.</li>
        <li><strong>REPLs</strong> expose a small request-specific function catalog instead of flooding every prompt with every tool.</li>
        <li><strong>Mesh, subagents, and typed calls</strong> support durable peers, focused specialists, and layered S2S or S2V systems.</li>
        <li><strong>Conversations, shared inboxes, tasks, and workspaces</strong> make multi-agent work a data model, not copied prompt text.</li>
        <li><strong>Schedules, sleep, and background work</strong> let an agent leave the turn, wake later, update or cancel future work, and reconvene a result.</li>
        <li><strong>Voice, avatars, and image generation</strong> turn the same workforce into something a user can call and something that can make and review media.</li>
      </ul>

      <h2 id="comparison">Why not LangGraph and LangSmith?</h2>
      <p>
        LangGraph is serious infrastructure. Its own documentation describes the core
        model as <a href="https://docs.langchain.com/oss/python/langgraph/graph-api">state,
        nodes, and edges</a>, and distinguishes fixed workflows from more autonomous
        agents in its <a href="https://docs.langchain.com/oss/python/langgraph/workflows-agents">workflow
        and agent guide</a>. If the graph is the artifact you want to design, that is a
        clear and capable abstraction.
      </p>
      <p>
        Foundry makes a different bet: the durable artifact is the agent application,
        not the graph. Runtime installations, persisted instances, event subscriptions,
        conversations, workspaces, schedules, and message-aware assembly are first-class.
        For products where users dynamically configure agent workforces—and where the
        correct workflow must emerge from intent—that is the better primitive.
      </p>
      <p>
        LangSmith is a broad observability and evaluation platform. Its
        <a href="https://docs.langchain.com/langsmith/observability-quickstart"> tracing
        quickstart</a> describes capturing application traces and viewing them in a
        separate service; its evaluation product supports rich offline and online
        programs. Foundry is not pretending those evaluation features do not matter.
        Its advantage is that inspection is native to the framework&apos;s runtime model:
        instances, conversations, passes, transmissions, schedules, handoffs, and
        artifacts are already the things being run, so the workbench does not need to
        infer an agent system from generic spans after the fact.
      </p>

      <div className="blog-note">
        <strong>Our claim is specific.</strong> Foundry is a better foundation for
        dynamically configured, product-facing agent systems that use the breadth of
        Glove. It does not make graphs, tracing exporters, or dedicated evaluation
        platforms obsolete. It makes them optional tools around an application model
        instead of the application model itself.
      </div>

      <h2 id="effect">Why Effect</h2>
      <p>
        The authoring surface should feel like ordinary TypeScript. The runtime should
        not behave like ordinary promise soup. Foundry uses Effect for typed failures,
        scoped services, interruption, retries, concurrency, resource safety, and
        dependency layers. When provider pressure interrupts a pass, when a connection
        drops, or when a scheduled run is cancelled, those are explicit state transitions
        with policies and events—not hopeful <code>try/catch</code> blocks spread across the product.
      </p>

      <h2 id="inspect">The runtime can explain itself</h2>
      <p>
        The inspector follows one correlation line from the inbound event or user message
        to the final artifact. It shows which agents are active, waiting, sleeping,
        retrying, or done; which messages and files passed between them; which model pass
        or tool is running; and which outbound transmission delivered the result.
      </p>
      <p>
        It shows work intent and safe progress notes, not private hidden reasoning. The
        product UI can subscribe to the same events and present a simpler campaign view,
        while the Foundry workbench remains available when a developer needs the whole machine.
      </p>

      <h2 id="begin">Begin with a folder</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init my-agent-system
cd my-agent-system
pnpm install
pnpm dev`} />
      <p>
        The result is a codebase, not a hosted wizard you can never leave. Read the
        <Link href="/foundry/docs"> Foundry handbook</Link>, run the reference application,
        replace the memory adapters with your own durable ones, and make the agent system
        your product needs—not the graph somebody else expected.
      </p>
    </article>
  );
}
