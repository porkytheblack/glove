import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Agent composition" };

export default function CompositionPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Model the system / 03</span>
      <h1>Context-based lazy assembly</h1>
      <p className="blog-lede">
        An agent definition is a composition of resolvers. Each resolver can return
        immediately or asynchronously, and can use the current instance, conversation,
        request, Glove message, history, installations, or run controls.
      </p>

      <h2 id="resolver-shape">One resolver shape</h2>
      <CodeBlock filename="agents/analyst/agent.ts" language="typescript" code={`export default defineAgent({
  model: (_agent, ctx) => modelFor(ctx.agentInstance, ctx.message),
  store: ({ conversationId }) => storeFor(conversationId),
  systemPrompt: (_agent, ctx) => buildPrompt(ctx),
  compactionLimit: (_agent, ctx) => ctx.messageText.length > 2_000 ? 80_000 : 40_000,
  tools: (_agent, ctx) => toolsFor(ctx.installations, ctx.message),
  memory: (_agent, ctx) => memoryFor(ctx.agentInstance, ctx.message),
  inboxes: (_agent, ctx) => loadInboxes(ctx.agentId, ctx.message),
  subagents: (_agent, ctx) => specialistsFor(ctx.message),
  playbooks: (_agent, ctx) => composePlaybooks(ctx.agentInstance, ctx.message),
  workingEnvironment: (_agent, ctx) => workspaceFor(ctx.workspaceId),
  repl: (_agent, ctx) => replFor(ctx.agentId, ctx.message),
});`} />
      <p>
        A literal value is shorthand for a resolver that always returns that value.
        Use literals for stable pieces and functions wherever capability should depend
        on policy or the current message.
      </p>

      <h2 id="colocation">Colocate what changes together</h2>
      <CodeBlock filename="agents/brand-lead" language="text" code={`agent.ts
composition.ts
tools/
  brief.tool.ts
apps/
  campaign-manager.app.ts
transmissions/
  campaign-events.transmission.ts
memory/
  brand-context.memory.ts
inboxes/
  approvals.inbox.ts
layers/
  request-context.layer.ts
subscribers/
  run-audit.subscriber.ts
workbench.ts`} />
      <p>
        Project-level folders are also valid for truly shared primitives. Import the
        same <code>imageReview</code> tool into several agent compositions; Foundry
        assembles and names the definition from its route without requiring copied IDs.
      </p>

      <h2 id="composition">Compose values, not registries</h2>
      <CodeBlock filename="agents/brand-lead/composition.ts" language="typescript" code={`import { composeAgent } from "glove-foundry";
import imageReview from "../../tools/image-review.tool.js";
import brandMemory from "./memory/brand-context.memory.js";
import workspaceLayer from "./layers/workspace.layer.js";

export const components = composeAgent(
  imageReview,
  brandMemory,
  workspaceLayer,
);`} />

      <h2 id="custom-runtime">Custom handlers and calls</h2>
      <p>
        Definitions are not required to assemble a model loop. A file may export a
        typed custom <code>run</code> handler for deterministic work, and agents can
        expose typed calls for other agents or application code. Zod infers inputs
        and outputs; ESLint and TypeScript enforce the framework conventions.
      </p>

      <h2 id="effect">Effect at the runtime boundary</h2>
      <p>
        Discovery and authoring stay ergonomic TypeScript. Runtime services use Effect
        for typed failures, scoped resources, retries, concurrency, dependency layers,
        and interruption. Adapters can return Effects directly without leaking backend
        execution details into agent definitions.
      </p>
    </article>
  );
}
