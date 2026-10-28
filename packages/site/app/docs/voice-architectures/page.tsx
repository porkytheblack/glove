import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/voice-architectures");

const GH = "https://github.com/porkytheblack/glove/tree/main/examples";

export default function VoiceArchitecturesPage() {
  return (
    <div className="docs-content">
      <h1>Voice agent architectures</h1>

      <p className="blog-lede">
        A Glove voice agent is one agent or two, and the part that talks is
        either a cascaded pipeline (STT → text model → TTS) or a
        speech-to-speech realtime model. That gives four shapes. This page
        compares them, explains why you would split an agent in two, and shows
        the wiring for both layered shapes, including <code>&lt;speech&gt;</code>{" "}
        tags and fast front models.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="shapes">The four shapes</h2>

      <ol>
        <li><strong>Single-agent pipeline.</strong> VAD → STT → agent → TTS. <code>GloveVoice</code> (<code>glove-voice</code>) or <code>useGloveVoice</code> (<code>glove-react/voice</code>). See <Link href="/docs/voice">Voice pipeline</Link>.</li>
        <li><strong>Single-agent realtime.</strong> A speech-to-speech (S2S) model hears the caller, speaks, and calls the agent&apos;s tools. <code>RealtimeAgent</code> + <code>s2sDrivenModel</code> (<code>glove-voice-s2s</code>), or <code>RealtimeSession</code> + <code>realtimeModel</code> (<code>glove-realtime</code>) when the call should keep the agent&apos;s permissions, store, goals and context, or take camera and screen input. See <Link href="/docs/realtime-voice#which-package">Realtime voice</Link> and <Link href="/docs/realtime">Realtime agents</Link>.</li>
        <li><strong>Layered, realtime front.</strong> An S2S front agent stays in the conversation and delegates real work to a text worker.</li>
        <li><strong>Layered, pipeline front.</strong> STT → a fast text front agent → TTS. The front delegates to a heavy worker over <Link href="/docs/mesh">glove-mesh</Link>.</li>
      </ol>

      <table>
        <thead>
          <tr><th></th><th>Single-agent pipeline</th><th>Single-agent realtime</th><th>Layered, realtime front</th><th>Layered, pipeline front</th></tr>
        </thead>
        <tbody>
          <tr><td>Latency to first sound</td><td>Cascade: about 1.3–1.6 s. Text reaches TTS a sentence at a time; a tool call before any text adds its full duration</td><td>500–800 ms for S2S APIs. A slow tool is dead air: the provider waits for its result</td><td>Front at S2S speed; the worker&apos;s answer is a second spoken turn later</td><td>0.9–1.3 s typical (layered-voice); ~1.5 s on a live server-voice room. Delegated answers arrive in a relay turn</td></tr>
          <tr><td>Voice quality and control</td><td>Any <code>TTSAdapter</code> (ElevenLabs built in). Everything the model writes is spoken</td><td>The provider&apos;s voices (<code>marin</code> on OpenAI). Words and audio come from one model</td><td>Same as single-agent realtime</td><td>Any TTS. <code>&lt;speech&gt;</code> tags decide exactly what is spoken</td></tr>
          <tr><td>Models</td><td>Any glove-core model, which must be fast and capable at once</td><td>S2S providers: <code>openai</code>, <code>openai-webrtc</code>, <code>openai-live</code>, <code>gemini</code></td><td>Front: an S2S provider. Worker: any glove-core model</td><td>Front: a fast streaming text model. Worker: any heavy model</td></tr>
          <tr><td>Tool-heavy work</td><td>Runs inside the spoken turn; the caller waits</td><td>Runs through <code>Tool.run</code> with no Executor: <code>requiresPermission</code> is not enforced, <code>pushAndWait</code> throws</td><td>Delegated; the front keeps talking; the result is injected with <code>rt.inject(…, &#123; respond: true &#125;)</code></td><td>Delegated; the front&apos;s turn ends after a spoken acknowledgement; a relay turn speaks the result</td></tr>
          <tr><td>Interruptions</td><td>Built in: VAD barge-in calls <code>interrupt()</code></td><td>Provider-native; the OpenAI WebSocket adapter truncates context to what was heard</td><td>Provider-native; the worker keeps running</td><td>You build it; the front is told what was heard via <code>&lt;user-interruption&gt;</code></td></tr>
          <tr><td>Cost and complexity</td><td>Least code: one hook</td><td>Little code; the whole call runs on a realtime model</td><td>Two agents, a mesh and <code>inject</code>; the heavy model runs only for delegated work</td><td>Most code (STT, endpointing, TTS streaming, a parser, a relay queue); a cheap front on every turn</td></tr>
          <tr><td>Reference example</td><td><code>coffee</code>, <code>lola</code></td><td><code>s2s-agent</code></td><td><code>s2s-rooms</code>, <code>layered-voice</code> <code>/s2s</code>, <code>foundry-braind-storm</code></td><td><code>layered-voice</code>, <code>server-voice</code></td></tr>
        </tbody>
      </table>

      <p>Latency figures are the examples&apos; own claims and measurements; see <a href="#latency">Latency budgets</a>.</p>

      <h3 id="choosing">How to choose</h3>
      <ul>
        <li><strong>Start with the single-agent pipeline</strong> when tools are quick and a second before the answer is fine. It is one hook.</li>
        <li><strong>Use single-agent realtime</strong> when tools are fast and the provider&apos;s voice and turn-taking are good enough. You give up control of the exact words for latency. Run it on <code>glove-realtime</code> when gated tools must still ask, the call must land in the store, or goals and forms drive the conversation.</li>
        <li><strong>Layer</strong> as soon as a turn needs multi-step tool work such as lookups, research or bookings. The caller hears an acknowledgement at once and the answer when it is ready.</li>
        <li><strong>Pick a realtime front</strong> for the lowest latency and provider barge-in with the least code. <strong>Pick a pipeline front</strong> for your own TTS voice, control over exactly what is said, a free choice of front model, and a metric for every leg of latency.</li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2 id="why-layer">Why layer at all</h2>

      <p>
        One model cannot be both fast enough to hold a conversation and capable
        enough for multi-step tool work. From{" "}
        <Link href="/blog/building-the-voice-stack">Building the voice stack</Link>:
        realtime models &ldquo;are tuned for conversational latency, not for
        reasoning over a database, and the moment one is asked to do both it
        either stalls mid-sentence or invents an answer confidently.&rdquo; Text
        models that reason well think for seconds before their first token,
        which is dead air on a call. So split the jobs:
      </p>

      <ul>
        <li><strong>The front agent owns the conversation.</strong> It hears every line, decides whether and what to say, acknowledges requests at once, relays results, and says it is still checking while work is pending. It has almost no tools.</li>
        <li><strong>The worker owns the work.</strong> Full tool surface, heavy model, never speaks to the caller. It replies to the front with <code>in_reply_to</code> set and never just acknowledges: an acknowledgement would resolve the front&apos;s pending item before any answer exists.</li>
        <li><strong>Cost follows the split.</strong> The cheap front runs on every turn; the heavy model only on delegated turns.</li>
      </ul>

      <h3 id="delegation">Delegation mechanics</h3>

      <table>
        <thead>
          <tr><th>Step</th><th>Pipeline front (layered-voice)</th><th>Realtime front, mesh (s2s-rooms)</th><th>Realtime front, tool (layered-voice /s2s)</th></tr>
        </thead>
        <tbody>
          <tr><td>Dispatch</td><td>The front calls <code>glove_mesh_send_message(&#123; to: &quot;worker&quot;, blocking: true, content &#125;)</code></td><td>The same tool, called by the S2S model through <code>RealtimeAgent</code></td><td>The model calls a <code>delegate_to_worker</code> function tool; the page POSTs <code>&#123; request &#125;</code> to <code>/api/s2s/delegate</code></td></tr>
          <tr><td><code>blocking: true</code></td><td colSpan={2}>Adds a pending <code>mesh:waiting:&lt;message id&gt;</code> item to the front&apos;s inbox and returns at once. It does not wait for the worker</td><td>No mesh. The function call stays open until the worker returns</td></tr>
          <tr><td>Acknowledgement</td><td>A <code>&lt;speech&gt;</code> ack in the same turn; then the front&apos;s turn ends</td><td>Spoken &ldquo;in the same breath&rdquo; as the tool call</td><td>Spoken while the call is open</td></tr>
          <tr><td>Worker run</td><td>The orchestrator runs <code>worker.processRequest(…)</code> on its own queue for new <code>mesh:from:*</code> items in the worker&apos;s inbox</td><td>A <code>research</code> station signal in its own process</td><td>The route runs <code>worker.processRequest(…)</code> and returns the worker&apos;s final message text</td></tr>
          <tr><td>Result</td><td>The reply resolves the front&apos;s pending item and lands as a resolved inbox item; a relay turn framed <code>&lt;worker-result&gt;</code> speaks it, with the findings injected as <code>[Inbox: N item(s) resolved]</code></td><td>The reply POSTs to the room&apos;s <code>/mesh</code>; the room calls <code>rt.inject(`&lt;worker-result&gt;…&lt;/worker-result&gt;`, &#123; respond: true &#125;)</code></td><td><code>adapter.sendToolResult(callId, result)</code>; the model speaks it</td></tr>
          <tr><td>While waiting</td><td>Glove adds <code>[Inbox: N blocking item(s) still pending …]</code> to each front turn, so the front says it is still checking</td><td><code>RealtimeAgent</code> does not run Glove&apos;s loop, so there is no reminder; a prompt rule does that job. <code>RealtimeSession</code> (<code>glove-realtime</code>) puts pending blocking items in the call&apos;s context snapshot</td><td>The open tool call</td></tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2 id="realtime-front">Layered with a realtime front</h2>

      <p>
        The S2S model is the front agent: persona, turn-taking, barge-in and
        voice in one model. The front is a plain Glove whose model slot carries
        the realtime config, and <code>RealtimeAgent</code> exposes its tools,
        including the mesh send that <code>mountMesh</code> folds on.
      </p>

      <h3 id="realtime-front-mesh">Delegate over the mesh (s2s-rooms)</h3>

      <p>
        In <code>examples/s2s-rooms</code>, <code>buildS2SFrontAgent</code>{" "}
        (<code>lib/s2s-front-agent.ts</code>) builds the front with{" "}
        <code>s2sDrivenModel(&#123; label: &quot;s2s-front&quot;, ...s2s &#125;)</code>.
        The room signal calls <code>mountMesh(front, &#123; adapter, identity &#125;)</code>,
        starts <code>new RealtimeAgent(&#123; agent: front, excludeTools: [&quot;glove_mesh_broadcast&quot;, &quot;glove_mesh_acknowledge&quot;] &#125;)</code>,
        and when the worker&apos;s reply reaches its <code>/mesh</code> endpoint
        calls <code>rt.inject(`&lt;worker-result&gt;$&#123;message.content&#125;&lt;/worker-result&gt;`, &#123; respond: true &#125;)</code>.
        There the worker runs as a separate <code>research</code> signal. The
        same wiring with both agents in one process (<code>agents.ts</code> is
        in <a href="#fast-front">Fast models for the front</a>):
      </p>

      <CodeBlock filename="realtime-front.ts" language="typescript" code={`import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";
import { RealtimeAgent, s2sDrivenModel } from "glove-voice-s2s";
import { buildAgent, workerModel } from "./agents";

const FRONT_PROMPT = \`You are Nova. You cannot look anything up. For any lookup, call glove_mesh_send_message
(to: "worker", blocking: true, content: the request, standing on its own) and in the same breath say a
short acknowledgement. The tool returns as soon as the request is dispatched; that does NOT mean the
answer is ready. Relay <worker-result> messages out loud. Never invent a number.\`;
const WORKER_PROMPT = \`Research requests from "front" with your tools, then reply ONCE with
glove_mesh_send_message (to "front", in_reply_to the message id). Never just acknowledge.\`;

export async function startRealtimeFront(io: {
  play: (pcm: Int16Array, sampleRate: number) => void; // app-owned: the caller's speaker
  clearPlayback: () => void;                           // app-owned: drop queued audio
}): Promise<RealtimeAgent> {
  const network = new MeshNetwork();
  const frontMesh = new InMemoryMeshAdapter(network, "front");
  const workerMesh = new InMemoryMeshAdapter(network, "worker");
  // The front's model slot carries the realtime config. Fold your real tools onto the worker.
  const front = buildAgent("front", s2sDrivenModel({ label: "s2s-front", provider: "openai", voice: "marin" }), FRONT_PROMPT);
  const worker = buildAgent("worker", workerModel(), WORKER_PROMPT);
  await mountMesh(front, { adapter: frontMesh, identity: { id: "front", name: "Voice Front", description: "Realtime voice." } });
  await mountMesh(worker, { adapter: workerMesh, identity: { id: "worker", name: "Worker", description: "Full tool surface." } });

  const rt = new RealtimeAgent({ agent: front, excludeTools: ["glove_mesh_broadcast", "glove_mesh_acknowledge"] });

  // A delegation reached the worker: research in the background. Never await it here.
  let queue: Promise<void> = Promise.resolve();
  workerMesh.subscribe(async (msg) => {
    if (msg.kind !== "direct" || msg.from !== "front") return;
    queue = queue
      .then(() => worker.processRequest("Handle the new request(s) in your inbox, then reply."))
      .then(() => {}, () => {});
  });

  // The worker's threaded reply: speak it in the live call.
  frontMesh.subscribe(async (msg) => {
    if (msg.kind === "direct" && msg.from === "worker") {
      rt.inject(\`<worker-result>\${msg.content}</worker-result>\`, { respond: true });
    }
  });

  rt.adapter.on("audio", (pcm, format) => io.play(pcm, format.sampleRate));
  rt.adapter.on("interrupted", () => io.clearPlayback()); // provider-native barge-in
  await rt.start();
  return rt; // feed caller audio with rt.sendAudio(pcm) at rt.adapter.inputFormat.sampleRate
}`} />

      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          Never await the worker inside a mesh handler. In-memory delivery
          awaits each subscriber in turn, so the front&apos;s tool call, and the
          caller, would wait for the whole research run. Also note that the
          realtime path never runs Glove&apos;s loop, so the reply&apos;s inbox
          item is not injected for you: <code>inject</code> is the delivery.
        </p>
      </div>

      <p>
        The realtime prompt is short because the provider handles the audio
        channel. Its key rules, from <code>s2s-front-agent.ts</code>: &ldquo;The
        tool returns as soon as the request is dispatched — that does NOT mean
        the answer is ready.&rdquo; and &ldquo;If asked while a lookup is
        pending, say you&apos;re still checking.&rdquo;
      </p>

      <h3 id="realtime-front-tool">Delegate through a tool (layered-voice /s2s)</h3>

      <p>
        Without a mesh, the front calls a function tool and the worker runs
        behind an HTTP route. In <code>examples/layered-voice</code>,{" "}
        <code>app/api/voice/s2s-token/route.ts</code> mints an ephemeral
        Realtime client secret with <code>createOpenAIRealtimeToken</code> and a{" "}
        <code>delegate_to_worker</code> tool whose only parameter is{" "}
        <code>request</code>. <code>app/s2s/page.tsx</code> handles{" "}
        <code>tool_call</code> on <code>OpenAIRealtimeAdapter</code> by POSTing
        to <code>app/api/s2s/delegate/route.ts</code>, which runs the same
        worker agent and returns its final message text, then answers with{" "}
        <code>adapter.sendToolResult(callId, result)</code>. The code is the
        pattern in <Link href="/docs/realtime-voice#browser-tokens">Browser Realtime sessions</Link>.
        The call stays open while the worker researches; the instructions tell
        the model to acknowledge, keep chatting, and never invent results.
      </p>

      <h3 id="realtime-front-foundry">Delegate durable work to Foundry</h3>

      <p>
        In <code>examples/foundry-braind-storm</code>, the briefing-line agent
        (<code>agents/briefing-line/agent.ts</code>) is a Foundry agent whose
        model is <code>s2sDrivenModel(&#123; provider: &quot;gemini&quot;, … &#125;)</code>{" "}
        (Gemini Live), run by <code>RealtimeAgent</code> in{" "}
        <code>briefing-room.ts</code>. Its <code>launch_campaign_workforce</code>{" "}
        tool calls the Foundry client (<code>client.send(…)</code>) and returns
        at once with a durable batch run id; the workforce then runs as
        observable Foundry runs. Use this when delegated work needs a run id,
        trace, approvals and transcript. See{" "}
        <Link href="/foundry/docs/multi-agent#voice">Voice hosts delegate durable work</Link>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="pipeline-front">Layered with a pipeline front</h2>

      <p>
        The front is a normal streaming text agent, and only its{" "}
        <code>&lt;speech&gt;</code> text reaches TTS. In{" "}
        <code>examples/layered-voice</code> both agents run in one Next.js
        server process; the browser receives spoken text over SSE and streams it
        into ElevenLabs. In <code>examples/server-voice</code> VAD, STT,
        endpointing and TTS also run in a server room, and the worker runs in
        its own process.
      </p>

      <CodeBlock filename="the shape" language="text" code={`caller ─▶ VAD ─▶ STT ─▶ FRONT (fast text model) ── <speech> text ──▶ TTS ─▶ caller
                          │ glove_mesh_send_message({ to: "worker", blocking: true })
                          ▼ (the front's turn ends after its spoken ack)
                     WORKER (heavy model + tools) on a background queue
                          │ glove_mesh_send_message({ to: "front", in_reply_to })
                          ▼
              relay turn: <worker-result> ─▶ FRONT ─▶ <speech> text ─▶ TTS`} />

      <h3 id="pipeline-front-session">The orchestrator</h3>

      <p>
        Front turns run one at a time on a queue. Worker runs serialize on
        their own queue, alongside front turns. A relay waits behind any front
        turn in flight and is skipped when a user turn already used the result.{" "}
        <code>speakTurn</code> is <code>speakFrontTurn</code> from{" "}
        <a href="#speech-wiring">Wiring it to TTS</a>.
      </p>

      <CodeBlock filename="layered-session.ts" language="typescript" code={`import type { IGloveRunnable } from "glove-core";
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";
import { buildAgent, frontModel, workerModel } from "./agents";

const FRONT_PROMPT = \`You are Nova, the voice at the front desk. Only text inside <speech>...</speech> is heard.
You cannot look anything up. For any lookup, call glove_mesh_send_message (to: "worker", blocking: true,
content: the request) and, in the SAME turn, say a short acknowledgement inside <speech> tags.\`;
const WORKER_PROMPT = \`Research requests from "front" with your tools, then reply ONCE with
glove_mesh_send_message (to "front", in_reply_to the message id). Never just acknowledge.\`;
const DRAIN = 'Handle the new request(s) in your inbox, then reply to "front" via glove_mesh_send_message with in_reply_to set.';
const RELAY = "<worker-result>A delegated request finished; the findings are in the resolved inbox block. Relay them inside <speech> tags in one or two sentences.</worker-result>";

export class LayeredVoiceSession {
  private network = new MeshNetwork();
  private front = buildAgent("front", frontModel(), FRONT_PROMPT);
  private worker = buildAgent("worker", workerModel(), WORKER_PROMPT); // fold its real tools
  private frontQueue: Promise<unknown> = Promise.resolve();  // front turns, one at a time
  private workerQueue: Promise<unknown> = Promise.resolve(); // worker runs, beside them
  private dispatched = new Set<string>();

  /** \`speakTurn\` runs one front turn and speaks its <speech> text: speakFrontTurn below. */
  constructor(private readonly speakTurn: (front: IGloveRunnable, prompt: string) => Promise<string>) {}

  async start(): Promise<void> {
    await mountMesh(this.front, { adapter: new InMemoryMeshAdapter(this.network, "front"), identity: { id: "front", name: "Voice Front", description: "The voice front desk." } });
    await mountMesh(this.worker, { adapter: new InMemoryMeshAdapter(this.network, "worker"), identity: { id: "worker", name: "Worker", description: "Full tool surface." } });
  }

  /** Resolves when the FRONT turn ends. Delegated work keeps running. */
  handleUtterance(text: string): Promise<void> {
    return this.onFrontQueue(async () => {
      await this.speakTurn(this.front, text);
      await this.kickWorker();
    });
  }

  /** Hand new delegations (mesh:from:* items in the worker's inbox) to one background run. */
  private async kickWorker(): Promise<void> {
    const items = (await this.worker.store.getInboxItems?.()) ?? [];
    const fresh = items.filter((i) => i.status === "resolved" && i.tag.startsWith("mesh:from:") && !this.dispatched.has(i.id));
    if (fresh.length === 0) return;
    for (const i of fresh) this.dispatched.add(i.id);
    this.workerQueue = this.workerQueue
      .then(async () => {
        await this.worker.processRequest(DRAIN);
        this.queueRelay(); // the reply is now in the front's inbox
      })
      .catch(() => {});
  }

  /** Speak the result in a relay turn, behind any front turn already queued. */
  private queueRelay(): void {
    void this.onFrontQueue(async () => {
      const resolved = (await this.front.store.getResolvedInboxItems?.()) ?? [];
      if (!resolved.some((i) => i.tag.startsWith("mesh:"))) return; // a user turn already used it
      await this.speakTurn(this.front, RELAY);
      await this.kickWorker(); // the relay may delegate a follow-up
    });
  }

  private onFrontQueue(fn: () => Promise<void>): Promise<void> {
    const run = this.frontQueue.then(fn);
    this.frontQueue = run.catch(() => {});
    return run;
  }
}`} />

      <p>
        layered-voice&apos;s <code>session.ts</code> does more: it kicks the
        worker 200 ms after the front&apos;s <code>glove_mesh_send_message</code>{" "}
        <code>tool_use</code> event instead of waiting for the turn to end,
        coalesces replies into one relay, records metrics, and adds the
        fallbacks below.
      </p>

      <h3 id="inbound-tags">Inbound tags: what the front is told</h3>

      <p>
        <code>&lt;speech&gt;</code> is the outbound channel. The front also
        receives tagged notices about events it cannot see
        (<code>app/lib/server/events.ts</code>). Its prompt says: &ldquo;Treat
        any other &lt;tag&gt;-wrapped notice the same way: information about the
        session, not speech.&rdquo;
      </p>

      <table>
        <thead>
          <tr><th>Tag</th><th>Sent when</th><th>Delivered as</th><th>The front should</th></tr>
        </thead>
        <tbody>
          <tr><td><code>&lt;user-interruption&gt;</code></td><td>The caller barged in. Quotes the estimated heard prefix as plain text</td><td>A message appended to history on the front queue, before the interrupting line&apos;s turn</td><td>Answer the person; never re-deliver the cut remainder</td></tr>
          <tr><td><code>&lt;speech-failure&gt;</code></td><td>TTS failed; the room heard none of the line</td><td>A message appended to history</td><td>Re-say what matters at a natural opening</td></tr>
          <tr><td><code>&lt;worker-result&gt;</code></td><td>A worker reply landed</td><td>The prompt of a relay turn; findings arrive in the inbox block</td><td>Relay the key facts in one or two sentences</td></tr>
          <tr><td><code>&lt;worker-trouble&gt;</code></td><td>The delegation errored, or the worker finished without replying</td><td>The prompt of a relay turn, after stale <code>mesh:waiting</code> items are cleared</td><td>Level with the asker and offer to retry</td></tr>
          <tr><td><code>&lt;transcript-correction&gt;</code></td><td>STT&apos;s final text differs from the partial already dispatched</td><td>The prompt of a full front turn</td><td>Say the corrected take, or stay silent if nothing changes</td></tr>
        </tbody>
      </table>

      <h3 id="fallbacks">Fallbacks</h3>
      <ul>
        <li><strong>Promised, but did not dispatch.</strong> If a spoken turn matches <code>PROMISE_RE</code> (&ldquo;one moment&rdquo;, &ldquo;let me check&rdquo;, &ldquo;hold on&rdquo;, &ldquo;bear with me&rdquo;…) and the front never called <code>glove_mesh_send_message</code>, the orchestrator runs one corrective turn that demands the call and says &ldquo;Output NOTHING else — no &lt;speech&gt; tags&rdquo;. It logs <code>promised_without_delegation</code>.</li>
        <li><strong>Researched, but did not reply.</strong> The worker gets one retry prompt. If it still sends nothing, its final message text is salvaged into the front&apos;s inbox and relayed.</li>
        <li><strong>Errored.</strong> Stale <code>mesh:waiting</code> items are marked consumed and a <code>&lt;worker-trouble&gt;</code> turn runs, so the caller is not told &ldquo;still checking&rdquo; forever.</li>
        <li><strong>Wrong envelope.</strong> server-voice&apos;s <code>salvageWrappedSpeech</code> reclaims a reply wrapped in a tag named after a room participant instead of <code>&lt;speech&gt;</code>, because a silent malformed turn in history teaches the model to repeat it.</li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2 id="speech-tags">&lt;speech&gt; tags: speak only what should be heard</h2>

      <p>
        In a pipeline front the model writes text, and something must decide
        what becomes audio. The <code>&lt;speech&gt;</code> protocol makes that
        explicit: only text inside <code>&lt;speech&gt;…&lt;/speech&gt;</code>{" "}
        goes to TTS. Notes, reasoning about who was addressed, and text around
        tool calls stay silent. No tags means the agent says nothing.
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          No Glove package implements this protocol today. The parser is an
          example-level utility in{" "}
          <code>examples/layered-voice/app/lib/server/speech-parser.ts</code>,
          with an identical copy plus <code>salvageWrappedSpeech</code> in{" "}
          <code>examples/server-voice/lib/speech-parser.ts</code>. Copy it into
          your app; the version below is self-contained.
        </p>
      </div>

      <h3 id="why-speech-tags">Why use tags</h3>
      <ul>
        <li><strong>Audio starts on the first spoken token.</strong> The parser emits in-tag text as soon as it is unambiguous, so TTS starts while the model is still generating the rest of the line, a tool call, or silent notes. <code>GloveVoice</code>&apos;s <code>SentenceBuffer</code> waits for <code>.</code>, <code>?</code> or <code>!</code> first.</li>
        <li><strong>Internal text stays silent.</strong> Notes like &ldquo;Not addressed to me — noting the hull id&rdquo; and narration around tool calls never reach the speaker, but stay in the model&apos;s history.</li>
        <li><strong>Silence is an explicit, free decision.</strong> In layered-voice this replaced a separate addressing classifier, which &ldquo;removes a whole model round-trip from every utterance&rdquo;.</li>
        <li><strong>Protocol health is measurable.</strong> The parser counts spoken and discarded characters, blocks and unclosed tags, and keeps the raw output for evals.</li>
      </ul>

      <h3 id="speech-protocol">The protocol and the prompt</h3>
      <p>
        Exact lowercase <code>&lt;speech&gt;</code> and <code>&lt;/speech&gt;</code>,
        no attributes, always closed; a turn may contain several blocks. A tag
        with attributes (<code>&lt;speech lang=&quot;en&quot;&gt;</code>) is not
        recognised, so that block is silent. The rules from layered-voice&apos;s{" "}
        <code>front-agent.ts</code>:
      </p>

      <CodeBlock filename="front-agent.ts (system prompt excerpt)" language="text" code={`# The speech protocol — CRITICAL
Your raw output is NOT spoken. Only text you wrap in <speech>...</speech> tags is converted to audio (ElevenLabs) and heard in the room, streamed as you generate it. Everything outside the tags is silent and invisible to the people around you.
- To say something out loud: <speech>One sec, let me pull that up.</speech>
- To stay quiet: emit NO speech tags at all. You may write a short silent note to yourself outside tags (e.g. "Not addressed to me — noting the hull id.") or nothing.
- Inside the tags, write for the ear: plain spoken sentences only — no markdown, lists, emoji, symbols, or URLs. Say numbers and ids the natural spoken way: "about four hundred eighty thousand credits", "hull K-E-S zero-zero-seven". Keep it to a breath or two.
- Use the exact lowercase tags <speech> and </speech>, and always close them.`} />

      <p>
        Pair it with the delegation rule from the same prompt: &ldquo;Saying
        &lsquo;let me check&rsquo; out loud does NOTHING by itself — if you do
        not call the tool in this turn, nobody looks anything up and the
        customer waits forever.&rdquo;
      </p>

      <h3 id="speech-parser">The parser</h3>

      <CodeBlock filename="speech-tag-parser.ts" language="typescript" code={`// Streaming parser for the <speech>…</speech> protocol.
// Adapted from examples/layered-voice/app/lib/server/speech-parser.ts.
// Only text inside <speech> tags is emitted; everything else is silent.

const OPEN = "<speech>";
const CLOSE = "</speech>";

/** Length of the longest suffix of \`buf\` that is a proper prefix of \`tag\`. */
function partialTagSuffix(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (buf.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

export interface SpeechParseStats {
  /** Characters emitted as speech (including the spaces between blocks). */
  spokenChars: number;
  /** Characters outside the tags, plus stripped markup. Never spoken. */
  discardedChars: number;
  /** Number of <speech> blocks opened this turn. */
  blocks: number;
  /** The turn ended inside an unclosed <speech> block. */
  unclosed: boolean;
}

export class SpeechTagParser {
  private buf = "";
  private inside = false;
  private spoken = "";
  private rawText = "";
  private _stats: SpeechParseStats = { spokenChars: 0, discardedChars: 0, blocks: 0, unclosed: false };

  /** \`onSpeech\` receives each newly unambiguous piece of in-tag text. */
  constructor(private readonly onSpeech: (text: string) => void) {}

  /** Protocol stats for the turn. Complete after finish(). */
  get stats(): SpeechParseStats {
    return { ...this._stats };
  }

  /** Everything the model generated this turn: tags, silent notes and all. */
  get raw(): string {
    return this.rawText;
  }

  /** Feed one streamed chunk. */
  push(chunk: string): void {
    if (!chunk) return;
    this.rawText += chunk;
    this.buf += chunk;
    this.drain();
  }

  /** End of turn. Speaks the rest of an unclosed block. Returns all spoken text. */
  finish(): string {
    this.drain();
    if (this.inside) {
      this._stats.unclosed = true;
      // Drop a held-back partial tag such as "</spee" instead of speaking it.
      const hold = Math.max(partialTagSuffix(this.buf, CLOSE), partialTagSuffix(this.buf, OPEN));
      const text = hold ? this.buf.slice(0, this.buf.length - hold) : this.buf;
      this._stats.discardedChars += hold;
      if (text) this.emit(text);
    } else {
      this._stats.discardedChars += this.buf.length;
    }
    this.buf = "";
    this.inside = false;
    return this.spoken.replace(/\\s+/g, " ").trim();
  }

  private emit(text: string): void {
    if (!text) return;
    // Never let markup reach TTS: strip stray speech-tag fragments and any
    // leftover angle brackets inside a block.
    const clean = text.replace(/<\\/?speech>?/g, "").replace(/[<>]/g, "");
    this._stats.discardedChars += text.length - clean.length;
    if (!clean) return;
    this.spoken += clean;
    this._stats.spokenChars += clean.length;
    this.onSpeech(clean);
  }

  private drain(): void {
    for (;;) {
      if (this.inside) {
        const i = this.buf.indexOf(CLOSE);
        if (i >= 0) {
          this.emit(this.buf.slice(0, i));
          this.buf = this.buf.slice(i + CLOSE.length);
          this.inside = false;
          this.emit(" "); // audible gap between consecutive blocks
          continue;
        }
        // Emit everything except a suffix that could be the start of </speech>.
        const hold = partialTagSuffix(this.buf, CLOSE);
        const safe = this.buf.length - hold;
        if (safe > 0) {
          this.emit(this.buf.slice(0, safe));
          this.buf = this.buf.slice(safe);
        }
        return;
      }
      const i = this.buf.indexOf(OPEN);
      if (i >= 0) {
        this._stats.discardedChars += i; // text before the tag is silent
        this.buf = this.buf.slice(i + OPEN.length);
        this.inside = true;
        this._stats.blocks += 1;
        continue;
      }
      // Outside a block: keep only a suffix that could be the start of <speech>.
      const hold = partialTagSuffix(this.buf, OPEN);
      this._stats.discardedChars += this.buf.length - hold;
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : "";
      return;
    }
  }
}`} />

      <p>
        Outside a block it holds back only a suffix that could still become{" "}
        <code>&lt;speech&gt;</code>; inside, only a suffix that could become{" "}
        <code>&lt;/speech&gt;</code>. Everything else is emitted at once: fed one
        character at a time, <code>&lt;speech&gt;Hi.&lt;/speech&gt;</code> emits{" "}
        <code>H</code>, <code>i</code>, <code>.</code> as they arrive. Text
        outside blocks is discarded. Each closing tag emits one space so blocks
        do not run together. Stray tag fragments and <code>&lt;</code>/<code>&gt;</code>{" "}
        inside a block are stripped. <code>finish()</code> speaks the rest of an
        unclosed block (minus a dangling partial tag), sets{" "}
        <code>stats.unclosed</code>, and returns the spoken text; an empty
        string means the agent stayed silent.
      </p>

      <table>
        <thead>
          <tr><th>Chunks streamed in</th><th>Emitted, per chunk</th><th><code>finish()</code></th></tr>
        </thead>
        <tbody>
          <tr><td><code>&quot;Not for me, noting the hull. &lt;spe&quot;</code> · <code>&quot;ech&gt;One sec, let me &quot;</code> · <code>&quot;pull that up.&lt;/spe&quot;</code> · <code>&quot;ech&gt;&quot;</code></td><td>nothing · <code>&quot;One sec, let me &quot;</code> · <code>&quot;pull that up.&quot;</code> · <code>&quot; &quot;</code></td><td><code>&quot;One sec, let me pull that up.&quot;</code></td></tr>
          <tr><td><code>&quot;&lt;speech&gt;Checking now.&lt;/speech&gt;&quot;</code> · <code>&quot;calling the worker&quot;</code> · <code>&quot;&lt;speech&gt;Back in a moment.&lt;/speech&gt;&quot;</code></td><td><code>&quot;Checking now.&quot;</code>, <code>&quot; &quot;</code> · nothing · <code>&quot;Back in a moment.&quot;</code>, <code>&quot; &quot;</code></td><td><code>&quot;Checking now. Back in a moment.&quot;</code></td></tr>
          <tr><td><code>&quot;&lt;speech&gt;Your warranty ran out in May&quot;</code> · <code>&quot; last year&lt;/spee&quot;</code>, then the turn ends</td><td><code>&quot;Your warranty ran out in May&quot;</code> · <code>&quot; last year&quot;</code></td><td><code>&quot;Your warranty ran out in May last year&quot;</code>, <code>unclosed: true</code></td></tr>
          <tr><td><code>&quot;Not addressed to me. Noting the id KES-0007.&quot;</code></td><td>nothing</td><td><code>&quot;&quot;</code> (silent turn)</td></tr>
        </tbody>
      </table>

      <h3 id="speech-wiring">Wiring it to TTS</h3>
      <p>
        Subscribe to the front agent&apos;s <code>text_delta</code> events,
        push each chunk into a fresh parser per turn, and send spoken text
        straight into a streaming TTS socket. ElevenLabs buffers input on its
        own schedule, so layered-voice forces generation with{" "}
        <code>flush: true</code> once at about 60 spoken characters, then at
        sentence-ending punctuation when at least 120 characters have passed
        since the last forced flush (<code>app/lib/client/useVoice.ts</code>).
        Ignore <code>text_delta</code> between <code>compaction_start</code> and{" "}
        <code>compaction_end</code>: the compaction summary streams too.
      </p>

      <CodeBlock filename="speak-front-turn.ts" language="typescript" code={`import type { IGloveRunnable, SubscriberAdapter } from "glove-core";
import { ElevenLabsTTSAdapter } from "glove-voice";
import { createElevenLabsTTSToken } from "glove-voice/server";
import { SpeechTagParser } from "./speech-tag-parser";

const EARLY_FLUSH_CHARS = 60;    // force the first generation after ~60 spoken chars
const MIN_FLUSH_GAP_CHARS = 120; // then at sentence ends, at most every 120 chars

/**
 * Run one front-agent turn and stream ONLY its <speech> text into TTS.
 * Resolves with everything that was spoken ("" means the agent stayed silent).
 */
export async function speakFrontTurn(
  front: IGloveRunnable,
  prompt: string,
  playAudio: (pcm: Uint8Array) => void, // app-owned: send PCM to the caller
): Promise<string> {
  const out = {
    tts: null as ElevenLabsTTSAdapter | null,
    opened: Promise.resolve(false),
    sentChars: 0,
    charsSinceFlush: 0,
    earlyFlushSent: false,
  };
  let compacting = false;

  const parser = new SpeechTagParser((text) => {
    if (!out.tts) {
      // Open TTS on the first spoken token, so a silent turn costs nothing.
      out.tts = new ElevenLabsTTSAdapter({
        getToken: () => createElevenLabsTTSToken(process.env.ELEVENLABS_API_KEY!),
        voiceId: process.env.ELEVENLABS_VOICE_ID!,
        model: "eleven_flash_v2_5",
        generationConfig: { chunkLengthSchedule: [60, 120, 160, 250] },
      });
      out.tts.on("audio_chunk", playAudio);
      out.opened = out.tts.open().then(() => true, () => false); // text queues until open
    }
    out.sentChars += text.length;
    out.charsSinceFlush += text.length;
    const flush =
      (!out.earlyFlushSent && out.sentChars >= EARLY_FLUSH_CHARS) ||
      (out.earlyFlushSent && /[.?!]/.test(text) && out.charsSinceFlush >= MIN_FLUSH_GAP_CHARS);
    if (flush) {
      out.earlyFlushSent = true;
      out.charsSinceFlush = 0;
    }
    out.tts.sendText(text, flush ? { flush: true } : undefined); // flush forces generation now
  });

  const subscriber: SubscriberAdapter = {
    async record(type, data) {
      if (type === "compaction_start") compacting = true;
      if (type === "compaction_end") compacting = false;
      // Compaction summaries also stream as text_delta. Never speak them.
      if (type === "text_delta" && !compacting) {
        parser.push((data as { text: string }).text);
      }
    },
  };

  front.addSubscriber(subscriber);
  try {
    await front.processRequest(prompt);
  } finally {
    front.removeSubscriber(subscriber);
  }

  const spoken = parser.finish(); // also speaks the rest of an unclosed block
  if (out.tts && (await out.opened)) out.tts.flush(); // end of text for this turn
  return spoken;
}`} />

      <p>
        layered-voice splits this across the network: the server parses and
        streams spoken deltas over SSE, and the browser feeds them to{" "}
        <code>ElevenLabsTTSAdapter</code> with a prewarmed socket and a 12 s
        stall watchdog that reports a <code>&lt;speech-failure&gt;</code>.
        server-voice does it all in the room. One socket per front turn is
        enough because the front&apos;s tools return at once;{" "}
        <code>GloveVoice</code> opens one per model response because tools can
        outlast ElevenLabs&apos; idle timeout (about 20 s).
      </p>

      <h3 id="speech-tags-glovevoice">With GloveVoice</h3>
      <p>
        <code>GloveVoice</code> has no option to filter or transform text
        before TTS, and <code>useGloveVoice</code> takes the same{" "}
        <code>GloveVoiceConfig</code>. Its source says &ldquo;All text across
        the turn is spoken — tool-calling responses included&rdquo;: every{" "}
        <code>text_delta</code> goes through <code>SentenceBuffer</code> (regex{" "}
        <code>/[^.?!]*[.?!]+\s*/g</code>) into TTS. To use{" "}
        <code>&lt;speech&gt;</code> tags, feed TTS yourself from a subscriber,
        as <code>speakFrontTurn</code> does. The layered-voice README gives a
        second reason for layered agents: <code>useGloveVoice</code> &ldquo;assumes
        an in-browser agent and can&apos;t speak the proactive relay, which
        arrives outside the initiating turn.&rdquo;
      </p>

      <p>
        The only seam inside <code>GloveVoice</code> is the{" "}
        <code>createTTS</code> factory. An adapter wrapper that runs{" "}
        <code>sendText</code> through a <code>SpeechTagParser</code> works, with
        caveats you own: it still receives sentence-sized chunks, so audio
        starts at the first sentence end; it must emit <code>done</code> itself
        when nothing was spoken, because <code>GloveVoice</code> returns to{" "}
        <code>listening</code> on the last adapter&apos;s <code>done</code>; and{" "}
        <code>narrate(text)</code> uses the same factory, so narrated text
        without tags would be silent.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="fast-front">Fast models for the front</h2>

      <p>
        The front speaks on every turn, so its time to first spoken token is
        the largest part of the latency you control. Optimise it for:
      </p>
      <ul>
        <li><strong>Time to first spoken token</strong>: little or no reasoning before output, and a fast host.</li>
        <li><strong>Instruction following</strong>: <code>&lt;speech&gt;</code> tags, silence when a line is not for it, and the delegation call in the same turn as its acknowledgement.</li>
        <li><strong>Not capability.</strong> It has almost no tools. Put capability in the worker, whose latency hides behind the front&apos;s acknowledgement.</li>
      </ul>

      <p>
        <code>examples/layered-voice/app/lib/server/models.ts</code> states the
        split: &ldquo;the front agent runs a small/fast tier; the worker runs the
        heavy tier.&rdquo; Its defaults by <code>VOICE_PROVIDER</code>:{" "}
        <code>openrouter</code> (default) uses <code>moonshotai/kimi-k2-0905</code>{" "}
        for the front and <code>minimax/minimax-m2.5</code> for the worker;{" "}
        <code>anthropic</code> uses <code>claude-haiku-4-5-20251001</code> and{" "}
        <code>claude-sonnet-4-20250514</code>.
      </p>

      <CodeBlock filename="agents.ts" language="typescript" code={`import { Glove, Displaymanager, MemoryStore, createAdapter, type IGloveRunnable, type ModelAdapter } from "glove-core";

// Front: optimise for time to first spoken token and for following the protocol.
export const frontModel = () =>
  createAdapter({
    provider: "openrouter",
    model: process.env.FRONT_MODEL ?? "moonshotai/kimi-k2-0905",
    stream: true, // <speech> text must stream into TTS
    reasoning: {
      reasoningObject: { effort: "low" }, // thinking before the first token is dead air
      echo: false,
      extraBody: { provider: { sort: "throughput" } }, // OpenRouter: fastest host for these weights
    },
  });

// Worker: optimise for capability and tool use. The front hides its latency.
export const workerModel = () =>
  createAdapter({ provider: "openrouter", model: process.env.WORKER_MODEL ?? "minimax/minimax-m2.5", stream: true, reasoning: true });

// One store (with inbox support, which the mesh needs) and one adapter per agent.
export function buildAgent(id: string, model: ModelAdapter, systemPrompt: string): IGloveRunnable {
  return new Glove({
    store: new MemoryStore(id),
    model,
    displayManager: new Displaymanager(),
    systemPrompt,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarize briefly. Keep pending requests." },
  }).build();
}`} />

      <table>
        <thead>
          <tr><th>Env (layered-voice)</th><th>Effect</th></tr>
        </thead>
        <tbody>
          <tr><td><code>FRONT_REASONING</code></td><td><code>low</code> (default): <code>reasoningObject: &#123; effort: &quot;low&quot; &#125;</code>. <code>budget:&lt;n&gt;</code>: a hard cap, <code>&#123; max_tokens: n &#125;</code>. <code>off</code>: <code>&#123; enabled: false &#125;</code>, which some providers reject for reasoning models. <code>none</code>: no reasoning field. Anthropic ignores it</td></tr>
          <tr><td><code>FRONT_PROVIDER_SORT</code></td><td>OpenRouter routing: <code>throughput</code> (default on OpenRouter), <code>latency</code>, <code>price</code>, or <code>off</code></td></tr>
          <tr><td><code>FRONT_MODEL</code> / <code>WORKER_MODEL</code></td><td>Override the model per role</td></tr>
        </tbody>
      </table>

      <ul>
        <li>Measured in the layered-voice example: <code>gpt-oss-120b</code> on OpenRouter took 979 ms to first token with default routing and 160 ms with <code>provider.sort: &quot;throughput&quot;</code>, on an identical prompt. Who serves the weights mattered more than the weights.</li>
        <li>Measured in the layered-voice example: the default front, Kimi K2 served via Groq, reached first token in 263 ms (<code>gpt-oss-120b</code>: 310 ms) with better addressing judgment on its rubric. Its occasional acknowledgement without a tool call is caught by the delegation nudge in <a href="#fallbacks">Fallbacks</a>.</li>
        <li>Measured in the server-voice example (<code>PRODUCTION.md</code> §16), scoring correct silence on cases from real calls: a fast tier scored 2/5 at 313 ms to first spoken token, a mid tier 4/5 at 1853 ms, a strong tier 5/5 at 3213 ms. Its findings: &ldquo;A better prompt does not fix a model that won&apos;t follow it&rdquo; and &ldquo;Serving matters more than weights for latency.&rdquo;</li>
      </ul>

      <p>
        Measure time to the first <em>spoken</em> token: reasoning and silent
        notes before the first <code>&lt;speech&gt;</code> are dead air.
        layered-voice logs it as <code>front_ttft_ms</code>, and{" "}
        <code>pnpm eval -- --model &lt;id&gt;</code> scores a front model on
        addressing, delegation, content and speed. With a realtime front, the
        front model is the S2S provider&apos;s; the worker is still yours to
        choose.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="latency">Latency budgets</h2>

      <p>These are the examples&apos; own figures, not guarantees.</p>

      <table>
        <thead>
          <tr><th>Shape</th><th>Figure</th><th>Source</th></tr>
        </thead>
        <tbody>
          <tr><td>Cascade (STT → LLM → TTS)</td><td>Bottoms out around 1.3–1.6 s voice-to-voice</td><td><code>glove-voice-s2s</code> README</td></tr>
          <tr><td>Speech-to-speech</td><td>500–800 ms voice-to-voice for production S2S APIs</td><td><code>glove-voice-s2s</code> README; layered-voice&apos;s <code>/s2s</code> page logs the real number as <code>s2s_voice_to_voice_ms</code></td></tr>
          <tr><td>Layered pipeline, browser-hosted</td><td>Typically 0.9–1.3 s (README section &ldquo;The sub-1.5s latency budget&rdquo;). Per leg: end of speech 450 ms for questions; STT finalize ~0 ms (dispatch from the live partial); first spoken token 160–600 ms; TTS first audio ~75–150 ms with <code>eleven_flash_v2_5</code></td><td>layered-voice README</td></tr>
          <tr><td>Layered pipeline, server room</td><td>~937 ms from speech end to commit; ~1.5 s voice-to-voice on a live room</td><td>server-voice <code>PRODUCTION.md</code> §3</td></tr>
          <tr><td>Delegated answers</td><td>Worker time plus one relay turn, logged as <code>delegation_roundtrip_ms</code></td><td>layered-voice</td></tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2 id="interruptions">Barge-in and interruptions</h2>

      <table>
        <thead>
          <tr><th>Shape</th><th>What happens</th><th>What the model learns</th></tr>
        </thead>
        <tbody>
          <tr><td>Single-agent pipeline</td><td>In VAD mode, <code>GloveVoice</code> calls <code>interrupt()</code> while thinking or speaking: on <code>speech_real_start</code> with a confirming VAD (Silero), else on <code>speech_start</code>. It aborts the request, destroys TTS, stops playback and clears non-blocking display slots. Skipped while a <code>pushAndWait</code> resolver is pending. In manual mode, call <code>interrupt()</code> yourself</td><td>Nothing: <code>GloveVoice</code> does not record how much was heard</td></tr>
          <tr><td>Realtime, single or layered</td><td>Provider-native. Clear queued playback on the adapter&apos;s <code>interrupted</code> event. Gemini: <code>activityHandling: &quot;NO_INTERRUPTION&quot;</code> turns barge-in off. GPT-Live: manual <code>interrupt()</code> mutes output until <code>resumeOutput?.()</code>. A layered worker keeps running</td><td><code>OpenAIRealtimeSocketAdapter</code> sends <code>conversation.item.truncate</code> with <code>audio_end_ms</code> estimated from the playback clock (<code>truncateToHeard</code>)</td></tr>
          <tr><td>Layered, pipeline front</td><td>You build it. layered-voice cuts TTS on confirmed speech (250 ms sustained on the energy VAD, <code>speech_real_start</code> with Silero) and voids queued speech. server-voice decides on the server: pause on any speech-ish frame within 85–128 ms, cut when the transcript grows or the VAD confirms, resume mid-word if it was a cough</td><td>A <code>&lt;user-interruption&gt;</code> notice quoting the heard prefix, estimated from playback time</td></tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2 id="examples">Example map</h2>

      <table>
        <thead>
          <tr><th>Shape</th><th>Example</th><th>Read first</th></tr>
        </thead>
        <tbody>
          <tr><td>Single-agent pipeline</td><td><a href={`${GH}/coffee`}>coffee</a>, <a href={`${GH}/lola`}>lola</a></td><td><code>app/components/chat.tsx</code>, <code>app/components/lola.tsx</code></td></tr>
          <tr><td>Single-agent realtime</td><td><a href={`${GH}/s2s-agent`}>s2s-agent</a></td><td><code>app/lib/agent.ts</code>, <code>app/page.tsx</code></td></tr>
          <tr><td>Layered, realtime front (mesh)</td><td><a href={`${GH}/s2s-rooms`}>s2s-rooms</a></td><td><code>lib/s2s-front-agent.ts</code>, <code>signals/s2s-room.ts</code></td></tr>
          <tr><td>Layered, realtime front (tool)</td><td><a href={`${GH}/layered-voice`}>layered-voice</a> <code>/s2s</code></td><td><code>app/api/voice/s2s-token/route.ts</code>, <code>app/s2s/page.tsx</code>, <code>app/api/s2s/delegate/route.ts</code></td></tr>
          <tr><td>Layered, realtime front (Foundry)</td><td><a href={`${GH}/foundry-braind-storm`}>foundry-braind-storm</a></td><td><code>agents/briefing-line/agent.ts</code>, <code>briefing.tools.ts</code>, <code>briefing-room.ts</code></td></tr>
          <tr><td>Layered, pipeline front</td><td><a href={`${GH}/layered-voice`}>layered-voice</a></td><td><code>app/lib/server/session.ts</code>, <code>front-agent.ts</code>, <code>speech-parser.ts</code>, <code>events.ts</code>, <code>models.ts</code>, <code>app/lib/client/useVoice.ts</code></td></tr>
          <tr><td>Layered, pipeline front, server-hosted</td><td><a href={`${GH}/server-voice`}>server-voice</a></td><td><code>PRODUCTION.md</code>, <code>lib/voice-session.ts</code>, <code>lib/speech-parser.ts</code></td></tr>
        </tbody>
      </table>

      <p>
        <code>avatar-rooms</code> and <code>livekit-rooms</code> build on the
        realtime-front shape; see <Link href="/docs/realtime-voice">Realtime voice</Link>.
      </p>

      <h2 id="related">Related</h2>
      <ul>
        <li><Link href="/docs/voice">Voice pipeline</Link>: <code>GloveVoice</code>, VAD, speech gating, push-to-talk</li>
        <li><Link href="/docs/realtime-voice">Realtime voice</Link>: <code>RealtimeAgent</code>, providers, live context, avatars, LiveKit</li>
        <li><Link href="/docs/realtime">Realtime agents</Link>: <code>RealtimeSession</code>, the whole agent on a realtime model</li>
        <li><Link href="/docs/mesh">Mesh</Link>: <code>mountMesh</code>, blocking sends, replies</li>
        <li><Link href="/foundry/docs/multi-agent#voice">Foundry multi-agent</Link>: voice hosts that delegate durable work</li>
        <li><Link href="/blog/building-the-voice-stack">Building the voice stack</Link>: why the front is thin</li>
      </ul>
    </div>
  );
}
