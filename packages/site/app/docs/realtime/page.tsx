import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Realtime Agents",
  description:
    "Run a Glove agent on OpenAI Realtime, Gemini Live or GPT-Live with its tools, permissions, store, context and goals intact.",
};

export default function RealtimePage() {
  return (
    <div className="docs-content">
      <h1>Realtime Agents</h1>

      <p>
        <code>glove-realtime</code> runs a built Glove agent on a realtime
        multimodal model: OpenAI Realtime, Gemini Live or GPT-Live. The agent
        is authored as usual. Its tools, permission gates, store, context
        providers, inbox, goals and subscribers all work on the live session.
        Depending on the provider, the session takes audio, typed text, images
        and camera frames, and answers in speech or text. GPT-Live accepts
        audio and typed text and produces audio.
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          <strong>Start new realtime agents with glove-realtime</strong>,
          including voice-only agents. <code>glove-voice-s2s</code>{" "}
          (<a href="/docs/realtime-voice">Realtime Voice &amp; Avatars</a>) is
          the voice path that avatars, LiveKit rooms and Foundry&apos;s{" "}
          <code>voiceCall</code> build on. Use <code>glove-realtime</code> when
          the call should behave like the rest of the agent: gated tools ask
          before they run, the call is written to the store, goals and runtime
          context stay current. Also use it when you need camera, screen or
          text output. These are independent runtimes: the older package is
          not an audio layer beneath the new one, and similarly named adapters
          are not interchangeable.
        </p>
      </div>

      <CodeBlock filename="terminal" language="bash" code={`pnpm add glove-realtime`} />

      <CodeBlock
        filename="agent.ts"
        language="typescript"
        code={`import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { RealtimeSession, realtimeModel } from "glove-realtime";

const agent = new Glove({
  model: realtimeModel({ provider: "gemini", voice: "Puck" }),   // or "openai", "openai-live"
  store: new MemoryStore("call-42"),
  displayManager: new Displaymanager(),
  systemPrompt: "You are Nova, a support agent. Speak briefly.",
  compaction_config: { compaction_instructions: "Summarize the call." },
})
  .fold(lookupOrder)
  .fold(refund)                       // requiresPermission: true, enforced on the call
  .build();

const session = new RealtimeSession({
  agent,
  compaction: { contextLimit: 24_000 },
  permissions: async ({ tool, input }) => confirmWithSupervisor(tool, input),
});

session.on("audio", (pcm, format) => speaker.play(pcm, format.sampleRate));
session.on("interrupted", () => speaker.flush());
await session.start();

mic.on("pcm", (pcm) => session.sendAudio(pcm));      // in session.adapter.inputFormat
camera.on("frame", (jpeg) => session.sendVideoFrame(jpeg));`}
      />

      {/* ============================================================ */}
      <h2 id="split">Who owns what</h2>

      <p>
        A realtime model keeps part of the agent on its own side of the socket.
        It holds the conversation, decides what a tool schema may contain, and
        manages its own context window. The providers disagree on every one of
        those: OpenAI can delete conversation items, Gemini can only append and
        must reconnect to change its tools, and GPT-Live has no history at all.
        So the adapter owns the provider&apos;s half and the session owns
        Glove&apos;s half.
      </p>

      <table>
        <thead>
          <tr>
            <th>Concern</th>
            <th>Adapter</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tools</td>
            <td>Registration: schema projection; patched live or by reconnecting</td>
            <td>Which tools are exposed; runs each call through the Executor; re-registers when the set changes</td>
          </tr>
          <tr>
            <td>Synthetic prompts</td>
            <td>How text enters: system item, open client turn, or append; keyed injections replace earlier ones where possible</td>
            <td>What enters and when: runtime context, the inbox, your relays</td>
          </tr>
          <tr>
            <td>Compaction</td>
            <td>How a summary is applied: in place or by reconnecting; the model summarises itself where it can</td>
            <td>When to compact, and writing the summary to the store</td>
          </tr>
          <tr>
            <td>Session</td>
            <td>Opening with history or a resumption handle; reporting drops and <code>goAway</code></td>
            <td>Reconnect, resume or re-seed, the move before <code>goAway</code>, max duration</td>
          </tr>
        </tbody>
      </table>

      <p>
        Adapters declare <code>capabilities</code> and report through one
        event stream (<code>RealtimeEvent</code>), so nothing on the session
        side switches on the provider.
      </p>

      <h2 id="providers">Providers</h2>

      <table>
        <thead>
          <tr>
            <th></th>
            <th>OpenAI Realtime</th>
            <th>Gemini Live</th>
            <th>GPT-Live</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Input</td><td>audio, text, image</td><td>audio, text, image, video</td><td>audio, text</td></tr>
          <tr><td>Output</td><td>audio or text</td><td>audio or text</td><td>audio</td></tr>
          <tr><td>Tool changes</td><td>live</td><td>reconnect with resumption handle</td><td>live (backend tools)</td></tr>
          <tr><td>Compaction</td><td>in place, self-summarised</td><td>reconnect seeded with summary</td><td>provider-managed only</td></tr>
          <tr><td>Resumption</td><td>—</td><td>handles and <code>goAway</code></td><td>—</td></tr>
          <tr><td>Runs in</td><td>Node 22+, browser (ephemeral token)</td><td>Node 22+, browser</td><td>server only</td></tr>
        </tbody>
      </table>

      <p>
        <code>createRealtimeAdapter(args)</code> resolves explicit arguments
        first, then <code>REALTIME_PROVIDER</code>, <code>REALTIME_MODEL</code>,{" "}
        <code>REALTIME_VOICE</code> and the provider&apos;s API key. It fails
        when the adapter is built if the key is missing.
      </p>

      {/* ============================================================ */}
      <h2 id="primitives">Glove primitives on a live session</h2>

      <ul>
        <li>
          <strong>Tools</strong> run through glove-core&apos;s Executor:
          validation, summaries, subagent events, <code>tool_use_result</code>.
          Every outcome reaches the provider, refusals and errors included.{" "}
          <code>renderData</code> never does. Retries default to 0, because a
          retry on a call is silence. If a tool folds new tools or changes the
          system prompt, the provider hears about it before the result goes
          back.
        </li>
        <li>
          <strong>
            <code>requiresPermission</code>
          </strong>{" "}
          is enforced, async predicates included. The store&apos;s decision comes first. Otherwise the{" "}
          <code>permissions</code> policy decides: <code>&quot;display&quot;</code>{" "}
          (the display stack&apos;s <code>permission_request</code>),{" "}
          <code>&quot;deny&quot;</code>, <code>&quot;allow&quot;</code>, or a
          function. The default is <code>&quot;deny&quot;</code> for a{" "}
          <code>serverMode</code> agent.
        </li>
        <li>
          <strong>The store</strong> gets each turn, each tool call together
          with its result, and compaction summaries. A fresh provider session
          is seeded from it, so text turns and calls share one history.
        </li>
        <li>
          <strong>Runtime context</strong> follows each provider&apos;s{" "}
          <a href="/docs/build/context">delivery</a>.{" "}
          <code>&quot;iteration&quot;</code> context is read on open, after
          tools and when the user starts speaking.{" "}
          <code>&quot;request&quot;</code> context is read on open and when
          the user starts speaking, and is frozen in between. On OpenAI each
          snapshot replaces the last one. <code>&quot;history&quot;</code>{" "}
          context is saved to the store when it changes and told to the call
          once. Resolved inbox items are announced once and consumed.
        </li>
        <li>
          <strong>Events</strong> (<code>agent.emitEvent</code>, Foundry
          delegation updates) join the call. The session holds the
          agent&apos;s turn queue, so they never wake the text model. An event
          goes in silently at the next user turn or tool result. If nobody is
          talking when it arrives, the session requests a spoken response at
          a quiet pause; the provider decides what to say. Each
          event is saved to the store once. While the call runs,{" "}
          <code>processRequest</code> on the same agent waits.{" "}
          <code>events: false</code> leaves events to the agent&apos;s policy.
        </li>
        <li>
          <strong>Subscribers</strong> on the agent (<code>agent.addSubscriber</code>)
          get the same events from the call that a text turn emits, through{" "}
          <code>notifySubscribers</code>. <code>session.addSubscriber()</code>{" "}
          adds one that only hears this session.
        </li>
      </ul>

      <h3 id="goals">Goals, forms and other per-turn state</h3>

      <p>
        Goals and forms work on a call with nothing extra to wire. Their tools
        are on the call, and their status reaches the model through runtime
        context. Their per-turn preparation (preparing state, resuming
        interrupted lifecycle hooks, re-applying <code>configure</code>) is
        registered with glove-core&apos;s{" "}
        <a href="/docs/build/context#turn-preparers">
          <code>addTurnPreparer</code>
        </a>
        . The session runs it before it opens and when each user turn starts.
        Any prompt or tool change it makes is sent to the provider.
      </p>

      <CodeBlock
        filename="goals.ts"
        language="typescript"
        code={`useGoalRunner(agent, goalAdapter, { scope, configure });
const session = new RealtimeSession({ agent });   // goals prepare on every turn

// Per-turn work that isn't registered on the agent:
new RealtimeSession({ agent, beforeTurn: () => syncCrm(callerId) });`}
      />

      <h3 id="sales-demo">A goal-driven sales conversation</h3>
      <p>
        Goals can guide what the agent asks and does next. In the runnable
        sales demo, the agent opens the conversation, discovers the prospect&apos;s
        workflow, appointment volume and pain points, consults product tools,
        recommends a fit, and agrees on a next step. It records progress through
        the real <code>glove_goal_status</code> and <code>glove_goal_update</code>
        tools, with version checks. A refusal is a valid outcome.
      </p>
      <CodeBlock filename="sales-goals.ts" language="typescript" code={`const { runner } = useGoalRunner(agent, goalAdapter, {
  scope: { subject: "demo-prospect", key: "sales-discovery" },
  delivery: "history",
  tools: { allow: ["status", "update", "history"] },
});
await runner.start(salesProgram); // discover needs → recommend a fit → agree a next step
const call = new RealtimeSession({ agent });
await call.start();
call.respond("Introduce yourself and ask the first discovery question.");

// A product update arrives while the same call is running:
await agent.emitEvent({
  id: "pilot-offer:1", source: "product-catalog",
  content: "Growth now costs 39 USD per month instead of 49 USD.",
});`} />
      <p>
        With <code>delivery: &quot;history&quot;</code>, a changed goal snapshot is
        saved before the next user turn. Progress within a turn reaches the
        model through tool results. Events are saved once and enter the live
        session at a user/tool boundary or a quiet pause. On GPT-Live, context
        appends reach the voice model; backend goal tools read authoritative
        Glove state. Appends do not remove older provider context.
      </p>
      <p>
        <a href="https://github.com/porkytheblack/glove/tree/main/packages/glove-realtime/examples/live-goals">
          Full runnable demo and source
        </a>: browser audio, typed input, tool activity, stored goal snapshots,
        spontaneous offer updates and a real-provider verification script.
        The fictional sales call does not dial a phone number or schedule a
        meeting. In-memory adapters preserve progress across provider reconnects,
        but durable adapters are needed across server restarts.
      </p>
      <CodeBlock filename="terminal" language="bash" code={`# From this repository, with OPENAI_API_KEY in ignored .env.local:
pnpm --filter glove-realtime... build
pnpm --filter glove-realtime demo:live
# Optional real-provider test (uses API credits):
pnpm --filter glove-realtime test:live`} />

      {/* ============================================================ */}
      <h2 id="lifecycle">Session lifecycle</h2>

      <CodeBlock
        filename="lifecycle.ts"
        language="typescript"
        code={`session.on("state", (state) => hud.show(state));   // connecting → open ⇄ reconnecting → closed
session.on("resumable", (handle) => saveHandle(callId, handle));
await session.start({ resumeHandle: loadHandle(callId) });`}
      />

      <ul>
        <li>
          A dropped session is retried with backoff. The first attempt resumes
          with the latest handle. Later attempts open a fresh session seeded
          from the store.
        </li>
        <li>
          On Gemini&apos;s <code>goAway</code>, the session moves to a resumed
          connection before the provider ends the current one.
        </li>
        <li>
          With <code>compaction.contextLimit</code>, the session compacts when
          the provider reports a larger context. OpenAI writes the summary
          itself, out of band. Otherwise <code>compaction.model</code> writes
          it, or the transcript is used.
        </li>
      </ul>

      <h2 id="prompts">Synthetic prompts and media</h2>

      <CodeBlock
        filename="inject.ts"
        language="typescript"
        code={`session.inject({ kind: "user", text: "The warranty check came back: covered until 2031." }); // spoken about
session.inject({ kind: "context", text: "Caller is a VIP." });                                // silent
session.respond("Greet the caller in one short sentence.");
await session.say("typed message from the chat box");
session.sendImage(pngBytes, "image/png");`}
      />

      <h2 id="gpt-live">GPT-Live host integration</h2>

      <p>
        Select <code>provider: &quot;openai-live&quot;</code> and{" "}
        <code>model: &quot;gpt-live-1&quot;</code> on the server. Feed continuous,
        paced PCM, including silence. GPT-Live emits continuous transcript
        fragments; the host supplies speech boundaries and playback state.
      </p>
      <CodeBlock
        filename="live-host.ts"
        language="typescript"
        code={`// Connect these to local VAD or application speech boundaries.
await session.notifyUserSpeech(true);  // prepare goals and request/history context
await session.notifyUserSpeech(false);
session.notifyPlayback(true);          // actual audio playback starts
session.notifyPlayback(false);         // playback queue drains
session.on("transcript", ({ role, text, startMs, endMs }) => {
  // Keep both speakers' fragments and timestamps: speech may overlap.
});
session.interrupt();                   // flush playback on the interrupted event
session.resumeOutput();                // allow output again
await session.stop();                  // wait for final cumulative usage`}
      />
      <p>
        Input notifications refresh context and control when queued events
        reach the call. They do not commit audio or cancel backend work.
        Transcript packet gaps do not establish a speech boundary. Typed
        messages also run preparation and refresh context before sending.
        Startup waits for the agent&apos;s turn queue; concurrent stops wait
        for the same finalization, and failures reject after cleanup.
      </p>

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/realtime-voice">Realtime Voice &amp; Avatars</a>: the
          voice-only S2S path, avatars and LiveKit
        </li>
        <li>
          <a href="/docs/goals">Goals</a>: obligations with versioned
          progress
        </li>
        <li>
          <a href="/docs/voice-architectures">Voice agent architectures</a>
        </li>
      </ul>
    </div>
  );
}
