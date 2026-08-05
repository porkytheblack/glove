import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Realtime Voice & Avatars",
  description:
    "Run a Glove agent on a speech-to-speech model, give it a live face, and put it in a LiveKit room.",
};

export default function RealtimeVoicePage() {
  return (
    <div className="docs-content">
      <h1>Realtime Voice &amp; Avatars</h1>

      <p>
        The <a href="/docs/voice">cascade pipeline</a> — VAD → STT → LLM → TTS —
        bottoms out around <strong>1.3–1.6s</strong> voice-to-voice: every stage
        adds serial latency, and end-of-turn has to be reconstructed from
        transcripts with heuristics. A speech-to-speech model collapses the
        cascade — audio in, one model, audio out — with turn-taking decided by
        the model <em>listening</em>. Production S2S APIs run{" "}
        <strong>500–800ms</strong>.
      </p>

      <p>Three packages layer on top of each other:</p>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Adds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>glove-voice-s2s</code>
            </td>
            <td>Run a built Glove agent on a realtime S2S model</td>
          </tr>
          <tr>
            <td>
              <code>glove-voice-avatar</code>
            </td>
            <td>A lip-synced face over the agent&apos;s audio</td>
          </tr>
          <tr>
            <td>
              <code>glove-voice-livekit</code>
            </td>
            <td>LiveKit as the room transport, plus LiveKit-native avatars</td>
          </tr>
        </tbody>
      </table>

      <p>
        The whole progression is preserved as runnable examples in the repo:{" "}
        <code>examples/layered-voice</code> → <code>server-voice</code> →{" "}
        <code>s2s-rooms</code> → <code>avatar-rooms</code> →{" "}
        <code>livekit-rooms</code>.
      </p>

      {/* ============================================================ */}
      <h2 id="s2s">Speech-to-speech</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-voice-s2s`}
      />

      <h3 id="the-pieces">The pieces</h3>

      <table>
        <thead>
          <tr>
            <th>Piece</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>S2SAdapter</code>
            </td>
            <td>
              The provider contract: one live session — audio in/out, tool calls
              as events, a text side-channel
            </td>
          </tr>
          <tr>
            <td>
              <code>OpenAIRealtimeAdapter</code>
            </td>
            <td>
              <strong>device</strong> mode (WebRTC, browser-only): owns the mic
              and plays the reply itself
            </td>
          </tr>
          <tr>
            <td>
              <code>OpenAIRealtimeSocketAdapter</code>
            </td>
            <td>
              <strong>transport</strong> mode (WebSocket, Node + browser): 24
              kHz PCM both ways
            </td>
          </tr>
          <tr>
            <td>
              <code>GeminiLiveAdapter</code>
            </td>
            <td>
              <strong>transport</strong> mode: 16 kHz in, 24 kHz out — the mode
              a server-hosted room needs
            </td>
          </tr>
          <tr>
            <td>
              <code>RealtimeAgent</code>
            </td>
            <td>
              Runs a built Glove on an S2S model: its prompt and tools configure
              the session
            </td>
          </tr>
          <tr>
            <td>
              <code>createS2SAdapter</code>
            </td>
            <td>
              Provider/model/credential factory — args first, <code>S2S_*</code>{" "}
              env second
            </td>
          </tr>
          <tr>
            <td>
              <code>s2sDrivenModel</code>
            </td>
            <td>
              The Glove model slot for S2S-driven agents, optionally carrying
              the full realtime config
            </td>
          </tr>
          <tr>
            <td>
              <code>runConformance</code>
            </td>
            <td>The behavioural suite every adapter must pass</td>
          </tr>
        </tbody>
      </table>

      <p>
        Every adapter declares <code>mode: &quot;device&quot; | &quot;transport&quot;</code>{" "}
        so a host can refuse a mismatch loudly at startup instead of discovering
        silence on the first call. <strong>Device</strong> opens the microphone
        and plays the reply itself — least code, browser only.{" "}
        <strong>Transport</strong> moves PCM and nothing else: the only mode a
        server room or phone bridge can use, because there is no microphone in
        the process.
      </p>

      <h3 id="running-an-agent">Running a Glove agent on an S2S model</h3>

      <p>
        Author the agent exactly as you always do — tools, prompt, store — and
        hand it to <code>RealtimeAgent</code>. One definition, two runtimes: the
        same tools serve text turns through the normal loop and voice turns
        through the provider&apos;s.
      </p>

      <CodeBlock
        filename="voice-agent.ts"
        language="typescript"
        code={`import { RealtimeAgent, s2sDrivenModel } from "glove-voice-s2s";

// The cleanest form: the model slot carries the realtime config, and
// RealtimeAgent derives the provider session from the agent itself.
const agent = new Glove({
  model: s2sDrivenModel({
    label: "s2s-front",
    provider: "openai",                                        // or S2S_PROVIDER
    voice: "marin",                                            // or S2S_VOICE
    turnDetection: { type: "semantic_vad", eagerness: "low" }, // typed knobs
  }),
  systemPrompt, store, displayManager, compaction_config,
}).fold(myTool).build();

const rt = new RealtimeAgent({ agent });
await rt.start();`}
      />

      <p>Or pass an explicit adapter — it always wins over the model-slot config:</p>

      <CodeBlock
        filename="voice-agent.ts"
        language="typescript"
        code={`const rt = new RealtimeAgent({
  agent,                                    // a built Glove (IGloveRunnable)
  adapter: createS2SAdapter({ provider: "gemini" }),
  instructions: SPOKEN_PERSONA,             // re-voice the text prompt for speech
  excludeTools: ["render_chart"],           // withhold tools that don't belong in a call
});

rt.on("user_said", (t) => log("caller:", t));
rt.on("agent_said", (t) => log("agent:", t));
await rt.start();

// transport mode: wire audio yourself
micStream.on("pcm", (pcm) => rt.sendAudio(pcm));
rt.adapter.on("audio", (pcm, format) => speaker.play(pcm, format.sampleRate));

// push an async result into the live call — the model relays it out loud
rt.inject("the lookup finished: covered until 2031", { respond: true });`}
      />

      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          <strong>What the voice path deliberately does not do.</strong> The
          provider owns the loop, so the Glove Executor never runs:{" "}
          <code>requiresPermission</code> is not enforced (put gated tools in{" "}
          <code>excludeTools</code>); <code>display.pushAndWait</code> tools get
          no <code>handOver</code> and will throw (exclude them — voice-first
          tools should return descriptive <code>data</code> instead); and tool
          calls and transcripts are not persisted to the store or fired as
          subscriber events (use <code>RealtimeAgent</code>&apos;s own{" "}
          <code>user_said</code> / <code>agent_said</code> /{" "}
          <code>tool_started</code> / <code>tool_finished</code> events to log).
        </p>
      </div>

      <p>
        What <em>is</em> shared with the text path: tool definitions and JSON
        schemas, Zod input validation before <code>run</code>, the system
        prompt, and the <code>renderData</code>-stays-client-side contract — the
        bridge strips <code>renderData</code> and <code>summary</code> before
        anything reaches the provider, exactly like the model adapters do.
      </p>

      <h3 id="configuration">Configuration</h3>

      <table>
        <thead>
          <tr>
            <th>Env</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>S2S_PROVIDER</code>
            </td>
            <td>
              <code>openai</code> (WS transport) | <code>openai-webrtc</code>{" "}
              (browser device) | <code>gemini</code>. Unset: whichever key
              exists, OpenAI first
            </td>
          </tr>
          <tr>
            <td>
              <code>S2S_MODEL</code>
            </td>
            <td>Model id; unset uses the provider default</td>
          </tr>
          <tr>
            <td>
              <code>OPENAI_API_KEY</code> / <code>GEMINI_API_KEY</code>
            </td>
            <td>
              The credential when no <code>getToken</code>/<code>apiKey</code>{" "}
              is passed — server-side only
            </td>
          </tr>
          <tr>
            <td>
              <code>S2S_TURN_DETECTION</code>
            </td>
            <td>
              OpenAI: <code>semantic_vad</code> (default) |{" "}
              <code>server_vad</code> (snappier barge-in)
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        A missing credential fails at <strong>construction</strong> with the env
        var name, not at <code>connect()</code> with a 401. Both providers
        expose their full turn-taking surface as typed config, so a mistyped
        field fails at compile time instead of being silently ignored:
      </p>

      <CodeBlock
        filename="turn-taking.ts"
        language="typescript"
        code={`// OpenAI — the model judges WHETHER you were done
createS2SAdapter({ provider: "openai", turnDetection: {
  type: "semantic_vad",
  eagerness: "low",              // low | medium | high | auto
}});

// …or threshold-driven
createS2SAdapter({ provider: "openai", turnDetection: {
  type: "server_vad",
  threshold: 0.6,                // how loud counts as speech
  silence_duration_ms: 700,      // trailing silence before end-of-turn
  prefix_padding_ms: 300,
  idle_timeout_ms: 10_000,
}});
// turnDetection: null → manual / push-to-talk

// Gemini
createS2SAdapter({ provider: "gemini", realtimeInput: {
  automaticActivityDetection: {
    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    silenceDurationMs: 700,
  },
  activityHandling: "NO_INTERRUPTION",   // default is barge-in
}});`}
      />

      <h3 id="browser-tokens">Browser sessions</h3>

      <p>API keys never reach the browser. Mint an ephemeral token server-side:</p>

      <CodeBlock
        filename="app/api/voice/s2s-token/route.ts"
        language="typescript"
        code={`import { createOpenAIRealtimeToken } from "glove-voice-s2s/server";

const { token } = await createOpenAIRealtimeToken({
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: SPOKEN_PERSONA,
  voice: "marin",
  tools: [{ name: "delegate_to_worker", description: "…", parameters: {} }],
});`}
      />

      <CodeBlock
        filename="app/voice.tsx"
        language="typescript"
        code={`import { OpenAIRealtimeAdapter } from "glove-voice-s2s";

const s2s = new OpenAIRealtimeAdapter({
  getToken: () => fetchToken("/api/voice/s2s-token"),
});

s2s.on("tool_call", async ({ callId, name, arguments: args }) => {
  const result = await runWorker(JSON.parse(args).request);  // your heavy agent
  s2s.sendToolResult(callId, result);                        // relayed out loud
});

await s2s.connect();`}
      />

      {/* ============================================================ */}
      <h2 id="avatars">Avatars</h2>

      <p>
        A realtime avatar provider is a lip-sync renderer over an audio stream:
        PCM in, a talking face out on a WebRTC surface. That is exactly the
        shape of the <code>audio</code> events a transport-mode{" "}
        <code>S2SAdapter</code> already emits — so the avatar is a{" "}
        <strong>rendering layer</strong>, not a replacement for any of the
        stack. The mic path, tools and delegation are untouched.
      </p>

      <CodeBlock
        filename="the shape"
        language="text"
        code={`mic ──▶ S2S model (brain + voice) ──▶ agent PCM ──▶ AvatarAdapter ──▶ the face
          │ tool calls unchanged                          (provider WebRTC surface)
          ▼
     worker over the mesh`}
      />

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-voice-avatar`}
      />

      <CodeBlock
        filename="avatar.ts"
        language="typescript"
        code={`import { RealtimeAgent } from "glove-voice-s2s";
import { TavusEchoAdapter, attachAvatar } from "glove-voice-avatar";

const rt = new RealtimeAgent({ agent });   // the voice stack, exactly as before
await rt.start();

const avatar = new TavusEchoAdapter({
  apiKey: process.env.TAVUS_API_KEY!,      // server-side only
  faceId: process.env.TAVUS_FACE_ID!,
  // palId omitted → ensureEchoPal() reuses-or-creates a MINIMAL echo PAL
  // (no greeting, no TTS layer) so the ONLY voice is ever the agent's.
  sendInteraction: (event) => duct.send({ t: "avatar_interaction", event }),
});

const detach = await attachAvatar(rt, avatar);

avatar.view; // { kind: "webrtc-room", url: "https://…" } — hand to the client`}
      />

      <p>
        <code>attachAvatar</code> is the whole bridge: <code>audio</code> →{" "}
        <code>sendAudio</code>, <code>agent_speech_stopped</code> →{" "}
        <code>endUtterance</code>, <code>interrupted</code> →{" "}
        <code>interrupt</code>. Barge-in therefore follows the voice
        automatically. <code>AvatarView</code> is a tagged union — a WebRTC room
        URL (Tavus/Daily) or an SDK session token (Anam) — so a client knows how
        to attach without knowing the provider.
      </p>

      <table>
        <thead>
          <tr>
            <th>Adapter</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>TavusEchoAdapter</code>
            </td>
            <td>
              Tavus <code>pipeline_mode: &quot;echo&quot;</code> — our PCM as base64
              24 kHz events; the caller joins the conversation&apos;s Daily room
            </td>
          </tr>
          <tr>
            <td>
              <code>AnamPassthroughAdapter</code>
            </td>
            <td>
              Anam audio-passthrough (Anam&apos;s own LLM/TTS stay out of the
              loop). The server mints the token, the browser owns the SDK
              session, so the adapter needs a <code>sendCommand</code> courier
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        Writing your own? Implement <code>AvatarAdapter</code> —{" "}
        <code>connect()</code>, <code>sendAudio()</code>,{" "}
        <code>endUtterance()</code>, <code>interrupt()</code> (always safe,
        conformance-enforced) — and run <code>runAvatarConformance</code>{" "}
        against a fake transport.
      </p>

      {/* ============================================================ */}
      <h2 id="livekit">LiveKit</h2>

      <p>
        <code>glove-voice-livekit</code> is two halves sharing one room
        connection. <code>LiveKitTransport</code> is the room leg every
        LiveKit-backed voice host otherwise hand-rolls: join, publish the
        agent&apos;s voice as a paced WebRTC track, feed remote mic tracks back
        out as PCM events, carry JSON on the data channel. Barge-in is
        server-authoritative — <code>clear()</code> flushes the outbound{" "}
        <code>AudioSource</code> queue, so there is no client playback buffer to
        chase.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-voice-livekit`}
      />

      <CodeBlock
        filename="room.ts"
        language="typescript"
        code={`import { LiveKitTransport, attachRealtime, mintParticipantToken } from "glove-voice-livekit";

const transport = new LiveKitTransport({
  url: process.env.LIVEKIT_URL!,
  token: await mintParticipantToken(
    { apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET! },
    { roomName: "call-42", identity: "agent" },
  ),
});

await transport.connect();
attachRealtime(rt, transport);   // mics → model, model → track, interrupt → flush
await rt.start();`}
      />

      <h3 id="livekit-avatars">With a face</h3>

      <p>
        <code>TavusLiveKitAvatar</code> and <code>AnamLiveKitAvatar</code>{" "}
        implement the same <code>AvatarAdapter</code> contract (and pass its
        conformance suite), so a face over LiveKit is interchangeable with the
        Daily-based one. Under the hood they speak LiveKit&apos;s published
        avatar protocol: the provider&apos;s worker{" "}
        <strong>joins your room as a second participant</strong> and publishes
        synchronized voice and face itself. A Glove agent is indistinguishable
        from a LiveKit Agents worker as far as the avatar can tell.
      </p>

      <CodeBlock
        filename="room-with-face.ts"
        language="typescript"
        code={`import { TavusLiveKitAvatar, mintAvatarToken } from "glove-voice-livekit";
import { attachAvatar } from "glove-voice-avatar";

// The avatar publishes the voice on the agent's behalf — don't double it.
const transport = new LiveKitTransport({ url, token, publishAgentAudio: false });
await transport.connect();
attachRealtime(rt, transport, { agentAudio: false });

const avatar = new TavusLiveKitAvatar({
  apiKey: process.env.TAVUS_API_KEY!,
  faceId: process.env.TAVUS_FACE_ID!,   // minimal echo PAL ensured automatically
  livekitUrl: url,
  avatarToken: await mintAvatarToken(creds, { roomName: "call-42" }),
});

await attachAvatar(rt, avatar);`}
      />

      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/voice">Voice Pipeline</a> — the cascade, push-to-talk,
          noise robustness and React Native
        </li>
        <li>
          <a href="/docs/mesh">Mesh</a> — the heavy worker a thin voice front
          agent delegates to
        </li>
        <li>
          <a href="/docs/showcase/lola">Lola</a> — a voice-first app read end to
          end
        </li>
      </ul>
    </div>
  );
}
