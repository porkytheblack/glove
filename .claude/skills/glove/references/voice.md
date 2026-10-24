# Voice: pipelines, realtime speech, avatars and LiveKit

> Read when an agent talks: glove-voice (VAD → STT → agent → TTS), push-to-talk, React Native, glove-voice-s2s realtime models, GPT-Live, avatars and LiveKit rooms.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Voice Integration (`glove-voice`)

### Package Overview

| Package | Purpose | Install |
|---------|---------|---------|
| `glove-voice` | Voice pipeline: `GloveVoice`, adapters (STT/TTS/VAD), `AudioCapture`, `AudioPlayer`, `SpeechGate`, `AudioIO` platform seam | `pnpm add glove-voice` |
| `glove-voice-native` | React Native / Expo audio backends: `NativeAudioCapture`, `NativeAudioPlayer`, `createNativeAudioIO`, `SileroVADNativeAdapter` (subpath `/silero-vad`). Native modules: `react-native-audio-api` (required peer), `onnxruntime-react-native` + `expo-file-system` (optional, for neural VAD). Dev client / prebuild only — not Expo Go. | `pnpm add glove-voice-native` |
| `glove-react/voice` | React hooks: `useGloveVoice`, `useGlovePTT`, `VoicePTTButton` (DOM-free — usable in React Native too) | Included in `glove-react` |
| `glove-next` | Token handlers: `createVoiceTokenHandler` (already in `glove-next`, no separate import) | Included in `glove-next` |
| `glove-voice-s2s` | Speech-to-speech: `RealtimeAgent`, `s2sDrivenModel`, `createS2SAdapter`, typed turn-taking knobs (see "Speech-to-Speech, Avatars & LiveKit" below) | workspace |
| `glove-voice-avatar` | Live avatars over the S2S stack: `AvatarAdapter`, `TavusEchoAdapter`, `AnamPassthroughAdapter`, `attachAvatar` | workspace |
| `glove-voice-livekit` | LiveKit transport + LiveKit avatars: `LiveKitTransport`, `attachRealtime`, `TavusLiveKitAvatar`, `AnamLiveKitAvatar`, token minting | workspace |

### Architecture

```
Mic → VAD → STTAdapter → glove.processRequest() → TTSAdapter → Speaker
```

`GloveVoice` wraps a Glove instance with a full-duplex voice pipeline. Glove remains the intelligence layer — all tools, display stack, and context management work normally. STT and TTS are swappable adapters. Text tokens stream through a `SentenceBuffer` into TTS in real-time.

### Choosing a voice architecture

Guide: https://glove.dterminal.net/docs/voice-architectures. Four shapes:

- **Single-agent pipeline** (`GloveVoice` / `useGloveVoice`): one agent behind STT → model → TTS. Least code; every `text_delta` is spoken; a slow tool is dead air.
- **Single-agent realtime** (`RealtimeAgent` + `s2sDrivenModel`): a speech-to-speech model hears, speaks and calls tools. Lowest latency; tools run without an Executor (`requiresPermission` is not enforced, `pushAndWait` throws).
- **Layered, realtime front**: an S2S front agent keeps talking and delegates work to a text worker over `glove-mesh` (`blocking: true` send), and the worker's reply is spoken with `rt.inject("<worker-result>…</worker-result>", { respond: true })`.
- **Layered, pipeline front**: STT → a fast text front model → TTS, delegating to a heavy worker. The front speaks an acknowledgement in the same turn as the delegation; a later relay turn speaks the result.

For a pipeline front, the recommended pattern is `<speech>` tags: prompt the front agent that only text inside `<speech>…</speech>` is heard, parse its stream yourself, and send only in-tag text to TTS, so audio starts on the first spoken token and notes stay silent. This is an application pattern, not a `glove-voice` option (it depends on prompting the agent): `GloveVoice` has no pre-TTS filter, so feed TTS from a subscriber. Reference parser: `examples/layered-voice/app/lib/server/speech-parser.ts`. Choose a front model for time to first spoken token and instruction following, not capability; routing alone moved one model from 979 ms to 160 ms TTFT.

### Quick Start (Next.js + ElevenLabs)

**Step 1: Token routes** — server-side handlers that exchange your API key for short-lived tokens

```typescript
// app/api/voice/stt-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
```

```typescript
// app/api/voice/tts-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
```

Set `ELEVENLABS_API_KEY` in `.env.local`.

**Step 2: Client voice config**

```typescript
// app/lib/voice.ts
import { createElevenLabsAdapters } from "glove-voice";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = await res.json();
  return data.token;
}

export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});
```

**Step 3: SileroVAD** — dynamic import for SSR safety

