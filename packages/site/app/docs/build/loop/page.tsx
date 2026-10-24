import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { HarnessDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/loop";
export const metadata = docsMetadata(HREF);

export default function BuildLoopPage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>A loop and a tool</h1>
      <p className="blog-lede">
        The smallest harness is a model, one tool, and the loop between them. Across
        these eight steps we build one agent: a release assistant for a software team.
        It starts here as a script that answers &quot;what shipped this week?&quot; and
        ends as a deployed system that people message, that wakes on its own, and that
        asks before it tags a release.
      </p>

      <HarnessDiagram highlight="loop" caption="This step: the loop and its tools. State, context and the model form the cycle every request runs through." />

      <h2 id="install">Install</h2>
      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-core zod
export ANTHROPIC_API_KEY=sk-ant-...`} />

      <h2 id="the-agent">The whole agent</h2>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { z } from "zod";

// Stand-in for your Git host's API.
const merged = [
  { number: 412, title: "Retry failed webhooks", mergedAt: "2026-10-20", labels: ["fix"] },
  { number: 415, title: "Export invoices as CSV", mergedAt: "2026-10-21", labels: ["feature"] },
  { number: 418, title: "Bump Node to 22.13", mergedAt: "2026-10-22", labels: ["chore"] },
];

const agent = new Glove({
  store: new MemoryStore("release-assistant"),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
  displayManager: new Displaymanager(),
  systemPrompt:
    "You help a software team ship releases. Use tools for facts about the code; never guess.",
  compaction_config: {
    compaction_instructions: "Summarise the release work so far: what is merged, what is decided.",
  },
})
  .fold({
    name: "list_merged_changes",
    description: "List pull requests merged on or after a date, newest first.",
    inputSchema: z.object({
      since: z.string().describe("ISO date, e.g. 2026-10-19"),
    }),
    async do({ since }) {
      const changes = merged.filter((pr) => pr.mergedAt >= since).reverse();
      return { status: "success", data: changes };
    },
  })
  .build();

const result = await agent.processRequest("What has shipped since the 19th?");
// A hook can answer with a single Message; normally it is the model's result.
console.log("messages" in result ? result.messages[0]?.text : result.text);`}
      />
      <p>
        A Glove needs a <strong>model</strong>, a <strong>display manager</strong>{" "}
        (the surface tools can render to; empty for now), a <strong>system
        prompt</strong> and <strong>compaction instructions</strong>. The{" "}
        <strong>store</strong>, where the conversation lives, is optional and
        defaults to a fresh <code>MemoryStore</code>. <code>fold</code> adds a tool
        (before or after build); <code>build</code> binds the store and makes the
        agent runnable; <code>processRequest</code> runs the loop until the model
        answers without asking for a tool.
      </p>

      <h2 id="what-the-loop-does">What the loop already does</h2>
      <p>
        That <code>processRequest</code> call is doing more than calling the model in a
        loop. Each of these is something people write by hand the first time:
      </p>
      <ul>
        <li><strong>Validation.</strong> Input is checked against the Zod schema before your code runs. A bad call returns <code>TOOL_INPUT_INVALID</code> with the field errors, so the model corrects itself instead of your tool crashing.</li>
        <li><strong>Unknown tools.</strong> A misspelled tool name gets an error listing the tools that exist and the nearest match.</li>
        <li><strong>Retries.</strong> A tool that throws is retried (3 times by default, <code>maxRetries</code>) before the error goes back to the model.</li>
        <li><strong>Pairing.</strong> Every tool call is saved with its result before anything else happens, so history never holds an orphaned call that a provider would reject.</li>
        <li><strong>A turn limit.</strong> One request stops after 120 model turns by default (<code>compaction_config.max_turns</code>) and says so, so a confused agent can&apos;t loop forever.</li>
        <li><strong>Compaction.</strong> When the conversation nears the context limit, it is summarised with your instructions. The store keeps every message for your UI; the model sees the summary.</li>
        <li><strong>Token accounting.</strong> Input, output and prompt-cache tokens are counted per call and kept in the store.</li>
      </ul>

      <h2 id="stream">Stream it, stop it, switch models</h2>
      <p>
        A script wants output as it arrives. Subscribers receive typed events from
        every stage of the loop; an <code>AbortSignal</code> stops a request between
        steps.
      </p>
      <CodeBlock
        filename="release.ts"
        language="typescript"
        code={`import type { SubscriberEventDataMap as Events } from "glove-core";

agent.addSubscriber({
  async record(type, data) {
    if (type === "text_delta") process.stdout.write((data as Events["text_delta"]).text);
    if (type === "tool_use") {
      const call = data as Events["tool_use"];
      console.error(\`\\n→ \${call.name}\`, call.input);
    }
    if (type === "token_consumption") console.error("tokens", (data as Events["token_consumption"]).consumption);
  },
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
await agent.processRequest("Anything risky in this release?", controller.signal);

// Same agent, same history, another provider:
agent.setModel(createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini" }));`}
      />
      <p>
        <code>createAdapter</code> covers Anthropic, OpenAI, Gemini, OpenRouter,
        Bedrock, the Vercel AI Gateway, Kimi, GLM, MiniMax, MiMo, Ollama and LM Studio.
        Pass <code>cache: true</code> for prompt caching where the provider needs it
        asked for. Your tools never change between providers.
      </p>

      <h2 id="tools-well">Write tools the model can use</h2>
      <ul>
        <li><strong>The description is the interface.</strong> The model picks tools by reading it. Say what it returns and when to use it.</li>
        <li><strong>Return small, structured data.</strong> A tool result stays in context for every later turn. Return what the model needs to decide, and put anything only your UI needs in <code>renderData</code>, which the model never sees.</li>
        <li><strong>Return <code>status: &quot;error&quot;</code> with a message</strong> for expected failures (not found, not allowed) so the model can react. Throw only for real faults, which get retried.</li>
        <li><strong>Mark tools that must finish</strong> (a payment, a write that can&apos;t be half-done) with <code>unAbortable: true</code>. Abort waits for them.</li>
      </ul>

      <h2 id="already-built">Already built for you</h2>
      <p>
        Everything Glove gives you for the loop and for tools. Several of these, such
        as MCP, code-as-tools and classifiers, come up again in later steps.
      </p>
      <AlreadyBuilt parts={["loop", "tools"]} />

      <h2 id="next">Next</h2>
      <p>
        The agent answers, but only in a terminal, and it can&apos;t ask anyone
        anything. In <Link href="/docs/build/surface">step 2</Link> it gets a surface:
        streaming into a web UI, tools that render components, and a tool that waits
        for a person to confirm.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
