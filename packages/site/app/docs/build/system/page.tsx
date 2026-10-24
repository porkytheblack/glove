import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SystemDiagram } from "@/components/diagrams";
import { AlreadyBuilt, StepKicker, StepPath } from "@/components/build-step";
import { docsMetadata } from "@/lib/docs-nav";

const HREF = "/docs/build/system";
export const metadata = docsMetadata(HREF);

export default function BuildSystemPage() {
  return (
    <article className="docs-content">
      <StepKicker href={HREF} />
      <h1>Make it a system</h1>
      <p className="blog-lede">
        The release assistant is a complete harness, but it is still one agent in one
        process. Every team wants their own. It should check releases every Monday
        without being asked. A Slack message should reach it. Publishing should wait
        for a person&apos;s approval even when nobody is watching the chat, and the
        rest of your stack should be able to call it. That is the line between a
        harness and a system, and it is what Glove Foundry is for.
      </p>

      <SystemDiagram />

      <h2 id="move">Move the harness into Foundry</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init release-desk --template minimal
cd release-desk && pnpm install && pnpm dev     # inspector and WebChat at http://localhost:4141`} />
      <p>
        A Foundry project is a folder of agent definitions. The file path is the
        agent&apos;s id, so <code>agents/release/agent.ts</code> is the agent{" "}
        <code>release</code>. Everything from steps 1 to 6 moves into its fields:
      </p>
      <CodeBlock
        filename="agents/release/agent.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineSchedule } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";
import { listMergedChanges, tagRelease } from "./tools.js";   // server-side versions of the step 1 and 2 tools

const mondayCheck = defineSchedule({
  name: "monday-release-check",
  timing: { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" },
  message: "Check what merged last week and say whether a release is due.",
});

export default defineAgent({
  description: "Drafts, reviews and ships releases for one team",

  // Every field is a value or a function of the run's context.
  model: () => createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
  systemPrompt: (_agent, ctx) =>
    \`You help the \${String(ctx.agentInstance.context.team)} team ship releases. Use tools for facts.\`,

  // One durable store per conversation (step 4): each run is a fresh process.
  store: ({ conversationId }) => FileStore.open(conversationId),

  // Always-on tools. On the server, tag_release drops its pushAndWait confirm and
  // calls your release API directly with requiresPermission: true, which Foundry
  // turns into an approval record (below).
  tools: [listMergedChanges, tagRelease],

  // Desired recurring work, per instance; a team can opt out in its context.
  schedules: (_agent, ctx) => (ctx.agentInstance.context.weekly === false ? [] : [mondayCheck]),

  compactionInstructions: () => "Keep what is merged, what is decided and what is blocked.",
});`}
      />
      <p>
        The tools move to the server: <code>tag_release</code> calls your release API
        directly instead of <code>fetch(&quot;/api/releases&quot;)</code>, and its browser
        confirm becomes <code>requiresPermission: true</code>. Context providers,
        skills, memory, the working environment, a REPL and subagents have fields of
        their own (<code>contextProviders</code>, <code>skills</code>,{" "}
        <code>memory</code>, <code>workingEnvironment</code>, <code>repl</code>,{" "}
        <code>subagents</code>) or mount in <code>configure(agent, ctx)</code>. See{" "}
        <Link href="/foundry/docs/composition">defineAgent &amp; assembly</Link>.
      </p>

      <h2 id="identity">Identity: one definition, an instance per team</h2>
      <CodeBlock
        filename="scripts/onboard.ts"
        language="typescript"
        code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

const payments = await foundry.agent("release").create({ context: { team: "payments" } });
const thread = await foundry.createConversation(payments.id, { title: "2.4.0" });

const run = await foundry.send(payments.id, thread.id, "Draft notes for 2.4.0 and publish when ready.");
const done = await run.wait({ timeoutMs: 120_000 });`}
      />
      <p>
        An instance is data: its id, its context, the capabilities installed on it,
        its playbooks. Each has any number of conversations. Every run reloads the
        instance and assembles a fresh harness from the definition, the instance and
        the message, in its own process. That is also why the store in step 4 had to
        be durable: a <code>MemoryStore</code> would start every message empty.
      </p>

      <h2 id="time">Time: schedules, sleep, spawn</h2>
      <p>
        The Monday schedule above is reconciled into a durable activation for every
        instance and rebuilt on restart. Agents also get tools to make their own:{" "}
        <code>glove_foundry_schedule</code> (&quot;remind me Thursday&quot;),{" "}
        <code>glove_foundry_sleep</code> (&quot;check CI again in 20 minutes&quot;: the
        run suspends and the same conversation wakes later),{" "}
        <code>glove_foundry_schedules</code> to list, pause or cancel them, and{" "}
        <code>glove_foundry_spawn</code> to start another instance&apos;s run. No job
        queue, no cron.
      </p>

      <h2 id="oversight">Oversight: approvals that wait for a person</h2>
      <p>
        In step 2, <code>requiresPermission</code> showed a prompt in the browser. In
        Foundry the same flag pauses the run on an <strong>approval record</strong>{" "}
        with the exact tool input, which expires after five minutes by default and
        fails closed. Anyone you let in resolves it: in the inspector, over HTTP, or
        from code:
      </p>
      <CodeBlock
        filename="scripts/approve.ts"
        language="typescript"
        code={`const [pending] = await foundry.approvals({ runId: run.id, status: "pending" });
if (pending) await foundry.resolveApproval(pending.id, "approve");   // or "deny"`}
      />
      <p>
        If someone changes their mind mid-run, <code>run.steer(&quot;Hold 2.4.0, include
        #421 first&quot;)</code> interrupts the run cleanly and restarts it in the same
        conversation with the new instruction.
      </p>

      <h2 id="arrival">Arrival: Slack, email, webhooks</h2>
      <p>
        Inbound channels are <strong>transmissions</strong>: typed definitions of how
        events arrive (verify, normalise, classify) and how replies go out (an
        outbound transmission becomes a validated tool once installed). An{" "}
        <strong>application</strong> bundles them so an instance can install
        &quot;Slack&quot;. <strong>Playbooks</strong> route each event to the right
        instance and conversation, and a playbook subscription can create the
        instance on the first message. Delivery is idempotent per event. Credentials
        stay in adapters you own. The full walkthrough is{" "}
        <Link href="/foundry/docs/applications">apps &amp; transmissions</Link>; on
        Kuiper, <a href="https://kuiper.sh/docs/inbox/">email</a> arrives as a signed
        webhook to your unit.
      </p>

      <h2 id="access">Access: the APIs you didn&apos;t write</h2>
      <ul>
        <li><strong>Typed client</strong>, above: route names are checked against your agent files.</li>
        <li><strong>OpenAI-compatible</strong> <code>/v1/chat/completions</code> and <code>/v1/responses</code>: point any OpenAI SDK or chat UI at an instance; conversations stay durable.</li>
        <li><strong>Run API</strong> <code>/v1/runs</code> with live events, and REST over every record at <code>/api/*</code>.</li>
        <li><strong>Inspector and WebChat</strong> at <code>/</code>: every instance, conversation, run, model call, tool call and approval.</li>
      </ul>

      <h2 id="already-built">Already built for you</h2>
      <AlreadyBuilt parts={["identity", "time", "arrival", "oversight", "access"]} />

      <h2 id="next">Next</h2>
      <p>
        The release desk works on your machine, with its state in <code>.data/</code>.
        In <Link href="/docs/build/production">step 8</Link> it goes to production on
        Kuiper: the same folder, no Dockerfile, state on a persistent disk, models
        through a gateway, and its runs in the dashboard.
      </p>
      <StepPath href={HREF} />
    </article>
  );
}