```typescript
export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}
```

**Step 4: React hook**

```tsx
const { runnable } = useGlove({ tools, sessionId });
const voice = useGloveVoice({ runnable, voice: { stt, createTTS, vad } });
// voice.mode, voice.isActive, voice.isMuted, voice.error, voice.transcript
// voice.start(), voice.stop(), voice.interrupt(), voice.commitTurn()
// voice.mute(), voice.unmute()              — gate mic audio to STT/VAD
// voice.narrate("text")                     — speak text via TTS without model (returns Promise)
```

### `startMuted` Config Option

In manual (push-to-talk) mode, the pipeline now starts muted by default — no need to call `mute()` immediately after `start()`. This eliminates the race condition where audio leaks in the gap.

```typescript
// Manual mode auto-mutes — just works
await voice.start(); // already muted in manual mode

// Explicit override
const voice = useGloveVoice({
  runnable,
  voice: { stt, createTTS, turnMode: "manual", startMuted: false }, // opt out
});
```

### `enabled` State on `useGloveVoice`

The hook now exposes `voice.enabled` — tracks user intent (true after `start()`, false after `stop()` or pipeline death). Replaces the manual `useState` + sync `useEffect` pattern:

```tsx
// Before — consumer tracks + syncs
const [voiceEnabled, setVoiceEnabled] = useState(false);
useEffect(() => {
  if (voiceEnabled && !voice.isActive) setVoiceEnabled(false);
}, [voiceEnabled, voice.isActive]);

// After — hook tracks it
voice.enabled  // auto-resets on pipeline death
```

### `useGlovePTT` Hook (Push-to-Talk)

High-level hook that encapsulates the entire PTT lifecycle. Reduces ~80 lines of boilerplate to ~5 lines:

```tsx
import { useGlovePTT } from "glove-react/voice";

const glove = useGlove({ endpoint: "/api/chat", tools });
const ptt = useGlovePTT({
  runnable: glove.runnable,
  voice: { stt, createTTS },    // turnMode forced to "manual"
  hotkey: "Space",               // default, auto-guards INPUT/TEXTAREA
  holdThreshold: 300,            // click-vs-hold discrimination (ms)
  minRecordingMs: 350,           // min audio before committing
});

// ptt.enabled      — is the pipeline active
// ptt.recording    — is the user currently holding
// ptt.processing   — is STT finalizing
// ptt.mode         — voice mode (idle/listening/thinking/speaking)
// ptt.transcript   — partial transcript while recording
// ptt.error        — last error
// ptt.toggle()     — enable/disable the pipeline
// ptt.interrupt()  — barge-in
// ptt.bind         — { onPointerDown, onPointerUp, onPointerLeave }

<button {...ptt.bind}><MicIcon /></button>
```

### `<VoicePTTButton>` Component

Headless (unstyled) component with render prop for the mic button:

```tsx
import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={ptt}>
  {({ enabled, recording, mode }) => (
    <button className={recording ? "active" : ""}>
      <MicIcon />
      {enabled && <StatusDot />}
    </button>
  )}
</VoicePTTButton>
```

Includes click-vs-hold discrimination, pointer leave safety, and aria attributes.

### `<Render>` Voice Support

`<Render>` accepts an optional `voice` prop to auto-render transcript and voice status:

```tsx
<Render
  glove={glove}
  voice={ptt}                    // or useGloveVoice() return
  renderTranscript={...}         // optional custom renderer
  renderVoiceStatus={...}        // optional custom renderer
  renderInput={() => null}
/>
```

### Turn Modes

| Mode | Behavior | Use for |
|------|----------|---------|
| `"vad"` (default) | Auto speech detection + barge-in | Hands-free, voice-first apps |
| `"manual"` | Push-to-talk, explicit `commitTurn()` | Noisy environments, precise control |

### Noise Robustness (speech gating)

In `"vad"` mode, mic audio is **speech-gated by default** (`speechGating: true`): audio is held in a rolling pre-roll buffer (`speechGatePrerollMs`, default 800ms) and only released to the STT provider once the VAD confirms a speech segment — background noise never reaches STT, so it can't be transcribed or hallucinated into words. With `SileroVADAdapter` (which declares `supportsRealStart: true`):

- The gate opens on `speech_real_start` (speech survived `minSpeechMs`, default 250ms) — short noise bursts are reported as `vad_misfire` and their audio is **discarded entirely**.
- Barge-in also triggers on `speech_real_start`, so a door slam doesn't interrupt agent speech.
- All VAD adapters emit `speech_prob` per frame (model probability, or an energy proxy for the built-in `VAD`) — use for level meters / threshold tuning.

