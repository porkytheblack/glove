# glove-voice

Voice pipeline for the [Glove](https://github.com/porkytheblack/glove) agent framework. Add real-time voice interaction to any Glove app — speak to your agent, hear it respond.

## Architecture

```
Mic → VAD → STTAdapter → Glove Agent → TTSAdapter → Speaker
```

## Install

```bash
pnpm add glove-voice
```

## Quick Start (with ElevenLabs)

### 1. Server token routes (Next.js)

```ts
// app/api/voice/stt-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });
```

```ts
// app/api/voice/tts-token/route.ts
import { createVoiceTokenHandler } from "glove-next";
export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });
```

Set `ELEVENLABS_API_KEY` in `.env.local`.

### 2. Client adapter setup

```ts
import { createElevenLabsAdapters } from "glove-voice";

const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token),
  getTTSToken: () => fetch("/api/voice/tts-token").then(r => r.json()).then(d => d.token),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});
```

### 3. Create voice instance

```ts
import { GloveVoice } from "glove-voice";

const voice = new GloveVoice(gloveRunnable, { stt, createTTS });
voice.on("mode", (mode) => console.log(mode)); // idle → listening → thinking → speaking
await voice.start();
```

### 4. React hook (optional)

```tsx
import { useGloveVoice } from "glove-react/voice";

const voice = useGloveVoice({ runnable, voice: { stt, createTTS } });
// voice.mode, voice.transcript, voice.start(), voice.stop(), voice.interrupt()
```

### Push-to-Talk (React)

`useGlovePTT` provides a high-level push-to-talk hook with click-vs-hold detection, hotkey support, and minimum duration:

```tsx
import { useGlovePTT } from "glove-react/voice";

const ptt = useGlovePTT(voice, {
  holdThresholdMs: 300,   // hold > 300ms = PTT, shorter = toggle
  minDurationMs: 600,     // minimum recording duration
  hotkey: " ",            // spacebar
});
// ptt.active, ptt.onPointerDown, ptt.onPointerUp
```

Or use the headless `VoicePTTButton` component:

```tsx
import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={ptt}>
  {({ active, handlers }) => (
    <button {...handlers}>{active ? "Recording..." : "Hold to talk"}</button>
  )}
</VoicePTTButton>
```

### Config options

| Option | Type | Description |
|--------|------|-------------|
| `startMuted` | `boolean` | Start the pipeline with mic muted (useful for manual mode) |
| `turnMode` | `"vad" \| "manual"` | VAD for hands-free, manual for push-to-talk |
| `speechGating` | `boolean` | Only forward mic audio to STT during speech segments (default: `true` in vad mode). Background noise never reaches the STT provider. |
| `speechGatePrerollMs` | `number` | Pre-roll flushed to STT when a speech segment opens, so the first syllable isn't clipped (default: 800) |
| `micConstraints` | `MediaTrackConstraints` | Extra `getUserMedia` constraints merged over the defaults (pick a device, disable a default, etc.) |
| `audio` | `AudioIO` | Platform audio backends (mic capture + PCM playback). Defaults to the browser implementations; pass `createNativeAudioIO()` from `glove-voice-native` on React Native / Expo. |

## Turn Modes

| Mode | Behavior |
|------|----------|
| `"vad"` (default) | Hands-free. VAD auto-detects speech boundaries + barge-in |
| `"manual"` | Push-to-talk. Call `commitTurn()` to end user's turn |

## Voice Activity Detection & Noise Robustness

The pipeline is built so **only actual speech gets transcribed** — never
ambient noise. Three layers work together:

1. **Capture** — `getUserMedia` requests `echoCancellation`, `noiseSuppression`,
   `autoGainControl`, and `voiceIsolation` (platform voice isolation where the
   browser supports it; ignored elsewhere).
2. **VAD** — decides what counts as speech. Silero (neural) distinguishes
   speech from arbitrary noise; the built-in energy VAD adapts its threshold
   to the ambient noise floor.
3. **Speech gating** (`SpeechGate`, on by default in vad mode) — mic audio is
   held in a rolling pre-roll buffer and only released to the STT provider
   once the VAD confirms a speech segment. Keyboard clatter, traffic, and
   music never reach STT, so they can't be transcribed, hallucinated into
   words, or billed. With Silero, tentative speech shorter than `minSpeechMs`
   is a *misfire* and its audio is discarded entirely; barge-in also waits for
   confirmed speech, so a door slam doesn't cut the agent off.

**Built-in VAD** — Energy-based with adaptive noise floor, zero dependencies:

```ts
// Used automatically when no custom VAD is provided
const voice = new GloveVoice(glove, { stt, createTTS });

// Tunable — all durations in ms, independent of chunk size:
// new VAD({ threshold: 0.01, silenceMs: 1600, minSpeechMs: 96, adaptive: true })
```

**SileroVAD** — ML-based (ONNX Runtime WASM), strongly recommended for noisy
environments:

```ts
// IMPORTANT: Use dynamic import to avoid pulling WASM into SSR bundle
const { SileroVADAdapter } = await import("glove-voice/silero-vad");
const vad = new SileroVADAdapter({
  // Defaults: positiveSpeechThreshold 0.5, negativeSpeechThreshold 0.35,
  // minSpeechMs 250, redemptionMs 1400, preSpeechPadMs 800
  wasm: { type: "cdn" },
});
await vad.init();

const voice = new GloveVoice(glove, { stt, createTTS, vad });
```

**VAD events** — all adapters emit `speech_start` / `speech_end`; adapters
with `supportsRealStart: true` (Silero) additionally emit `speech_real_start`
(confirmed speech — the noise-robust barge-in trigger) and `vad_misfire`
(tentative speech retracted). Every adapter emits `speech_prob` per frame for
level meters and threshold tuning.

## Security

API keys never leave your server. Adapters use short-lived, single-use tokens:

1. Your server generates a token using the provider's API
2. Token is passed to the browser
3. Browser uses token to authenticate with STT/TTS WebSockets

Token handlers: `createVoiceTokenHandler` from `glove-next` supports ElevenLabs, Deepgram, Cartesia.

## Turn Detection (semantic endpointing)

A VAD knows when *audio* stopped; it can't know whether the *speaker* is done.
`TurnDetectorAdapter` is the pluggable layer production stacks use for this
(LiveKit's transformer turn-detector, Pipecat's smart-turn): at each VAD
end-of-speech boundary it inspects the live transcript and returns how much
longer to hold before committing the utterance — `0` for "commit now".

`HeuristicTurnDetector` is the zero-dependency baseline, with tiered holds:

| transcript ends with | tier | default hold |
|---|---|---|
| 1–2 char token ("K", "0-0-7") | dictation — speaker is spelling | 2000ms |
| `?` / `!` | question — done when asked | 0 |
| `.` / `…` | statement — STT auto-punctuates partials, weak evidence | 600ms |
| anything else | unfinished / mid-thought | 900ms |

```ts
import { HeuristicTurnDetector } from "glove-voice";

const turns = new HeuristicTurnDetector({ statementHoldMs: 800 });
vad.on("speech_end", async () => {
  const { holdMs, reason } = await turns.decide(sttPartial);
  // holdMs === 0 → commit; else arm a timer, cancel it if speech resumes
});
```

**Model-backed detection** ships too, in the LiveKit deployment shape (model
server-side, thin client):

- `LiveKitEouScorer` (`glove-voice/server`) runs the open
  [livekit/turn-detector](https://huggingface.co/livekit/turn-detector)
  weights in Node via `@huggingface/transformers` (optional dependency,
  inject the module). ~25ms per score on CPU after warmup; transcripts are
  normalized internally (the model was trained on lowercased, unpunctuated
  text — raw punctuated input inverts the signal).
- `RemoteTurnDetector` (browser) POSTs the transcript to your scoring
  endpoint at each VAD boundary: P ≥ threshold → commit now; below → the
  fallback heuristic picks the hold (dictation/unfinished tiers still
  apply); endpoint error or >350ms → fallback decides alone.

```ts
// app/api/turn/route.ts
import * as transformers from "@huggingface/transformers";
import { LiveKitEouScorer } from "glove-voice/server";
const scorer = new LiveKitEouScorer({ transformers });
export async function POST(req: Request) {
  const { transcript } = await req.json();
  return Response.json({ probability: await scorer.probability([{ role: "user", content: transcript }]) });
}

// client
const turns = new RemoteTurnDetector({ url: "/api/turn", threshold: 0.5 });
```

## Adapter Contracts

All adapters implement typed interfaces. Build your own by implementing:

- `STTAdapter` — Streaming speech-to-text
- `TTSAdapter` — Streaming text-to-speech
- `VADAdapter` — Voice activity detection
- `TurnDetectorAdapter` — Semantic endpointing (is the speaker done?)

## Exports

| Entry Point | Exports | Browser-safe |
|-------------|---------|-------------|
| `glove-voice` | GloveVoice, adapters, AudioCapture, AudioPlayer, VAD | Yes |
| `glove-voice/server` | Token generators (createElevenLabsSTTToken, etc.) | No (server only) |
| `glove-voice/silero-vad` | SileroVADAdapter | Yes (WASM) |

React voice bindings are exported from `glove-react/voice`:

| Export | Description |
|--------|-------------|
| `useGloveVoice` | Core voice hook — mode, transcript, start/stop/interrupt |
| `useGlovePTT` | Push-to-talk with click-vs-hold, hotkey, min-duration |
| `VoicePTTButton` | Headless PTT button component with render prop |

## Framework Integration Notes

**Next.js:**

```ts
// next.config.ts
export default {
  transpilePackages: ["glove-voice"],
};
```

Build warnings from onnxruntime-web are expected and harmless.

**Gotchas:**

- `glove-voice/silero-vad` must be dynamically imported — never import at module level in SSR
- `createTTS` must be a factory function (called per turn), not a single instance
- All adapters assume 16kHz mono PCM audio
- ElevenLabs TTS idles out after ~20s — GloveVoice handles this by closing TTS after each model response and opening a fresh session on the next text
- Barge-in protection for mutation-critical tools requires `unAbortable: true` on the tool — a pending `pushAndWait` resolver only suppresses the voice barge-in trigger, it does not prevent tool abortion from other sources

## Documentation

- [Voice Guide](https://glove.dterminal.net/docs/voice)
- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
