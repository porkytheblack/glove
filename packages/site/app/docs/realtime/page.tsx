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
        The session takes audio, typed text, images and camera frames, and
        answers in speech or text.
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          <strong>Which package?</strong> <code>glove-voice-s2s</code>{" "}
          (<a href="/docs/realtime-voice">Realtime Voice &amp; Avatars</a>) is
          the voice path that avatars, LiveKit rooms and Foundry&apos;s{" "}
          <code>voiceCall</code> build on. Use <code>glove-realtime</code> when
          the call should behave like the rest of the agent: gated tools ask
          before they run, the call is written to the store, goals and runtime
          context stay current. Also use it when you need camera, screen or
          text output.
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
          is enforced. The store&apos;s decision comes first. Otherwise the{" "}
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
          <strong>Runtime context and the inbox</strong> are injected on open,
          after tools, and when the user starts speaking. On OpenAI each
          snapshot replaces the last one. Resolved inbox items are announced
          once and consumed.
        </li>
        <li>
          <strong>Subscribers</strong> added with{" "}
          <code>session.addSubscriber()</code> get the same events a text turn
          emits.
        </li>
      </ul>

      <h3 id="goals">Goals, forms and other per-turn state</h3>

      <p>
        Goal and form tools work on a call, and their status snapshots reach
        the model through runtime context. One step doesn&apos;t carry over on
        its own: <code>useGoalRunner</code> prepares state before each{" "}
        <code>processRequest</code>. That covers preparation, resuming
        interrupted lifecycle hooks and re-applying <code>configure</code>. A
        realtime session never calls <code>processRequest</code>, so pass the
        runner&apos;s <code>refresh</code> as <code>beforeTurn</code>. It runs
        before the session opens and when each user turn starts. Any prompt or
        tool change it makes is sent to the provider.
      </p>

      <CodeBlock
        filename="goals.ts"
        language="typescript"
        code={`const goals = useGoalRunner(agent, goalAdapter, { scope, configure });
const session = new RealtimeSession({ agent, beforeTurn: goals.refresh });`}
      />

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
session.say("typed message from the chat box");
session.sendImage(pngBytes, "image/png");`}
      />

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
