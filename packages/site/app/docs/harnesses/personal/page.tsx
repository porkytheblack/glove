import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, SystemDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/personal");

export default function PersonalHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Personal agent</h1>
      <p className="blog-lede">
        A personal agent is the assistant you text: it remembers you, reminds you, reads and
        answers your email, browses for you and writes documents, often while you are asleep.
        Most of its weight sits in the system layer. It needs an identity per person, time
        (schedules and sleep), arrival (a chat channel that wakes it) and oversight (it asks
        before anything it cannot undo). Foundry provides all four; Kuiper provides the mailbox,
        the browser and somewhere to run.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Tools",
          "Permission gates",
          "Runtime context providers",
          "Pinned context",
          "Memory",
          "Browsers",
          "Kuiper browsers",
          "Subagents",
          "Definitions",
          "Instances",
          "Conversations",
          "Data adapters",
          "Schedules",
          "Sleep",
          "Schedule management",
          "Transmissions",
          "Applications and connections",
          "Approvals",
          "Inspector and WebChat",
          "Zero-config deploys",
          "Persistent disk",
          "Model gateway",
          "Kuiper inbox",
          "Secrets and variables",
          "Agent inspection",
        ]}
        write={[
          "The chat channel: a transmission and a connection (Telegram long polling, say)",
          "The system prompt and the memory schema: what is worth remembering about a person",
          "A browser adapter for your provider, if it browses",
          "Domain tools: calendar, notes, whatever your life runs on",
        ]}
      />

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        At 23:40 you text &ldquo;remind me to call the dentist when they open, and book the
        earliest slot if you can&rdquo;. The Telegram connection, which Foundry keeps running
        while an instance has the Telegram app installed and a playbook that uses it, hands the
        update to <code>context.receive</code>. The
        transmission authenticates and normalises it, the playbook routes it to your instance, and
        the chat id becomes the conversation&apos;s thread key, so the same chat always lands in the
        same conversation. With <code>awaitCompletion: true</code> the connection waits for the
        run to finish before it accepts your next message, so turns stay in order.
      </p>
      <p>
        The run assembles a fresh Glove from the definition, your instance and the message. The
        store reloads the conversation from <code>/data</code>, pinned context tells the model
        your timezone and preferences, and memory tools let it look up which dentist you mean. It
        calls <code>glove_foundry_sleep</code> until 08:30 and the run ends. At 08:30 the same
        instance wakes in the same conversation with the resolution message. It opens the clinic&apos;s
        booking page through the browser, finds a slot, and calls the booking tool, which is
        permission-gated. Foundry turns that into an approval record; you approve it from the
        inspector or from a button your channel renders, and the booking goes through. The reply
        goes back to Telegram through the transmission&apos;s outbound tool.
      </p>
      <SystemDiagram caption="A personal agent is woken three ways: a message through the Telegram transmission, a schedule or sleep wake-up, or a client call. Each wake-up is a run on your instance, and the irreversible steps pause on an approval." />

      <h2 id="skeleton">Skeleton</h2>
      <p>The agent folder. Each file is one definition and its filename is its id:</p>
      <CodeBlock
        filename="agents/assistant/"
        language="text"
        code={`agent.ts                          the agent: model, prompt, store, memory, tools, schedules
composition.ts                    composeAgent(telegram app, memory)
apps/telegram.app.ts              defineApp({ inbound: [telegram], outbound: [telegram], connections: [poller] })
transmissions/telegram.transmission.ts   updates in, messages out (see Apps & transmissions)
connections/telegram.connection.ts       long polling, supervised by Foundry
memory/assistant.memory.ts        entity, episodic, resources and pinned context, on SQLite`}
      />
      <CodeBlock
        filename="agents/assistant/agent.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineSchedule } from "glove-foundry";
import { mountBrowser } from "glove-execution";
import { Inbox } from "@kuiper-sh/inbox";
import { inboxTools } from "@kuiper-sh/inbox/glove";
import { FileStore } from "../../lib/file-store.js"; // the starter's durable transcript store
import { components } from "./composition.js";
import assistantMemory from "./memory/assistant.memory.js";

// With no apiKey, Kuiper's SDK reads KUIPER_GATEWAY_KEY.
const inbox = new Inbox({ gatewayUrl: process.env.INBOX_URL }); // \${{inbox.BASE_URL}} on Kuiper

const morningBrief = defineSchedule({
  name: "morning-brief",
  description: "A short brief every morning",
  timing: { kind: "cron", expression: "0 7 * * *", timezone: "Europe/London" },
  message: "Write the morning brief: unanswered email, today's reminders, anything you are waiting on.",
});

