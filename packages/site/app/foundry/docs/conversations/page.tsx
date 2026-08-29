import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Conversations & work" };

export default function ConversationsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world / 06</span>
      <h1>Conversations, inboxes, and shared work</h1>
      <p className="blog-lede">
        The agent instance is an identity. A conversation is a data primitive. One
        instance can hold many simultaneous conversations while sharing selected
        memory, workspace entries, tasks, and inbox items across them.
      </p>

      <h2 id="conversations">Conversations are first-class</h2>
      <CodeBlock filename="conversation.ts" language="typescript" code={`const campaign = await foundry.createConversation(lead.id, {
  title: "Winter launch",
  workspaceId: "brand-q4",
});

const retail = await foundry.createConversation(lead.id, {
  title: "Retail activation",
  workspaceId: "brand-q4",
});

await Promise.all([
  foundry.send(lead.id, campaign.id, "Develop three creative territories."),
  foundry.send(lead.id, retail.id, "Adapt the approved platform for stores."),
]);`} />
      <p>
        The messages are isolated by conversation. The instance can still resolve the
        same durable brand memory and shared workspace, enabling parallel campaigns
        without copying context between prompts.
      </p>

      <h2 id="inboxes">Inboxes are lazily loaded</h2>
      <p>
        An inbox is not a static global mailbox. The definition resolves the relevant
        inboxes for the current agent instance, conversation, message, and policy. An
        approval inbox might mount only for production work; a private operations inbox
        might mount only for the lead.
      </p>
      <CodeBlock filename="agent.ts" language="typescript" code={`inboxes: (_agent, ctx) =>
  ctx.messageText.includes("approve")
    ? loadApprovalInbox(ctx.workspaceId, ctx.agentId)
    : [],`} />

      <h2 id="workspace">Shared workspace primitives</h2>
      <table>
        <thead><tr><th>Primitive</th><th>What it carries</th></tr></thead>
        <tbody>
          <tr><td>Workspace entries</td><td>Structured shared state such as briefs, decisions, research signals, and artifact references.</td></tr>
          <tr><td>Shared inbox</td><td>Handoffs, review requests, external results, and background-work reconvening.</td></tr>
          <tr><td>Tasks</td><td>Owned, status-bearing units of work correlated to an agent and optionally a conversation.</td></tr>
          <tr><td>Data environment</td><td>Scoped values available to the workspace, instance, or conversation without turning them into environment variables.</td></tr>
        </tbody>
      </table>

      <h2 id="artifacts">Pass artifacts, not copied prompt context</h2>
      <p>
        Agents should hand off a workspace path, entry, or artifact reference. The next
        agent reads the canonical file in its mounted environment. That preserves
        provenance and lets the inspector show who produced, reviewed, and changed it.
        Messages explain intent; artifacts carry the work.
      </p>

      <h2 id="background">Background work can reconvene</h2>
      <p>
        <code>glove_foundry_background</code> creates correlated work without blocking
        the current pass. With <code>reconvene: true</code>, its outcome returns through
        the shared inbox and wakes the parent conversation with a visible handoff rather
        than hiding another model call inside one tool result.
      </p>
    </article>
  );
}
