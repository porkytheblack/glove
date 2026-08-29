import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Multi-agent systems" };

export default function MultiAgentPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world / 08</span>
      <h1>Multi-agent systems</h1>
      <p className="blog-lede">
        Foundry assembles agents; it does not force one orchestration pattern. Use
        focused subagents inside a run, mesh calls between durable instances, layered
        speech agents for S2S and S2V, or background fan-out that returns through shared work.
      </p>

      <h2 id="choose">Choose the smallest boundary</h2>
      <table>
        <thead><tr><th>Primitive</th><th>Use it when</th></tr></thead>
        <tbody>
          <tr><td>Subagent</td><td>A parent needs an isolated specialist within the same logical run.</td></tr>
          <tr><td>Typed call</td><td>Another component needs a schema-checked function with a known output.</td></tr>
          <tr><td>Spawn</td><td>Work needs a separate run, instance, or conversation now.</td></tr>
          <tr><td>Background</td><td>Work can proceed independently and reconvene later.</td></tr>
          <tr><td>Mesh</td><td>Durable agents need direct, broadcast, or acknowledged messages.</td></tr>
          <tr><td>Layered voice</td><td>A speaking agent delegates reasoning or vision while keeping the live session responsive.</td></tr>
        </tbody>
      </table>

      <h2 id="lazy-specialists">Provision specialists from the message</h2>
      <CodeBlock filename="agents/lead/agent.ts" language="typescript" code={`subagents: (_agent, { message }) => [
  defineSubagent({
    name: "critic",
    description: "Find concrete weaknesses in proposed brand work",
    systemPrompt: "Review the work. Return risks and exact revisions.",
    tools: message.text.includes("visual") ? [imageReview] : [],
  }),
],

calls: (_agent, ctx) => [
  defineCall({
    name: "campaign_scope",
    input: z.object({ campaign: z.string() }),
    output: CampaignScope,
    handler: ({ campaign }) => scopeFrom(ctx.workspaceId, campaign),
  }),
],`} />

      <h2 id="parallel">Parallel campaigns are conversations, not prompt branches</h2>
      <p>
        Create one conversation or workspace task per campaign and run them concurrently
        up to the application limit. The lead can monitor shared tasks and receive
        artifacts through the workspace inbox. Sequential dependencies are explicit
        handoffs; independent work remains parallel.
      </p>

      <h2 id="voice">Layer S2S and S2V agents</h2>
      <p>
        The live voice agent can remain a thin conversational layer while Foundry
        resolves a reasoning agent, visual reviewer, or tool-bearing worker behind it.
        Calls and message passing are correlated in the same run timeline. The voice
        transport stays an adapter; the agent definition remains provider-neutral.
      </p>

      <h2 id="observable">Make orchestration visible</h2>
      <p>
        Give every handoff a source, target, purpose, conversation, and artifact path.
        Emit safe work-intent events at milestones. Foundry shows message passing and
        progress without exposing private hidden reasoning or pretending a stream of
        low-level logs is a usable explanation.
      </p>
    </article>
  );
}