The built-in energy `VAD` is time-based (`silenceMs`, `minSpeechMs` — chunk-size independent) with an **adaptive noise floor** (`adaptive: true` by default) that raises the effective threshold above steady background noise. `AudioCapture` requests `voiceIsolation` alongside the standard constraints; override any of them via `GloveVoiceConfig.micConstraints`. Set `speechGating: false` to restore continuous STT streaming.

### React Native / Expo (`glove-voice-native`)

The pipeline is platform-neutral; only mic capture and speaker playback are platform edges, injected via `GloveVoiceConfig.audio` (an `AudioIO` — defaults to the browser implementations). On React Native / Expo:

```ts
import { createNativeAudioIO, withNativeAudio } from "glove-voice-native";
import { SileroVADNativeAdapter } from "glove-voice-native/silero-vad";

const vad = new SileroVADNativeAdapter();   // Silero v5 on onnxruntime-react-native
await vad.init();                            // downloads + caches model (expo-file-system)

const voice = useGloveVoice({
  runnable,
  voice: withNativeAudio({ stt, createTTS, vad }),  // or { ..., audio: createNativeAudioIO() }
});
```

- Backed by `react-native-audio-api` (Software Mansion): `AudioRecorder` for capture, Web Audio implementation for playback. Its Expo config plugin handles mic permissions (`iosMicrophonePermission`, `androidPermissions: ["android.permission.RECORD_AUDIO", ...]`).
- `NativeAudioCapture` configures the iOS session as `playAndRecord` + `voiceChat` mode → OS echo cancellation (the native equivalent of the browser's `echoCancellation` constraint).
- The ElevenLabs STT/TTS adapters run unchanged on RN (WebSocket + pure-JS base64 — no `btoa`/`atob`).
- Native modules → requires an Expo dev client / `expo prebuild`, NOT Expo Go.
- The energy VAD from `glove-voice` is the zero-native-dep fallback when `onnxruntime-react-native` isn't wanted.

### Narration + Mic Control

- **`voice.narrate(text)`** — Speak arbitrary text through TTS without the model. Resolves when audio finishes. Auto-mutes mic during narration. Abortable via `interrupt()`. Safe to call from `pushAndWait` tool handlers.
- **`voice.mute()` / `voice.unmute()`** — Gate mic audio forwarding to STT/VAD. `audio_chunk` events still fire when muted (for visualization).
- **`audio_chunk` event** — Raw `Int16Array` PCM from the mic, emitted even when muted. Use for waveform/level visualization.
- **Compaction silence** — Voice automatically ignores `text_delta` during context compaction so the summary is never narrated.

### Voice-First Tool Design

- **Use `pushAndForget` instead of `pushAndWait`** — blocking tools that wait for clicks are unusable in voice mode
- **Return descriptive text in `data`** — the LLM reads it to formulate spoken responses
- **Add a voice-specific system prompt** — instruct the agent to narrate results concisely
- **Use `narrate()` for slot narration** — read display content aloud from within tool handlers

### Supported Voice Providers

| Provider | Token Handler Config | Env Variable |
|----------|---------------------|--------------|
| ElevenLabs | `{ provider: "elevenlabs", type: "stt" \| "tts" }` | `ELEVENLABS_API_KEY` |
| Deepgram | `{ provider: "deepgram" }` | `DEEPGRAM_API_KEY` |
| Cartesia | `{ provider: "cartesia" }` | `CARTESIA_API_KEY` |

## Speech-to-Speech, Avatars & LiveKit

The cascade pipeline above (`glove-voice`) is one of two voice paths. The other runs the agent DIRECTLY on a realtime speech-to-speech model — no STT/TTS, the model is the voice:

```typescript
import { RealtimeAgent, s2sDrivenModel } from "glove-voice-s2s";

const agent = new Glove({
  store,
  // The model slot CARRIES the realtime config — the agent definition is the
  // single source of truth; RealtimeAgent derives the provider session from it.
  model: s2sDrivenModel({
    label: "s2s-front",
    provider: "openai",              // or "gemini"
    apiKey: process.env.OPENAI_API_KEY!,
    // model/voice optional — defaults: gpt-realtime + marin / models/gemini-3.1-flash-live-preview + Puck
    turnDetection: { type: "server_vad", silence_duration_ms: 450, prefix_padding_ms: 300 }, // snappy barge-in
  }),
  displayManager: new Displaymanager(),
  systemPrompt: "...",
  serverMode: true,
}).fold({ /* tools work normally */ });

const rt = new RealtimeAgent({ agent });   // derives the adapter from the model slot
await rt.start();
rt.sendAudio(pcm);                          // caller mic in (Int16Array at rt.adapter.inputFormat.sampleRate)
rt.adapter.on("audio", (pcm, fmt) => {});   // agent speech out (24 kHz)
rt.adapter.on("interrupted", () => {});     // barge-in — flush your playback
rt.inject("<text>", { respond: true });     // typed lines / worker results into the live session
```

The proven layering (examples/s2s-rooms onward): the S2S model is a THIN front agent; heavy lookups delegate to a capable worker over `glove-mesh`, and each call is a station signal run.

**Avatars** are a rendering layer over that stack — PCM in, a talking face on a WebRTC surface. `AvatarAdapter` implementations: `TavusEchoAdapter` (Tavus echo PAL + Daily room; `sendInteraction` courier required — Tavus interactions are Daily-data-channel-only), `AnamPassthroughAdapter` (Anam passthrough persona; browser SDK owns the audio input so a `sendCommand` courier is required; Anam's plan cap force-ends sessions every few minutes below Growth tier — hosts renew with `disconnect()`+`connect()` and re-attach the client). One call wires it: `const detach = await attachAvatar(rt, avatar)` (audio → sendAudio, speech-stop → endUtterance, interrupted → interrupt).

**LiveKit** (`glove-voice-livekit`) replaces the hand-rolled audio duct with WebRTC both ways: `LiveKitTransport` + `attachRealtime(rt, transport)` for the voice leg (browser shrinks to `Room.connect` + `setMicrophoneEnabled`; barge-in is server-side `clear()`), and `TavusLiveKitAvatar`/`AnamLiveKitAvatar` for faces — the provider's worker joins YOUR room as a participant (mint its token with `mintAvatarToken`, identity `TAVUS_AVATAR_IDENTITY`/`ANAM_AVATAR_IDENTITY`, `onBehalfOf` the agent) and is fed over the `lk.audio_stream` byte stream; with an avatar attached set `publishAgentAudio: false` (the worker publishes the voice on the agent's behalf — don't double it).

### GPT-Live (`glove-voice-s2s` >=0.4.0)

Use `s2sDrivenModel({ provider: "openai-live", model: "gpt-live-1", backendModel: "gpt-5.6-luna", voice: "marin" })` in the same agent model slot, or pass `createS2SAdapter({ provider: "openai-live" })` to `RealtimeAgent`. Set `OPENAI_API_KEY` on the server. Selecting `gpt-live-1` on the `openai` adapter uses the wrong protocol.

The Live voice model delegates tool selection to a Responses backend; existing Glove tools execute through `RealtimeAgent`. Set `instructions` for the voice persona and optionally `backendInstructions` for reasoning/tool policy; the backend otherwise uses the agent prompt. In Foundry, use `run: voiceCall(...)` from `glove-foundry/voice` and put the agent on the mesh (`mesh: true`) so durable work goes to other agents and their replies are spoken at the next pause. Live client delegation is not implemented, and the existing voice path still bypasses the Glove Executor's permission/display handling.

- Feed continuous, paced mono PCM, including silence, at the selected 16 or 24 kHz. This adapter is server-only; browsers need a server relay or LiveKit, not the Realtime token helper.
- Consume `rt.on("transcript", fragment => ...)` with `{ role, delta, startMs, endMs }`. Preserve overlapping speakers. Live never emits final `user_said`/`agent_said` turns.
- Check `capabilities.transcripts === "continuous"` and `capabilities.speechLifecycle === "host"`. Supply actual playback state through `notifyPlaybackState?.(speaking)` and application-owned utterance boundaries for avatars. `attachAvatar` or `attachRealtime` alone does not supply these boundaries or fill input silence gaps.
- Manual `interrupt()` flushes and mutes output until the host calls `resumeOutput?.()`. Do not add Realtime `response.cancel`, audio commits, or VAD-based cancellation.
- Await `rt.stop()` to receive final cumulative `usage` (`{ seconds, final }`); timeout/transport loss rejects finalization. Context refresh appends are bounded and non-atomic, not replacements for prior voice instructions. Keep them concise.

Read [the S2S API reference](api-reference.md#glove-voice-s2s) and the [package guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-voice-s2s/README.md#gpt-live) for configuration and host responsibilities. Protocol tests do not establish live account access or audible behavior; use a live session when validating those.

Full API in api-reference.md ("glove-voice-s2s", "glove-voice-avatar", "glove-voice-livekit"); runnable progression in `examples/layered-voice` → `server-voice` → `s2s-rooms` → `avatar-rooms` → `livekit-rooms` (each preserved, ports side-by-side). These examples retain their existing providers and are not GPT-Live-ready without the host changes above.