export default defineAgent({
  description: "A personal assistant that works while its owner doesn't",
  components,
  memory: [assistantMemory],
  model: () =>
    createAdapter({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      baseURL: process.env.ANTHROPIC_BASE_URL, // \${{models.ANTHROPIC_BASE_URL}} on Kuiper
      apiKey: process.env.KUIPER_GATEWAY_KEY,  // \${{models.API_KEY}}
    }),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: [
    "You are a personal assistant. Be brief; this is a phone.",
    "For reminders and recurring work use glove_foundry_schedule; to wait until a time, glove_foundry_sleep.",
    "Look people and past events up in memory before asking.",
  ].join("\\n"),
  schedules: [morningBrief],
  // The mailbox's tools, with sending gated: Foundry turns the gate into an approval.
  tools: () =>
    inboxTools(inbox, { mailbox: "assistant" }).map((tool) =>
      tool.name === "send_email" ? { ...tool, requiresPermission: true } : tool,
    ),
  async configure(agent, context) {
    // Your code: a BrowserAdapter for your provider, for example stationBrowserClient(...)
    // against the managed Station, as examples/foundry-operator does.
    const adapter = await createBrowserAdapter(context.agentId);
    let close = () => adapter.close();
    context.onCleanup(() => close());
    const browser = mountBrowser(agent, { adapter });
    close = () => browser.close();
  },
});`}
      />
      <CodeBlock
        filename="agents/assistant/connections/telegram.connection.ts"
        language="typescript"
        code={`import { Effect } from "effect";
import { defineConnection } from "glove-foundry";
import telegram from "../transmissions/telegram.transmission.js";

export default defineConnection({
  description: "Long-polls Telegram for messages to the bot",
  transmissions: [telegram],
  connect: (context) =>
    Effect.gen(function* () {
      yield* context.ready();
      let offset = 0;
      while (!context.signal.aborted) {
        // Your code: Telegram's getUpdates, with the bot token from your account-session adapter.
        const updates = yield* Effect.tryPromise(() => getUpdates(offset, context.signal));
        for (const update of updates) {
          offset = update.update_id + 1;
          yield* context.receive({
            route: context.routes[0]!,
            eventId: String(update.update_id), // a redelivered update never runs twice
            threadKey: String(update.message.chat.id), // one conversation per chat
            awaitCompletion: true, // one turn at a time per chat
            raw: update,
          });
        }
      }
    }),
});`}
      />
      <CodeBlock
        filename="agents/assistant/memory/assistant.memory.ts"
        language="typescript"
        code={`import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";

// One namespace per instance, so memory spans all of a person's conversations.
const forInstance = (ctx: { workspaceId: string; agentId: string }) =>
  createSqliteMemoryAdapters({
    file: "/data/memory.sqlite",
    namespace: JSON.stringify([ctx.workspaceId, ctx.agentId]),
    schema: new MemorySchema(), // define node classes and episode kinds for your domain
  });

