import { CodeBlock } from "@/components/code-block";

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
  whiteSpace: "nowrap",
};
const thDescStyle: React.CSSProperties = {
  ...thStyle,
  fontFamily: undefined,
  whiteSpace: "normal",
};
const headRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border)" };
const bodyRowStyle: React.CSSProperties = { borderBottom: "1px solid var(--border-subtle)" };
const propCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const typeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  whiteSpace: "normal",
  minWidth: "200px",
};

function PropTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: [string, string, string][];
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h, i) => (
              <th key={h} style={i < 2 ? thStyle : thDescStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, desc]) => (
            <tr key={prop + type} style={bodyRowStyle}>
              <td style={propCell}>{prop}</td>
              <td style={typeCell}>{type}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const asciiDiagram: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: "0.85rem",
  padding: "1.25rem 1.5rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  overflowX: "auto",
  whiteSpace: "pre",
  lineHeight: 1.6,
  margin: "1.5rem 0",
  color: "var(--text-secondary)",
};

export default function VoicePage() {
  return (
    <div className="docs-content">
      <h1>Voice Integration</h1>

      <p>
        Add real-time voice to any Glove agent. The voice pipeline handles
        microphone capture, speech-to-text, agent processing, and
        text-to-speech playback &mdash; while all your existing tools, display
        stack, and context management continue to work unchanged.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="overview">Overview</h2>

      <h3>Pipeline Architecture</h3>

      <div style={asciiDiagram}>
{`Mic  -->  VAD  -->  Gate  -->  STT  -->  Glove  -->  TTS  -->  Speaker
         |         |                     |
    speech      only confirmed      processRequest()
    detection   speech passes       (tools, display stack,
                (noise dropped)      context, compaction)`}
      </div>

      <p>
        The <strong>gate</strong> is what keeps background noise out of STT: mic
        audio only reaches the provider once the VAD confirms speech (see{" "}
        <a href="#noise-robustness">Noise Robustness</a>). The voice system is
        split across packages, each with a specific responsibility:
      </p>

      <ul>
        <li>
          <strong>glove-voice</strong> &mdash; The pipeline engine.
          Contains <code>GloveVoice</code>, adapter contracts (STT, TTS, VAD,
          audio IO), built-in implementations (ElevenLabs adapters, adaptive
          energy VAD), the speech gate, audio capture, and audio playback.
        </li>
        <li>
          <strong>glove-react/voice</strong> &mdash; React hooks and
          components. Provides <code>useGloveVoice</code> (low-level),{" "}
          <code>useGlovePTT</code> (push-to-talk), and{" "}
          <code>VoicePTTButton</code> (headless mic button) with proper
          lifecycle management. DOM-free — usable in React Native too.
        </li>
        <li>
          <strong>glove-next</strong> &mdash; Token route handlers.
          Provides <code>createVoiceTokenHandler</code> for creating Next.js
          API routes that generate short-lived provider tokens, keeping your
          API keys on the server.
        </li>
        <li>
          <strong>glove-voice-native</strong> &mdash; React Native / Expo audio
          backends (on-device mic capture, PCM playback, Silero VAD on
          onnxruntime-react-native). See{" "}
          <a href="#react-native">React Native &amp; Expo</a>.
        </li>
      </ul>

      <h3>Turn Modes</h3>

      <p>
        GloveVoice supports two turn detection modes that control how the
        pipeline decides when the user has finished speaking:
      </p>

      <ul>
        <li>
          <strong>VAD mode</strong> (default) &mdash; Hands-free operation.
          Voice activity detection automatically detects speech boundaries and
          commits turns. Supports barge-in: when the user speaks during a
          response, the pipeline interrupts the current TTS playback and model
          request.
        </li>
        <li>
          <strong>Manual mode</strong> &mdash; Push-to-talk. The consumer
          controls turn boundaries by calling <code>commitTurn()</code>. No
          automatic barge-in &mdash; call <code>interrupt()</code> explicitly
          when needed. Ideal for noisy environments or when precise control is
          required.
        </li>
      </ul>

      <h3>Voice Modes</h3>

      <p>
        The pipeline transitions through four states during operation:
      </p>

      <PropTable
        headers={["Mode", "State", "Description"]}
        rows={[
          [
            "idle",
            "Pipeline off",
            "Not started or stopped. No mic access, no connections.",
          ],
          [
            "listening",
            "Mic active",
            "Capturing audio, sending to STT. Waiting for the user to speak.",
          ],
          [
            "thinking",
            "Agent processing",
            "User utterance committed. Glove is processing the request (model call, tool execution).",
          ],
          [
            "speaking",
            "TTS playback",
            "Audio chunks streaming from TTS to the speaker. Barge-in returns to listening.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="quick-start">Quick Start</h2>

      <p>
        Get voice working in five minutes with ElevenLabs. This assumes you
        already have a Glove agent running with <code>glove-react</code> and{" "}
        <code>glove-next</code>.
      </p>

      <h3>Install</h3>

      <CodeBlock
        code={`pnpm add glove-voice`}
        language="bash"
      />

      <p>
        <code>glove-react</code> and <code>glove-next</code> are already part
        of a typical Glove project. The voice subpaths (<code>glove-react/voice</code>{" "}
        and <code>createVoiceTokenHandler</code> from <code>glove-next</code>)
        are included in those packages.
      </p>

      <h3>Step 1: Token Routes</h3>

      <p>
        Create two API routes that generate short-lived ElevenLabs tokens.
        Your API key stays on the server &mdash; the browser only receives
        single-use tokens.
      </p>

      <CodeBlock
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({
  provider: "elevenlabs",
  type: "stt",
});`}
        filename="app/api/voice/stt-token/route.ts"
        language="typescript"
      />

      <CodeBlock
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({
  provider: "elevenlabs",
  type: "tts",
});`}
        filename="app/api/voice/tts-token/route.ts"
        language="typescript"
      />

      <p>
        Set your ElevenLabs API key in <code>.env.local</code>:
      </p>

      <CodeBlock
        code={`ELEVENLABS_API_KEY=your_api_key_here`}
        language="bash"
      />

      <h3>Step 2: Client Voice Config</h3>

      <p>
        Create a voice configuration file that sets up the ElevenLabs STT
        adapter and TTS factory. The token fetchers point to the routes you
        just created.
      </p>

      <CodeBlock
        code={`import { createElevenLabsAdapters } from "glove-voice";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = await res.json();
  return data.token;
}

export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});`}
        filename="lib/voice.ts"
        language="typescript"
      />

      <p>
        The <code>voiceId</code> is an ElevenLabs voice identifier. Browse
        the{" "}
        <a
          href="https://elevenlabs.io/voice-library"
          target="_blank"
          rel="noopener noreferrer"
        >
          ElevenLabs Voice Library
        </a>{" "}
        to find a voice and copy its ID.
      </p>

      <h3>Step 3: React Hook</h3>

      <p>
        Use <code>useGloveVoice</code> alongside <code>useGlove</code> to
        wire the voice pipeline into your component.
      </p>

      <CodeBlock
        code={`import { useGlove } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import { stt, createTTS } from "@/lib/voice";

function App() {
  const { runnable } = useGlove({ tools, sessionId });
  const voice = useGloveVoice({
    runnable,
    voice: { stt, createTTS },
  });

  return (
    <button onClick={voice.isActive ? voice.stop : voice.start}>
      {voice.mode}
    </button>
  );
}`}
        language="tsx"
      />

      <p>
        That is it. Clicking the button starts the mic, connects STT, and
        begins listening. Speak naturally and the pipeline handles the rest:
        your speech is transcribed, sent to Glove, and the response is spoken
        back.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="voice-adapters">Voice Adapters</h2>

      <p>
        The voice pipeline is built around three adapter contracts. Each
        adapter is an <code>EventEmitter</code> with a specific set of events
        and methods. You can swap implementations freely &mdash; the pipeline
        does not care which provider you use, only that the contract is
        satisfied.
      </p>

      <h3>STTAdapter</h3>

      <p>Streaming speech-to-text. Receives raw PCM audio and emits transcripts.</p>

      <PropTable
        headers={["Event", "Payload", "Description"]}
        rows={[
          [
            "partial",
            "string",
            "Streaming partial transcript. Changes as more speech arrives.",
          ],
          [
            "final",
            "string",
            "Stable, finalized transcript for the completed utterance.",
          ],
          [
            "error",
            "Error",
            "Connection or transcription error.",
          ],
          [
            "close",
            "(none)",
            "WebSocket connection closed.",
          ],
        ]}
      />

      <PropTable
        headers={["Method", "Signature", "Description"]}
        rows={[
          [
            "connect()",
            "() => Promise<void>",
            "Open the connection. Adapter fetches credentials internally via its getToken function.",
          ],
          [
            "sendAudio(pcm)",
            "(pcm: Int16Array) => void",
            "Send a raw PCM chunk (16kHz mono Int16Array).",
          ],
          [
            "flushUtterance()",
            "() => void",
            "Signal end of utterance. Adapter should finalize the current transcript. Called by VAD on speech_end.",
          ],
          [
            "disconnect()",
            "() => void",
            "Close the connection and release resources.",
          ],
        ]}
      />

      <h3>TTSAdapter</h3>

      <p>Streaming text-to-speech. Receives text chunks and emits audio.</p>

      <PropTable
        headers={["Event", "Payload", "Description"]}
        rows={[
          [
            "audio_chunk",
            "Uint8Array",
            "Raw PCM audio chunk (16kHz mono), ready for the AudioPlayer.",
          ],
          [
            "done",
            "(none)",
            "All audio for the current turn has been received.",
          ],
          [
            "error",
            "Error",
            "Connection or synthesis error.",
          ],
        ]}
      />

      <PropTable
        headers={["Method", "Signature", "Description"]}
        rows={[
          [
            "open()",
            "() => Promise<void>",
            "Open the connection. Resolves once the adapter is ready to accept text.",
          ],
          [
            "sendText(text)",
            "(text: string) => void",
            "Send a text chunk for synthesis. Safe to call before open() resolves; adapters queue internally.",
          ],
          [
            "flush()",
            "() => void",
            "Signal end of text stream. Flushes remaining audio. Must be called once after all text is sent.",
          ],
          [
            "destroy()",
            "() => void",
            "Immediately close the connection, dropping any pending audio.",
          ],
        ]}
      />

      <h3>VADAdapter</h3>

      <p>Voice activity detection. Processes audio frames and signals speech boundaries.</p>

      <PropTable
        headers={["Event", "Payload", "Description"]}
        rows={[
          [
            "speech_start",
            "(none)",
            "Speech (possibly tentative) started. Adapters with a minimum-duration filter (Silero) fire this on the first positive frame — it may still be retracted by vad_misfire.",
          ],
          [
            "speech_real_start",
            "(none)",
            "Speech confirmed past the minimum-duration filter — definitely a person talking, not a noise burst. Only from adapters with supportsRealStart. This is the noise-robust barge-in trigger.",
          ],
          [
            "vad_misfire",
            "(none)",
            "A tentative speech_start turned out shorter than the minimum speech duration — treat as noise. Only from adapters with supportsRealStart. When speech gating is on, the buffered audio is discarded.",
          ],
          [
            "speech_end",
            "(none)",
            "User stopped speaking. Triggers STT flush in VAD mode.",
          ],
          [
            "speech_prob",
            "(prob: number)",
            "Per-frame speech probability in [0, 1]. Neural adapters emit the model output; the energy VAD emits a normalized-energy proxy. Useful for level meters and threshold tuning.",
          ],
        ]}
      />

      <PropTable
        headers={["Method / Property", "Signature", "Description"]}
        rows={[
          [
            "process(pcm)",
            "(pcm: Int16Array) => void",
            "Process a PCM frame. Call on every AudioCapture chunk event.",
          ],
          [
            "reset()",
            "() => void",
            "Force reset internal state. Called when interrupting a turn.",
          ],
          [
            "supportsRealStart?",
            "boolean",
            "True when the adapter distinguishes tentative (speech_start) from confirmed (speech_real_start) speech and emits vad_misfire. GloveVoice uses it to gate STT audio and barge-in on confirmed speech only.",
          ],
        ]}
      />

      <h3>Built-in Implementations</h3>

      <PropTable
        headers={["Adapter", "Provider", "Description"]}
        rows={[
          [
            "ElevenLabsSTTAdapter",
            "ElevenLabs Scribe Realtime",
            "WebSocket-based streaming STT using ElevenLabs Scribe v2. Supports partial and committed transcripts with auto-reconnect.",
          ],
          [
            "ElevenLabsTTSAdapter",
            "ElevenLabs Input Streaming",
            "WebSocket-based streaming TTS using ElevenLabs Turbo v2.5. Streams text in, receives PCM audio chunks out.",
          ],
          [
            "VAD (energy-based)",
            "Built-in",
            "Zero-dependency energy-based voice activity detector. Uses RMS energy thresholds. Good for quiet environments.",
          ],
          [
            "SileroVADAdapter",
            "Silero VAD (WASM)",
            "ML-based voice activity detection using ONNX Runtime. Much more accurate in noisy environments. Loaded from glove-voice/silero-vad subpath.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="security">Security: Token-based Auth</h2>

      <p>
        Voice providers like ElevenLabs, Deepgram, and Cartesia authenticate
        via API keys. These keys must never be exposed to the browser. The
        token pattern solves this:
      </p>

      <div style={asciiDiagram}>
{`Browser                     Your Server                Provider API
   |                             |                          |
   |-- GET /api/voice/token ---->|                          |
   |                             |-- POST /token ---------->|
   |                             |   (with API key)         |
   |                             |<-- { token } ------------|
   |<-- { token } --------------|                          |
   |                                                        |
   |-- WebSocket (with token) -------- direct connection -->|`}
      </div>

      <ul>
        <li>
          Your API key never leaves the server. The browser receives a
          short-lived, single-use token that expires after approximately 15
          minutes.
        </li>
        <li>
          The browser connects directly to the provider&apos;s WebSocket using
          the token. Audio streams between browser and provider without
          proxying through your server.
        </li>
        <li>
          If a token is intercepted, it can only be used once and expires
          quickly.
        </li>
      </ul>

      <h3>createVoiceTokenHandler</h3>

      <p>
        Factory function from <code>glove-next</code> that creates a Next.js
        App Router GET handler for generating provider tokens.
      </p>

      <CodeBlock
        code={`function createVoiceTokenHandler(
  config: VoiceTokenHandlerConfig
): (req: Request) => Promise<Response>`}
        language="typescript"
      />

      <h3>VoiceTokenHandlerConfig</h3>

      <p>
        A discriminated union based on the <code>provider</code> field:
      </p>

      <PropTable
        headers={["Provider", "Fields", "Description"]}
        rows={[
          [
            "elevenlabs",
            'type: "stt" | "tts"',
            "ElevenLabs requires separate tokens for STT (realtime_scribe) and TTS (tts_websocket). Create one route for each. Reads ELEVENLABS_API_KEY from env.",
          ],
          [
            "deepgram",
            "ttlSeconds?: number",
            "Deepgram uses a single token for all operations. ttlSeconds controls token lifetime (default: 30). Reads DEEPGRAM_API_KEY from env.",
          ],
          [
            "cartesia",
            "(none)",
            "Cartesia uses a single JWT token. Reads CARTESIA_API_KEY from env.",
          ],
        ]}
      />

      <p>
        All providers accept an optional <code>apiKey</code> field to pass
        the key directly instead of reading from environment variables.
      </p>

      <CodeBlock
        code={`// Override the env var with a direct key
export const GET = createVoiceTokenHandler({
  provider: "elevenlabs",
  type: "stt",
  apiKey: "sk-...",
});`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="vad">VAD: Voice Activity Detection</h2>

      <p>
        VAD determines when the user starts and stops speaking. This controls
        when to flush the STT buffer and commit a turn, and when to trigger
        barge-in during playback.
      </p>

      <h3>Built-in VAD (Energy-based + adaptive)</h3>

      <p>
        The default VAD uses RMS energy thresholds with an{" "}
        <strong>adaptive noise floor</strong> — it tracks the ambient noise
        level and raises its effective threshold above steady background noise,
        so a humming AC or distant chatter stops registering as speech. It has
        zero dependencies, works everywhere, and timing is measured in
        milliseconds (independent of the audio chunk size). When no custom{" "}
        <code>vad</code> is passed to <code>GloveVoice</code>, the built-in VAD
        is used automatically.
      </p>

      <PropTable
        headers={["Parameter", "Default", "Description"]}
        rows={[
          [
            "threshold",
            "0.01",
            "Base RMS energy level to consider as speech. With adaptive on, this is the floor — the effective threshold rises above it in noisy rooms.",
          ],
          [
            "silenceMs",
            "1200 (GloveVoice: 1600)",
            "Trailing silence before speech_end fires. Increase for longer natural pauses.",
          ],
          [
            "minSpeechMs",
            "96",
            "Continuous speech required before speech_start fires. Rejects short noise bursts like keyboard clicks.",
          ],
          [
            "adaptive",
            "true",
            "Track the ambient noise floor and raise the effective threshold above it. In a quiet room, behaves like a fixed threshold.",
          ],
          [
            "noiseFloorMultiplier",
            "3",
            "Effective threshold = max(threshold, noiseFloor × multiplier).",
          ],
        ]}
      />

      <p>
        The legacy chunk-count options <code>silentFrames</code> /{" "}
        <code>speechFrames</code> are still honored (they take precedence when
        set), but prefer the millisecond options — chunk duration depends on the
        audio source, so frame counts were easy to miscalibrate.
      </p>

      <CodeBlock
        code={`import { useGloveVoice } from "glove-react/voice";

// Override VAD sensitivity via vadConfig
const voice = useGloveVoice({
  runnable,
  voice: {
    stt,
    createTTS,
    vadConfig: { silenceMs: 1800, minSpeechMs: 120, threshold: 0.02 },
  },
});`}
        language="typescript"
      />

      <h3>SileroVAD (ML-based)</h3>

      <p>
        For noisy environments or higher accuracy, use SileroVADAdapter. It
        runs a neural network (Silero VAD v5) via ONNX Runtime in the browser
        using WebAssembly. The ML model produces a speech probability score
        for each audio frame, making it far more accurate than energy-based
        detection at distinguishing speech from background noise.
      </p>

      <h4>The WASM Challenge</h4>

      <p>
        SileroVAD depends on <code>@ricky0123/vad-web</code> and{" "}
        <code>onnxruntime-web</code>, which load WASM files in the browser. If
        you import this from the main <code>glove-voice</code> barrel,
        bundlers (Next.js, Vite) try to resolve WASM files at build time and
        may attempt to bundle them for SSR, causing errors.
      </p>

      <p>
        The solution is a separate entry point at{" "}
        <code>glove-voice/silero-vad</code> combined with a dynamic import:
      </p>

      <CodeBlock
        code={`export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}`}
        language="typescript"
      />

      <p>
        Pass the created VAD to the voice config:
      </p>

      <CodeBlock
        code={`const vad = await createSileroVAD();

const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, vad },
});`}
        language="typescript"
      />

      <h4>Next.js Configuration</h4>

      <p>
        When using SileroVAD with Next.js, you need{" "}
        <code>transpilePackages</code> so Next.js processes the glove-voice
        package correctly. The dynamic import ensures the WASM-dependent code
        only loads in the browser.
      </p>

      <CodeBlock
        code={`/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ["glove-voice"],
  serverExternalPackages: ["better-sqlite3"], // only if your StoreAdapter pulls in better-sqlite3
};

export default config;`}
        filename="next.config.ts"
        language="typescript"
      />

      <h4>WASM Loading Modes</h4>

      <PropTable
        headers={["Mode", "Config", "Description"]}
        rows={[
          [
            "CDN (recommended)",
            '{ type: "cdn" }',
            "Loads ONNX Runtime WASM files from jsDelivr CDN. Zero configuration required. Best for most deployments.",
          ],
          [
            "Local",
            '{ type: "local", path: "/onnx/" }',
            "Loads WASM files from your public/ directory. For offline or air-gapped environments. Copy files from node_modules/onnxruntime-web/dist/ to public/onnx/.",
          ],
        ]}
      />

      <h4>Build Warnings</h4>

      <p>
        When building with SileroVAD, you will see warnings like:
      </p>

      <CodeBlock
        code={`⚠ Critical dependency: require function is used in a way
  in which dependencies cannot be statically extracted`}
        language="bash"
      />

      <p>
        These come from <code>onnxruntime-web</code>&apos;s internal dynamic
        require and are harmless. The WASM loading works correctly at runtime.
      </p>

      <h4>Tuning SileroVAD Parameters</h4>

      <PropTable
        headers={["Parameter", "Default", "Description"]}
        rows={[
          [
            "positiveSpeechThreshold",
            "0.5",
            "Speech probability score (0-1) above which a frame is considered speech. This is Silero's recommended operating point — the old 0.3 default was trigger-happy in noise.",
          ],
          [
            "negativeSpeechThreshold",
            "0.35",
            "Speech probability score (0-1) below which a frame is considered silence. Lower values require more definitive silence to end speech detection.",
          ],
          [
            "redemptionMs",
            "1400",
            "Milliseconds of silence allowed within speech before triggering speech_end. Acts as a debounce for brief pauses mid-sentence.",
          ],
          [
            "preSpeechPadMs",
            "800",
            "Milliseconds of audio to include before the detected speech start. Ensures the beginning of utterances is not clipped.",
          ],
          [
            "minSpeechMs",
            "250",
            "Minimum duration of speech in milliseconds. Utterances shorter than this emit vad_misfire (noise burst) — and with speech gating on, their audio is discarded before reaching STT.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="noise-robustness">Noise Robustness &amp; Speech Gating</h2>

      <p>
        The pipeline is built so <strong>only actual speech reaches the STT
        provider</strong> — never ambient noise. Streaming the raw mic feed to
        STT 24/7 means keyboards, traffic, and music get transcribed (or
        hallucinated into words) and billed. Three layers prevent that:
      </p>

      <ol>
        <li>
          <strong>Capture</strong> &mdash; <code>getUserMedia</code> requests{" "}
          <code>echoCancellation</code>, <code>noiseSuppression</code>,{" "}
          <code>autoGainControl</code>, and <code>voiceIsolation</code>{" "}
          (platform voice isolation where the browser supports it; ignored
          elsewhere).
        </li>
        <li>
          <strong>VAD</strong> &mdash; decides what counts as speech. Silero
          (neural) distinguishes speech from arbitrary noise; the built-in
          energy VAD adapts its threshold to the ambient noise floor.
        </li>
        <li>
          <strong>Speech gating</strong> (<code>SpeechGate</code>, on by default
          in VAD mode) &mdash; mic audio is held in a rolling pre-roll buffer
          and only released to STT once the VAD <em>confirms</em> a speech
          segment. With Silero, tentative speech shorter than{" "}
          <code>minSpeechMs</code> is a misfire and its audio is discarded
          entirely; barge-in also waits for confirmed speech, so a door slam
          doesn&apos;t cut the agent off mid-sentence.
        </li>
      </ol>

      <PropTable
        headers={["Config", "Default", "Description"]}
        rows={[
          [
            "speechGating",
            "true (VAD mode)",
            "Only forward mic audio to STT during confirmed speech segments. Set false to restore continuous streaming.",
          ],
          [
            "speechGatePrerollMs",
            "800",
            "Pre-roll flushed to STT when a speech segment opens, so the first syllable isn't clipped.",
          ],
          [
            "micConstraints",
            "undefined",
            "Extra getUserMedia constraints merged over the defaults — pick a device, or opt out of a default (e.g. { noiseSuppression: false }).",
          ],
        ]}
      />

      <CodeBlock
        code={`// Gating is on by default — pair it with Silero for the strongest result.
const voice = useGloveVoice({
  runnable,
  voice: {
    stt,
    createTTS,
    vad: await createSileroVAD(),
    // speechGating: true,          // default in VAD mode
    // speechGatePrerollMs: 800,    // default
  },
});`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="turn-modes">Turn Modes</h2>

      <h3>VAD Mode (Default)</h3>

      <p>
        In VAD mode, the pipeline operates hands-free. The VAD continuously
        analyzes audio frames and automatically detects when the user starts
        and stops speaking.
      </p>

      <ul>
        <li>
          <strong>Automatic turn detection</strong> &mdash; When
          the VAD fires <code>speech_end</code>, the STT adapter flushes its
          buffer, emits a <code>final</code> transcript, and the pipeline
          transitions to <code>thinking</code>.
        </li>
        <li>
          <strong>Barge-in</strong> &mdash; When the user speaks during the{" "}
          <code>speaking</code> or <code>thinking</code> modes, the pipeline
          calls <code>interrupt()</code> automatically. This aborts the
          in-flight Glove request, stops TTS playback, clears display slots,
          and returns to <code>listening</code>. With a confirming VAD
          (Silero), barge-in fires on <code>speech_real_start</code> —{" "}
          <em>confirmed</em> speech — rather than the first positive frame, so a
          transient noise burst doesn&apos;t interrupt the agent.
        </li>
        <li>
          <strong>Barge-in protection</strong> &mdash; If a{" "}
          <code>pushAndWait</code> slot is active (for example, a checkout
          form), barge-in is suppressed at the voice layer. The pipeline
          checks <code>displayManager.resolverStore.size</code> and skips
          the interrupt if there are pending resolvers. For full protection,
          combine this with <code>unAbortable: true</code> on the tool so
          it survives abort signals from any source, not just voice.
        </li>
      </ul>

      <CodeBlock
        code={`const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, turnMode: "vad" }, // "vad" is the default
});`}
        language="typescript"
      />

      <h3>Manual Mode (Push-to-Talk)</h3>

      <p>
        In manual mode, the consumer controls turn boundaries. No VAD is
        created. The mic captures audio and sends it to STT continuously, but
        nothing commits the utterance until you call{" "}
        <code>commitTurn()</code>.
      </p>

      <ul>
        <li>
          <strong>Explicit turn commit</strong> &mdash; Call{" "}
          <code>voice.commitTurn()</code> to signal the end of the
          user&apos;s utterance. This flushes the STT buffer and starts agent
          processing.
        </li>
        <li>
          <strong>No automatic barge-in</strong> &mdash; To interrupt a
          response, call <code>voice.interrupt()</code> explicitly.
        </li>
        <li>
          <strong>Use cases</strong> &mdash; Noisy environments where VAD
          would trigger false positives. Applications that need precise
          control over when the agent responds. Push-to-talk UI patterns.
        </li>
      </ul>

      <p>
        For most push-to-talk use cases, <code>useGlovePTT</code> handles all
        of this automatically &mdash; see the{" "}
        <a href="#push-to-talk">Push-to-Talk section</a> below. The following
        is the low-level alternative for reference:
      </p>

      <CodeBlock
        code={`const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, turnMode: "manual" },
});

// Low-level push-to-talk button
<button
  onPointerDown={() => voice.start()}
  onPointerUp={() => voice.commitTurn()}
>
  Hold to talk
</button>`}
        language="tsx"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="push-to-talk">Push-to-Talk (useGlovePTT)</h2>

      <p>
        <code>useGlovePTT</code> is a high-level hook that replaces
        approximately 80 lines of push-to-talk boilerplate with around 5 lines.
        It wraps <code>useGloveVoice</code> and handles:
      </p>

      <ul>
        <li>Pipeline enable/disable (toggle voice on and off)</li>
        <li>Auto-mute on start, unmute on hold, commit + re-mute on release</li>
        <li>Keyboard hotkey binding with input element awareness</li>
        <li>Click-vs-hold discrimination (quick click toggles, hold records)</li>
        <li>Minimum recording duration enforcement</li>
        <li>Pipeline death detection (WebSocket drop, permission revoked)</li>
      </ul>

      <h3>Quick Example</h3>

      <CodeBlock
        code={`import { useGlove, Render } from "glove-react";
import { useGlovePTT, VoicePTTButton } from "glove-react/voice";
import { stt, createTTS } from "@/lib/voice";

function ChatPanel() {
  const glove = useGlove({ endpoint: "/api/chat", tools });
  const ptt = useGlovePTT({
    runnable: glove.runnable,
    voice: { stt, createTTS },
    hotkey: "Space",
  });

  return (
    <>
      <Render glove={glove} voice={ptt} renderInput={() => null} />
      <VoicePTTButton ptt={ptt}>
        {({ enabled, recording, mode }) => (
          <button className={recording ? "recording" : enabled ? "active" : ""}>
            <MicIcon />
          </button>
        )}
      </VoicePTTButton>
    </>
  );
}`}
        language="tsx"
      />

      <h3>UseGlovePTTConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "runnable",
            "IGloveRunnable | null",
            "The Glove runnable instance. Pass useGlove().runnable.",
          ],
          [
            "voice",
            'Omit<GloveVoiceConfig, "turnMode">',
            'Voice pipeline config. turnMode is forced to "manual" and startMuted to true internally.',
          ],
          [
            "hotkey?",
            "string | false",
            'Keyboard hotkey code (default: "Space"). Uses KeyboardEvent.code values. Auto-ignores when focused on INPUT, TEXTAREA, or SELECT. Set to false to disable.',
          ],
          [
            "holdThreshold?",
            "number",
            "Hold duration in ms for click-vs-hold discrimination (default: 300). A quick click toggles voice on/off; a hold triggers PTT recording.",
          ],
          [
            "minRecordingMs?",
            "number",
            "Minimum recording duration in ms before committing a turn (default: 350). If the user releases early, the mic stays hot until the minimum is reached.",
          ],
        ]}
      />

      <h3>UseGlovePTTReturn</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "enabled",
            "boolean",
            "Whether the voice pipeline is active (user toggled voice on).",
          ],
          [
            "recording",
            "boolean",
            "Whether the user is currently holding to record.",
          ],
          [
            "processing",
            "boolean",
            "Whether STT is finalizing after a short recording.",
          ],
          [
            "mode",
            "VoiceMode",
            'Current voice pipeline state: idle, listening, thinking, speaking.',
          ],
          [
            "transcript",
            "string",
            "Current partial transcript while user is speaking.",
          ],
          [
            "error",
            "Error | null",
            "Last error from the voice pipeline.",
          ],
          [
            "toggle()",
            "() => Promise<void>",
            "Toggle the voice pipeline on/off.",
          ],
          [
            "interrupt()",
            "() => void",
            "Barge-in: abort in-flight request and stop TTS.",
          ],
          [
            "bind",
            "{ onPointerDown, onPointerUp, onPointerLeave }",
            "Pointer event handlers to spread onto a mic button. Includes click-vs-hold discrimination.",
          ],
          [
            "voice",
            "UseGloveVoiceReturn",
            "The underlying voice hook return for advanced use cases.",
          ],
        ]}
      />

      <h3>VoicePTTButton</h3>

      <p>
        Headless (unstyled) component with a render prop pattern. Wraps{" "}
        <code>ptt.bind</code> with <code>role=&quot;button&quot;</code>,{" "}
        <code>tabIndex</code>, <code>aria-label</code>,{" "}
        <code>aria-pressed</code>, and touch safety (prevents context menu on
        long press, disables text selection during hold).
      </p>

      <CodeBlock
        code={`import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={ptt} className="mic-button">
  {({ enabled, recording, processing, mode }) => (
    <button className={recording ? "active" : ""}>
      {processing ? <Spinner /> : <MicIcon />}
      {enabled && <StatusDot />}
    </button>
  )}
</VoicePTTButton>`}
        language="tsx"
      />

      <h4>VoicePTTButtonProps</h4>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "ptt",
            "UseGlovePTTReturn",
            "The return value of useGlovePTT().",
          ],
          [
            "children",
            "(props: VoicePTTButtonRenderProps) => ReactNode",
            "Render prop for full styling control. Receives enabled, recording, processing, and mode.",
          ],
          [
            "className?",
            "string",
            "Additional className on the wrapper span.",
          ],
          [
            "style?",
            "React.CSSProperties",
            "Additional style on the wrapper span.",
          ],
        ]}
      />

      <h3>Render Voice Integration</h3>

      <p>
        The <code>&lt;Render&gt;</code> component accepts an optional{" "}
        <code>voice</code> prop to auto-render transcript and voice status.
        This works with both <code>useGlovePTT</code> and{" "}
        <code>useGloveVoice</code> return values:
      </p>

      <CodeBlock
        code={`<Render
  glove={glove}
  voice={ptt}                              // or useGloveVoice() return
  renderTranscript={({ transcript }) => (  // optional custom renderer
    <p className="transcript">{transcript}</p>
  )}
  renderVoiceStatus={({ mode }) => (       // optional custom renderer
    <span className="status">{mode}</span>
  )}
  renderInput={() => null}
/>`}
        language="tsx"
      />

      <p>
        The <code>voice</code> prop accepts a <code>VoiceRenderHandle</code>,
        which is any object with <code>transcript</code>, <code>mode</code>,
        and <code>enabled</code> fields. Both <code>UseGlovePTTReturn</code>{" "}
        and <code>UseGloveVoiceReturn</code> satisfy this interface.
        The optional <code>renderTranscript</code> receives{" "}
        <code>TranscriptRenderProps</code> (with a <code>transcript</code>{" "}
        string), and <code>renderVoiceStatus</code> receives{" "}
        <code>VoiceStatusRenderProps</code> (with a <code>mode</code> value).
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="use-glove-voice">useGloveVoice API Reference</h2>

      <h3>Signature</h3>

      <CodeBlock
        code={`function useGloveVoice(config: UseGloveVoiceConfig): UseGloveVoiceReturn`}
        language="typescript"
      />

      <h3>UseGloveVoiceConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "runnable",
            "IGloveRunnable | null",
            "The Glove runnable instance. Pass useGlove().runnable. When null, start() will throw.",
          ],
          [
            "voice",
            "GloveVoiceConfig",
            "Voice pipeline configuration. Contains the STT adapter, TTS factory, turn mode, optional VAD override, and sample rate.",
          ],
        ]}
      />

      <h3>GloveVoiceConfig</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "stt",
            "STTAdapter",
            "Speech-to-text adapter instance. Any implementation of the STTAdapter contract.",
          ],
          [
            "createTTS",
            "() => TTSAdapter",
            "Factory function that returns a fresh TTS adapter per turn. Must be a factory, not a single instance, because GloveVoice creates a new TTS session for each model response.",
          ],
          [
            "turnMode?",
            '"vad" | "manual"',
            'Turn detection mode. Default: "vad". In "manual" mode, no VAD is used and the consumer calls commitTurn().',
          ],
          [
            "vad?",
            "VADAdapter",
            'Override the VAD implementation. Only used when turnMode is "vad". Pass a SileroVADAdapter for ML-based detection.',
          ],
          [
            "vadConfig?",
            "VADConfig",
            'Configuration for the built-in energy-based VAD. Only used when turnMode is "vad" and no custom vad is provided. Default silenceMs: 1600.',
          ],
          [
            "speechGating?",
            "boolean",
            'Only forward mic audio to STT during confirmed speech segments (default: true in "vad" mode). Background noise never reaches the STT provider. Set false to restore continuous streaming.',
          ],
          [
            "speechGatePrerollMs?",
            "number",
            "Pre-roll audio (ms) flushed to STT when a gated speech segment opens, so the first syllable isn't clipped. Default: 800.",
          ],
          [
            "micConstraints?",
            "MediaTrackConstraints",
            "Extra getUserMedia constraints merged over the defaults (echoCancellation / noiseSuppression / autoGainControl / voiceIsolation). Browser-only. Pick a device or opt out of a default.",
          ],
          [
            "audio?",
            "AudioIO",
            "Platform audio backends (mic capture + PCM playback). Defaults to the browser implementations; pass createNativeAudioIO() from glove-voice-native on React Native / Expo.",
          ],
          [
            "sampleRate?",
            "number",
            "Audio sample rate in Hz. Default: 16000. Must match STT and TTS adapter expectations.",
          ],
          [
            "startMuted?",
            "boolean",
            'Start the pipeline with mic muted. Defaults to true when turnMode is "manual", false otherwise. Eliminates the race condition between start() resolving and calling mute().',
          ],
        ]}
      />

      <h3>UseGloveVoiceReturn</h3>

      <PropTable
        headers={["Property", "Type", "Description"]}
        rows={[
          [
            "mode",
            "VoiceMode",
            'Current voice pipeline state: "idle", "listening", "thinking", or "speaking".',
          ],
          [
            "transcript",
            "string",
            "Current partial transcript while the user is speaking. Cleared when a turn is committed or the pipeline stops.",
          ],
          [
            "isActive",
            "boolean",
            'Whether the voice pipeline is active (mode is not "idle").',
          ],
          [
            "enabled",
            "boolean",
            "Whether the user intended the pipeline to be active. True after start(), false after stop() or pipeline death (WebSocket drop, permission revoked). Unlike isActive, this tracks user intent and auto-resets \u2014 no manual sync useEffect needed.",
          ],
          [
            "error",
            "Error | null",
            "Last error from the voice pipeline. Cleared on the next start() call.",
          ],
          [
            "start()",
            "() => Promise<void>",
            "Start the voice pipeline. Requests microphone permission, connects STT, and begins listening. Throws if runnable is null or mic permission is denied.",
          ],
          [
            "stop()",
            "() => Promise<void>",
            "Stop the voice pipeline. Interrupts any in-progress response, disconnects STT, releases the microphone, and returns to idle.",
          ],
          [
            "interrupt()",
            "() => void",
            "Barge-in. Aborts the in-flight Glove request, stops TTS playback, clears non-blocking display slots, and returns to listening.",
          ],
          [
            "commitTurn()",
            "() => void",
            "Manual turn commit. Flushes the current utterance to STT for finalization. Primary control mechanism in manual turn mode. Also works in VAD mode as an explicit override.",
          ],
          [
            "isMuted",
            "boolean",
            "Whether mic audio is currently muted (not forwarded to STT/VAD). The audio_chunk event still fires when muted.",
          ],
          [
            "mute()",
            "() => void",
            "Stop forwarding mic audio to STT/VAD. The mic stays active and audio_chunk events continue to fire (for visualization). No transcription or VAD detection occurs while muted.",
          ],
          [
            "unmute()",
            "() => void",
            "Resume forwarding mic audio to STT/VAD. Restores normal transcription and voice activity detection.",
          ],
          [
            "narrate(text)",
            "(text: string) => Promise<void>",
            "Speak arbitrary text through TTS without involving the model. Auto-mutes mic during playback. Resolves when all audio finishes playing. Safe to call from pushAndWait tool handlers.",
          ],
        ]}
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="narration-mic-control">Narration &amp; Mic Control</h2>

      <h3>Narrating Display Slots</h3>

      <p>
        Use <code>voice.narrate(text)</code> to speak arbitrary text through TTS
        without sending it to the model. This is useful for reading display slot
        content aloud &mdash; order summaries, confirmation details, or any text
        you want the user to hear.
      </p>

      <p>
        <code>narrate()</code> returns a promise that resolves when all audio
        finishes playing. It creates a fresh TTS adapter per call (same pattern
        as model turns) and auto-mutes the mic during playback to prevent TTS
        audio from feeding back into STT.
      </p>

      <CodeBlock
        code={`const checkout = defineTool({
  name: "checkout",
  unAbortable: true,
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const cart = getCart();

    // Narrate the cart summary before showing the form
    await voice.narrate(
      \`Your order has \${cart.length} items totaling \${formatPrice(total)}.\`
    );

    const result = await display.pushAndWait({ items: cart });
    if (!result) return "Cancelled";

    // Narrate the confirmation
    await voice.narrate("Order placed! You'll receive a confirmation email shortly.");

    cartOps.clear();
    return "Order placed!";
  },
});`}
        language="tsx"
      />

      <p>
        <strong>Key detail:</strong> <code>narrate()</code> is safe to call from{" "}
        <code>pushAndWait</code> tool handlers. When a tool uses{" "}
        <code>pushAndWait</code>, the model is paused waiting for the tool
        result, so there is no concurrent model TTS to conflict with.
      </p>

      <h3>Mute / Unmute</h3>

      <p>
        <code>voice.mute()</code> and <code>voice.unmute()</code> gate mic
        audio forwarding to STT and VAD. When muted, the mic stays active but
        no transcription or speech detection occurs. This is useful for
        temporarily disabling voice input without tearing down the pipeline.
      </p>

      <CodeBlock
        code={`<button onClick={voice.isMuted ? voice.unmute : voice.mute}>
  {voice.isMuted ? "Unmute" : "Mute"}
</button>`}
        language="tsx"
      />

      <h3>Audio Visualization</h3>

      <p>
        The <code>audio_chunk</code> event on the underlying{" "}
        <code>GloveVoice</code> instance emits raw <code>Int16Array</code> PCM
        data from the mic, even when muted. Use this for waveform or audio
        level visualization:
      </p>

      <CodeBlock
        code={`// Listen to audio_chunk on the GloveVoice instance for visualization
voice.on("audio_chunk", (pcm: Int16Array) => {
  // Compute RMS level for a simple meter
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const level = Math.sqrt(sum / pcm.length) / 32768;
  updateMeter(level);
});`}
        language="typescript"
      />

      {/* ------------------------------------------------------------------ */}
      <h2 id="voice-first-tool-design">Voice-First Tool Design</h2>

      <p>
        Tools built for voice agents have different design considerations
        than text-based tools. Voice users cannot click buttons or fill forms
        while speaking, and the model&apos;s response text gets spoken aloud.
      </p>

      <h3>Use pushAndForget for Information Display</h3>

      <p>
        In voice-first apps, use <code>pushAndForget</code> instead of{" "}
        <code>pushAndWait</code> for tools that display information. Voice
        users see the visual result while hearing the narration, but they do
        not need to interact with it to continue the conversation.
      </p>

      <CodeBlock
        code={`const showMenuTool: ToolConfig<{ items: MenuItem[] }> = {
  name: "show_menu",
  description: "Display menu items to the user.",
  inputSchema: z.object({
    items: z.array(z.object({
      name: z.string(),
      price: z.number(),
      description: z.string(),
    })),
  }),
  async do(input, display) {
    await display.pushAndForget({ items: input.items });
    // Return concise text for the model to narrate
    return {
      status: "success",
      data: input.items
        .map(i => \`\${i.name} for $\${i.price.toFixed(2)}\`)
        .join(", "),
    };
  },
  render({ data }) {
    return <MenuCard items={data.items} />;
  },
};`}
        language="tsx"
      />

      <h3>Return Concise Data for Narration</h3>

      <p>
        The <code>data</code> field in your tool result is what the model sees
        and narrates. Keep it short and descriptive. Avoid returning raw JSON
        or lengthy details &mdash; the model will try to speak all of it.
      </p>

      <h3>Dynamic System Prompt for Voice</h3>

      <p>
        Append voice-specific instructions to your system prompt when voice
        is active. This tells the model to keep responses short and
        conversational:
      </p>

      <CodeBlock
        code={`const basePrompt = "You are a helpful barista assistant.";

const voiceInstructions = \`
Voice mode is active. The user is speaking to you.
- Keep responses under 2 sentences
- Describe tool results concisely
- Use natural conversational language
- Do not use markdown, lists, or formatting
\`;

function ChatApp() {
  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  const systemPrompt = voice.isActive
    ? basePrompt + voiceInstructions
    : basePrompt;

  const glove = useGlove({ systemPrompt, tools, sessionId });
  // ...
}`}
        language="tsx"
      />

      <h3>pushAndWait and unAbortable in Voice Apps</h3>

      <p>
        Full barge-in protection for mutation-critical tools (like a checkout
        form) requires <strong>two layers</strong>:
      </p>

      <ol>
        <li>
          <strong>Voice layer (barge-in suppression):</strong> When a{" "}
          <code>pushAndWait</code> resolver is pending, GloveVoice checks{" "}
          <code>displayManager.resolverStore.size &gt; 0</code> and skips{" "}
          <code>interrupt()</code> entirely. The barge-in never fires.
        </li>
        <li>
          <strong>Core layer (abort resistance):</strong> Setting{" "}
          <code>unAbortable: true</code> on the tool makes glove-core run it
          to completion even if the abort signal fires. This protects against
          programmatic interrupts, not just voice.
        </li>
      </ol>

      <p>
        <strong>Important:</strong> <code>pushAndWait</code> alone does{" "}
        <em>not</em> make a tool survive an abort signal. It only suppresses
        the voice barge-in trigger. If <code>interrupt()</code> is called by
        other means, only <code>unAbortable: true</code> guarantees the tool
        runs to completion. Use both together for tools that perform mutations.
      </p>

      <CodeBlock
        code={`const checkout = defineTool({
  name: "checkout",
  unAbortable: true,              // Layer 2: survives abort signals
  displayStrategy: "hide-on-complete",
  async do(_input, display) {
    const result = await display.pushAndWait({ items });  // Layer 1: suppresses voice barge-in
    if (!result) return "Cancelled";
    cartOps.clear();              // Safe — tool guaranteed to complete
    return "Order placed!";
  },
});`}
        language="tsx"
      />

      <p>
        Use <code>pushAndWait</code> sparingly in voice-first apps &mdash;
        only for actions that genuinely require explicit user confirmation.
        For display-only tools, always prefer <code>pushAndForget</code> so
        barge-in works naturally.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="react-native">React Native &amp; Expo (glove-voice-native)</h2>

      <p>
        The voice pipeline is platform-neutral — VAD, speech gating, STT/TTS
        adapters, barge-in, and narration are plain TypeScript. Only the edges
        touch the platform: the microphone and the speaker. Those are injected
        via <code>GloveVoiceConfig.audio</code> (an <code>AudioIO</code>), which
        defaults to the browser implementations. On React Native / Expo, install{" "}
        <code>glove-voice-native</code> and pass its audio backends — everything
        else runs unchanged.
      </p>

      <CodeBlock
        code={`npx expo install react-native-audio-api
pnpm add glove-voice glove-voice-native

# Optional — neural VAD (recommended) + model caching:
pnpm add onnxruntime-react-native
npx expo install expo-file-system`}
        language="bash"
      />

      <p>
        These are <strong>native modules</strong> — they run in an Expo dev
        client / <code>expo prebuild</code> build, not Expo Go. Add the mic
        permission via <code>react-native-audio-api</code>&apos;s config plugin
        in <code>app.json</code>:
      </p>

      <CodeBlock
        code={`{
  "expo": {
    "plugins": [
      [
        "react-native-audio-api",
        {
          "iosMicrophonePermission": "This app uses the microphone to talk to the assistant.",
          "androidPermissions": [
            "android.permission.RECORD_AUDIO",
            "android.permission.MODIFY_AUDIO_SETTINGS"
          ]
        }
      ]
    ]
  }
}`}
        filename="app.json"
        language="json"
      />

      <p>
        Usage is one line different from the web — the DOM-free{" "}
        <code>useGloveVoice</code> / <code>useGlovePTT</code> hooks work on RN
        directly:
      </p>

      <CodeBlock
        code={`import { useGloveVoice } from "glove-react/voice";
import { createElevenLabsAdapters } from "glove-voice";
import { createNativeAudioIO, withNativeAudio } from "glove-voice-native";
import { SileroVADNativeAdapter } from "glove-voice-native/silero-vad";

// Silero v5 on onnxruntime-react-native — same confirmed-speech lifecycle
// as the browser adapter, so speech gating + noise-robust barge-in work
// identically on-device. Downloads + caches the model on first run.
const vad = new SileroVADNativeAdapter();
await vad.init();

function VoiceScreen() {
  const glove = useGlove({ endpoint, systemPrompt, tools });
  const voice = useGloveVoice({
    runnable: glove.runnable,
    // withNativeAudio() attaches createNativeAudioIO() for you:
    voice: withNativeAudio({ stt, createTTS, vad }),
  });

  return <Button title={voice.mode} onPress={voice.enabled ? voice.stop : voice.start} />;
}`}
        language="tsx"
      />

      <PropTable
        headers={["Export", "From", "Description"]}
        rows={[
          [
            "createNativeAudioIO()",
            "glove-voice-native",
            "Builds the AudioIO (mic capture + PCM playback) for GloveVoiceConfig.audio.",
          ],
          [
            "withNativeAudio(config)",
            "glove-voice-native",
            "Convenience wrapper — returns the voice config with native audio IO attached.",
          ],
          [
            "NativeAudioCapture",
            "glove-voice-native",
            "On-device mic capture via react-native-audio-api's AudioRecorder. Handles permissions and configures the iOS session for full-duplex voice chat (OS echo cancellation).",
          ],
          [
            "NativeAudioPlayer",
            "glove-voice-native",
            "Gapless streaming PCM playback on react-native-audio-api's Web Audio implementation.",
          ],
          [
            "SileroVADNativeAdapter",
            "glove-voice-native/silero-vad",
            "Silero VAD v5 on onnxruntime-react-native. Separate entry so the ORT dependency stays optional; the energy VAD from glove-voice is the zero-native-dep fallback.",
          ],
        ]}
      />

      <p>
        The ElevenLabs STT/TTS adapters run unchanged on RN (WebSocket + pure-JS
        base64 — no <code>btoa</code>/<code>atob</code>). Full setup details are
        in the <code>glove-voice-native</code> README.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="common-gotchas">Common Gotchas</h2>

      <h3>1. SileroVAD Must Be Dynamically Imported</h3>

      <p>
        Never import <code>glove-voice/silero-vad</code> at module level in
        a Next.js or SSR environment. The WASM dependencies will fail during
        server-side rendering. Always use{" "}
        <code>await import(&quot;glove-voice/silero-vad&quot;)</code> inside
        a function that only runs in the browser.
      </p>

      <h3>2. Empty Committed Transcripts</h3>

      <p>
        ElevenLabs Scribe sometimes returns an empty committed transcript for
        very short utterances like &ldquo;No&rdquo; or &ldquo;Hi&rdquo;. The{" "}
        <code>ElevenLabsSTTAdapter</code> handles this automatically by
        falling back to the last partial transcript. You do not need to handle
        this case yourself.
      </p>

      <h3>3. TTS Idle Timeout</h3>

      <p>
        ElevenLabs WebSocket connections disconnect after approximately 20
        seconds of inactivity. This can happen during tool execution when no
        text is being sent. GloveVoice handles this by closing the TTS
        session after each <code>model_response_complete</code> event and
        opening a fresh one when the next <code>text_delta</code> arrives.
      </p>

      <h3>4. Barge-in Protection Requires unAbortable</h3>

      <p>
        A pending <code>pushAndWait</code> resolver suppresses voice barge-in
        at the trigger level, but does <em>not</em> protect the tool from
        abort signals. For mutation-critical tools, always set{" "}
        <code>unAbortable: true</code> alongside <code>pushAndWait</code> to
        guarantee the tool runs to completion. See the{" "}
        <a href="#voice-first-tools">pushAndWait and unAbortable</a> section
        above for the full two-layer explanation.
      </p>

      <h3>5. Microphone Permission</h3>

      <p>
        <code>voice.start()</code> requests microphone permission. If the
        user denies it, the call throws an error. Handle this and show an
        appropriate message:
      </p>

      <CodeBlock
        code={`async function handleVoiceToggle() {
  try {
    if (voice.isActive) {
      await voice.stop();
    } else {
      await voice.start();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Permission")) {
      alert("Microphone access is required for voice mode.");
    }
  }
}`}
        language="typescript"
      />

      <h3>6. Model Provider Matters</h3>

      <p>
        Voice responses should be short and conversational. Instruct the LLM
        in the system prompt: &ldquo;Keep voice responses under 2 sentences.
        Describe results concisely.&rdquo; Without this guidance, the model
        may generate long, formatted responses that sound unnatural when
        spoken aloud.
      </p>

      <h3>7. createTTS Must Be a Factory</h3>

      <p>
        GloveVoice calls <code>createTTS()</code> to get a fresh TTS adapter
        for each model response within a turn. Do not pass a single adapter
        instance &mdash; it will fail on the second response because the
        WebSocket connection is already closed. Always pass a factory function:
      </p>

      <CodeBlock
        code={`// Correct: factory function
voice: { stt, createTTS: () => new ElevenLabsTTSAdapter({ getToken, voiceId }) }

// Wrong: single instance
voice: { stt, createTTS: new ElevenLabsTTSAdapter({ getToken, voiceId }) }`}
        language="typescript"
      />

      <h3>8. Audio Sample Rate</h3>

      <p>
        All adapters must agree on the audio format. The default is 16kHz
        mono PCM (<code>Int16Array</code> for capture/STT,{" "}
        <code>Uint8Array</code> for TTS playback). Do not change the sample
        rate unless your provider requires something different, and if you do,
        set <code>sampleRate</code> in <code>GloveVoiceConfig</code> to match.
      </p>

      <h3>9. narrate() Auto-Mutes the Mic</h3>

      <p>
        <code>voice.narrate()</code> automatically mutes the mic during
        playback to prevent TTS audio from feeding back into STT/VAD. It
        restores the previous mute state when done. If you were already muted
        before calling <code>narrate()</code>, you will remain muted afterward.
      </p>

      <h3>10. narrate() Requires a Started Pipeline</h3>

      <p>
        Calling <code>narrate()</code> before <code>voice.start()</code> throws
        an error because the TTS factory and AudioPlayer are not yet
        initialized. Always ensure the voice pipeline is active before
        narrating.
      </p>

      <h3>11. onnxruntime-web Version Pinning</h3>

      <p>
        If you see WASM loading errors when using SileroVAD, check that
        your <code>onnxruntime-web</code> version matches what{" "}
        <code>@ricky0123/vad-web</code> expects. The Glove monorepo
        pins <code>onnxruntime-web@^1.22.0</code> alongside{" "}
        <code>@ricky0123/vad-web@^0.0.30</code>. Version mismatches between
        the ONNX Runtime WASM files and the JavaScript API will cause
        cryptic loading failures.
      </p>

      <h3>12. Voice Auto-Silences During Compaction</h3>

      <p>
        When context compaction is triggered, the core emits{" "}
        <code>compaction_start</code> and <code>compaction_end</code> observer
        events. The voice pipeline listens for these and ignores all{" "}
        <code>text_delta</code> events while compaction is in progress. This
        means the compaction summary is never narrated through TTS. No action
        is needed on your part &mdash; this is handled automatically by{" "}
        <code>GloveVoice</code>.
      </p>

      <h3>13. SileroVAD Not Needed for Manual Mode</h3>

      <p>
        When using <code>turnMode: &quot;manual&quot;</code> (push-to-talk),
        you do not need to import SileroVAD or set up any VAD at all. VAD is
        only used in <code>turnMode: &quot;vad&quot;</code>. Skip the WASM
        overhead for PTT-only apps.
      </p>

      <h3>14. Render Ships a Default Input</h3>

      <p>
        The <code>&lt;Render&gt;</code> component includes a built-in text
        input. If you have your own input form, always pass{" "}
        <code>renderInput={`{() => null}`}</code> to suppress the built-in
        one &mdash; otherwise you get duplicate inputs.
      </p>

      <h3>15. Tools Execute Outside React</h3>

      <p>
        Tool <code>do()</code> functions run outside the React component tree.
        To access React context (for example, a wallet hook or theme), use a
        mutable singleton ref synced from a React component (bridge pattern):
      </p>

      <CodeBlock
        code={`// bridge.ts
export const voiceBridge = { current: null as GloveVoiceReturn | null };

// In your component:
useEffect(() => {
  voiceBridge.current = voice;
}, [voice]);

// In your tool:
async do(input, display) {
  await voiceBridge.current?.narrate("Processing...");
}`}
        language="typescript"
      />
    </div>
  );
}
