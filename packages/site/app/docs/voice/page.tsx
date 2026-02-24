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
{`Mic  -->  VAD  -->  STT  -->  Glove  -->  TTS  -->  Speaker
         |                     |
    speech boundary      processRequest()
    detection            (tools, display stack,
                          context, compaction)`}
      </div>

      <p>
        The voice system is split across three packages, each with a specific
        responsibility:
      </p>

      <ul>
        <li>
          <strong>glove-voice</strong> &mdash; The pipeline engine.
          Contains <code>GloveVoice</code>, adapter contracts (STT, TTS, VAD),
          built-in implementations (ElevenLabs adapters, energy-based VAD),
          audio capture, and audio playback.
        </li>
        <li>
          <strong>glove-react/voice</strong> &mdash; The React hook.
          Provides <code>useGloveVoice</code> which wraps{" "}
          <code>GloveVoice</code> in React state management with proper
          lifecycle cleanup.
        </li>
        <li>
          <strong>glove-next</strong> &mdash; Token route handlers.
          Provides <code>createVoiceTokenHandler</code> for creating Next.js
          API routes that generate short-lived provider tokens, keeping your
          API keys on the server.
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
            "User started speaking.",
          ],
          [
            "speech_end",
            "(none)",
            "User stopped speaking. Triggers STT flush in VAD mode.",
          ],
        ]}
      />

      <PropTable
        headers={["Method", "Signature", "Description"]}
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

      <h3>Built-in VAD (Energy-based)</h3>

      <p>
        The default VAD uses RMS energy thresholds. It has zero dependencies,
        works everywhere, and is effective in quiet environments. When no
        custom <code>vad</code> is passed to <code>GloveVoice</code>, the
        built-in VAD is used automatically.
      </p>

      <PropTable
        headers={["Parameter", "Default", "Description"]}
        rows={[
          [
            "threshold",
            "0.01",
            "RMS energy level to consider as speech. Higher values require louder speech.",
          ],
          [
            "silentFrames",
            "15 (~600ms)",
            "Consecutive silent frames before speech_end fires. Increase for longer natural pauses. GloveVoice defaults to 40 (~1600ms).",
          ],
          [
            "speechFrames",
            "3",
            "Consecutive speech frames before speech_start fires. Avoids false triggers from brief noises.",
          ],
        ]}
      />

      <CodeBlock
        code={`import { useGloveVoice } from "glove-react/voice";

// Override VAD sensitivity via vadConfig
const voice = useGloveVoice({
  runnable,
  voice: {
    stt,
    createTTS,
    vadConfig: { silentFrames: 60, threshold: 0.02 },
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
  serverExternalPackages: ["better-sqlite3"], // if using SqliteStore
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
            "0.3",
            "Speech probability score (0-1) above which a frame is considered speech. Higher values mean less sensitivity and fewer false triggers.",
          ],
          [
            "negativeSpeechThreshold",
            "0.25",
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
            "100",
            "Minimum duration of speech in milliseconds. Utterances shorter than this are treated as misfires.",
          ],
        ]}
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
          and returns to <code>listening</code>.
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

      <CodeBlock
        code={`const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, turnMode: "manual" },
});

// Push-to-talk button
<button
  onPointerDown={() => voice.start()}
  onPointerUp={() => voice.commitTurn()}
>
  Hold to talk
</button>`}
        language="tsx"
      />

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
            'Configuration for the built-in energy-based VAD. Only used when turnMode is "vad" and no custom vad is provided. Default silentFrames: 40 (~1600ms).',
          ],
          [
            "sampleRate?",
            "number",
            "Audio sample rate in Hz. Default: 16000. Must match STT and TTS adapter expectations.",
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
    </div>
  );
}