export default defineMemory({
  description: "Pinned preferences, people, past events and notes",
  context: { adapter: (ctx) => Effect.sync(() => forInstance(ctx).context) },
  entity: { access: "curator", adapter: (ctx) => Effect.sync(() => forInstance(ctx).entity) },
  episodic: { access: "curator", adapter: (ctx) => Effect.sync(() => forInstance(ctx).episodic) },
  resources: { access: "curator", adapter: (ctx) => Effect.sync(() => forInstance(ctx).resources) },
});`}
      />
      <p>
        Create one instance per person, with that person&apos;s chat id in its context and the
        Telegram app installed (<code>client.agent(&quot;assistant&quot;).create(...)</code> or{" "}
        <code>defineAgentInstance</code>). The transmission itself follows the ticket example in{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>, and{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-operator">
          examples/foundry-operator
        </a>{" "}
        shows the browser, sandbox and memory wiring end to end.
      </p>

      <h2 id="layers">Grow it into layers</h2>
      <p>
        Once the assistant writes code, browses and drafts documents, one agent doing it all
        gets slow and loses track of the person. Split it. Keep this agent as the interactor:
        fast model, personal memory, the chat channel and calls. Move the heavy work to other
        agents in the person&apos;s workspace: a coder with a sandbox, a browser agent, a
        researcher. With <code>mesh: true</code> the interactor messages them by instance id
        over <Link href="/foundry/docs/multi-agent#mesh">the mesh</Link>. Their replies come
        back to the conversation that asked, and when they need to know something they ask
        the interactor, which answers from memory or asks the person. See{" "}
        <Link href="/foundry/docs/layered-agents">Layered agents</Link> and the runnable{" "}
        <code>examples/foundry-layered-assistant</code>.
      </p>

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>A reminders table and a cron job that calls your agent.</strong>{" "}
          <Link href="/foundry/docs/automation#schedules">Schedules</Link> and{" "}
          <code>glove_foundry_schedule</code> store the activation durably and rebuild it on
          restart; <Link href="/foundry/docs/automation#core-tools"><code>glove_foundry_schedules</code></Link>{" "}
          lets the agent list, pause and cancel its own.
        </li>
        <li>
          <strong>&ldquo;Check back later&rdquo; state.</strong>{" "}
          <code>glove_foundry_sleep</code> ends the run and wakes the same instance and
          conversation at the time you asked for.
        </li>
        <li>
          <strong>A users-to-agents table.</strong>{" "}
          <Link href="/foundry/docs/definitions-and-instances">Instances</Link> are that table, with
          their own context, installations and conversations.
        </li>
        <li>
          <strong>A polling loop you keep alive yourself.</strong>{" "}
          <Link href="/foundry/docs/applications#connections">Connections</Link> start when an
          instance needs them, retry, and report their status in the inspector.
        </li>
        <li>
          <strong>An approvals table.</strong> A permission-gated tool in Foundry becomes an{" "}
          <Link href="/foundry/docs/approvals">expiring, fail-closed approval record</Link> with the
          exact input.
        </li>
        <li>
          <strong>A vector store and a &ldquo;remember&rdquo; tool.</strong>{" "}
          <Link href="/docs/memory">glove-memory</Link> keeps people, events and notes with
          provenance, and pinned context reaches every turn without growing the prompt.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <ol>
        <li>
          <code>kuiper units create assistant</code>, then{" "}
          <code>kuiper deploy --source . -u assistant --wait</code>. Kuiper detects Foundry and
          starts <code>glove foundry start --host 0.0.0.0 --port 4141</code>; no Dockerfile.
        </li>
        <li>
          Add a <code>requestAuthorization</code> adapter to <code>foundry.application.ts</code>.
          Foundry refuses a public bind without one; see{" "}
          <a href="https://kuiper.sh/docs/foundry/#add-an-authorizer">Glove Foundry units</a>.
        </li>
        <li>
          Persist everything on the unit&apos;s volume: <code>FileFoundryDataAdapter</code> at{" "}
          <code>/data/foundry.json</code>, transcripts and memory under <code>/data</code>. A unit
          with a volume runs one replica, which is what a single-host data adapter needs.
        </li>
        <li>
          Make the mailbox (<code>kuiper inbox create assistant</code>) and wire the gateway in:{" "}
          <code>&apos;KUIPER_GATEWAY_KEY=${"{{"}models.API_KEY{"}}"}&apos;</code>,{" "}
          <code>&apos;ANTHROPIC_BASE_URL=${"{{"}models.ANTHROPIC_BASE_URL{"}}"}&apos;</code>,{" "}
          <code>&apos;INBOX_URL=${"{{"}inbox.BASE_URL{"}}"}&apos;</code>. A unit gets one gateway key
          for every service its variables reference.
        </li>
        <li>
          Store the bot token as a secret (<code>kuiper secrets set TELEGRAM_BOT_TOKEN=-</code>) and
          bind it with <code>${"{{"}secrets.TELEGRAM_BOT_TOKEN{"}}"}</code>; your account-session
          adapter reads it, never the model.
        </li>
        <li>
          For a browser, use Kuiper&apos;s: it speaks Steel&apos;s API, and the unit gets{" "}
          <code>${"{{"}browsers.BASE_URL{"}}"}</code> and <code>${"{{"}browsers.API_KEY{"}}"}</code>.
          Sessions are metered by the second and held to your budgets.
        </li>
      </ol>
      <p>
        Long waits belong in <code>glove_foundry_sleep</code>: runs time out after five minutes.
        The unit&apos;s Inspect card shows every run, conversation and pending approval. Full
        walkthrough: <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-operator">
            examples/foundry-operator
          </a>
          : a personal agent with a persistent browser profile, coding sandboxes and memory on one
          managed Station. Walkthrough: <Link href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox agent</Link>.
        </li>
        <li>
          Kuiper&apos;s <a href="https://kuiper.sh/docs/email-agent/">email agent example</a>: a
          unit, a mailbox, its webhook and the model gateway, step by step.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/state">make it remember</Link>,{" "}
          <Link href="/docs/build/system">make it a system</Link>,{" "}
          <Link href="/docs/build/production">put it in production</Link>.
        </li>
        <li>
          Reference: <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>,{" "}
          <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>,{" "}
          <Link href="/docs/memory">Memory</Link>, <Link href="/foundry/docs/approvals">Approvals</Link>.
        </li>
      </ul>
    </article>
  );
}
