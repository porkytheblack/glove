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

### Scribe v3 Live options

The STT adapter runs ElevenLabs **Scribe v3 Live** (`scribe_v3_live`) by default. Pass `stt` options to use its new features:

```ts
const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken, getTTSToken, voiceId,
  stt: {
    diarize: true,                      // live speaker labels
    commitStrategy: "turn_prediction",  // Scribe predicts the end of the turn
    multilangMode: true,                // follow mid-sentence language switches
    keyterms: ["Glove", "Kuiper"],
    language: null,                     // auto-detect (default "en")
  },
});

// Scribe-only events live on `stt.scribe`
stt.scribe.on("diarized", (seg) => {
  for (const t of seg.turns) console.log(`${t.speakerId}: ${t.text}`);
});
```

Other options: `includeTimestamps`, `includeLanguageDetection`, `secondaryLanguages`, `noVerbatim`, `filterBackgroundAudio`, `previousText`, `keepaliveIntervalMs`, `extraParams`. `stt.scribe` also emits `speakers_merged`, `turn_probability`, `committed`, `session_started` and `warning`. Set `model: "scribe_v2_realtime"` for the previous model (it has no `diarize` or `turn_prediction`).

To check your key, network and the live API behaviour (turn probabilities, speaker labels and how fast they arrive), run the live check from this repo. It synthesizes a short two-voice clip, or takes a 16 kHz mono WAV:

```bash
ELEVENLABS_API_KEY=... pnpm --filter glove-voice scribe:check [clip.wav]
```

For recordings, use batch **Scribe v3** on the server:

```ts
import { transcribeWithElevenLabs } from "glove-voice/server";

const { text, turns } = await transcribeWithElevenLabs({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  audio: buffer, filename: "call.mp3",   // or sourceUrl / cloudStorageUrl
  diarize: true,
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

const ptt = useGlovePTT({
  runnable,                       // from useGlove()
  voice: { stt, createTTS },      // turnMode is forced to "manual"
  hotkey: "Space",                // KeyboardEvent.code, or false to disable
  holdThreshold: 300,             // hold >= 300ms = push-to-talk, a quick click toggles voice
  minRecordingMs: 350,            // shortest recording that is committed
});
// ptt.enabled, ptt.recording, ptt.mode, ptt.transcript, ptt.bind
```

Keep the STT adapter on `commitStrategy: "manual"` (the default) for push-to-talk.

Or use the headless `VoicePTTButton` component:

```tsx
import { VoicePTTButton } from "glove-react/voice";

<VoicePTTButton ptt={ptt}>
  {({ enabled, recording }) => (
    <button>{recording ? "Recording..." : enabled ? "Hold to talk" : "Turn voice on"}</button>
  )}
</VoicePTTButton>
```

### Config options

| Option | Type | Description |
|--------|------|-------------|
| `startMuted` | `boolean` | Start the pipeline with mic muted (useful for manual mode) |
| `turnMode` | `"vad" \| "manual" \| "stt"` | VAD for hands-free, manual for push-to-talk, stt to let the STT provider detect turns |
| `sttTurnTimeoutMs` | `number` | `"stt"` mode: commit anyway if the provider hasn't this long after the VAD hears speech end (default: 2500) |
| `speakers` | `boolean \| VoiceSpeakersConfig` | Speaker awareness when the STT adapter labels speakers (on by default with `diarize: true`). See "Several speakers on one microphone" |
| `speechGating` | `boolean` | Only forward mic audio to STT during speech segments (default: `true` in vad and stt modes). Background noise never reaches the STT provider. |
| `speechGatePrerollMs` | `number` | Pre-roll flushed to STT when a speech segment opens, so the first syllable isn't clipped (default: 800) |
| `micConstraints` | `MediaTrackConstraints` | Extra `getUserMedia` constraints merged over the defaults (pick a device, disable a default, etc.) |
| `audio` | `AudioIO` | Platform audio backends (mic capture + PCM playback). Defaults to the browser implementations; pass `createNativeAudioIO()` from `glove-voice-native` on React Native / Expo. |

## Several speakers on one microphone

With `diarize: true`, Scribe v3 Live labels who is speaking, and `GloveVoice` passes that on to the agent. Nothing else to configure:

```ts
const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken, getTTSToken, voiceId,
  stt: { diarize: true },
});
const voice = new GloveVoice(glove, { stt, createTTS });
```

- **One speaker:** the agent gets plain text, as before.
- **From the moment a second speaker is heard**, each line the agent reads starts with who said it, and stays that way:
  ```
  [Speaker A] Can you book a table for seven?
  [Speaker B] Make it seven thirty.
  ```
  The agent also gets a short note each turn (never saved to history) saying how to read the labels, who is in the room, each speaker's share of the talking, and any labels that turned out to be the same person.
- **The `transcript` event stays plain**, for captions. `speaker_turns` carries the labelled turns for the same utterance.
- **Latency:** Scribe sends settled labels just after each commit. GloveVoice waits up to `waitMs` (350ms) for them, then uses the draft labels from the live partial, then plain text. While one known speaker is the only one talking, it does not wait.

```ts
voice.speakers;                 // [{ id, label, name?, talkMs, words, turns, share, lastSpokeAt }]
voice.dominantSpeaker();        // most of the talking overall
voice.dominantSpeaker(60_000);  // ...over the last minute
voice.nameSpeaker("Speaker A", "Sarah"); // lines become "[Sarah] ..."
voice.on("speakers", (list) => render(list));

// Let the agent name people when they introduce themselves:
glove.fold(createNameSpeakerTool((speaker, name) => voice.nameSpeaker(speaker, name)));
```

`speakers` in the config tunes it: `false` ignores the labels, or pass `{ label: "auto" | "always" | "never", waitMs, names: { speaker_0: "Sarah" }, format }`. `"never"` tracks speakers without changing what the agent reads.

Talking the most is not the same as talking to the agent, so treat `dominantSpeaker()` as a hint. With several people in the room the agent hears every line, including people talking to each other; say in your system prompt when it should stay quiet. `diarize` cannot be combined with `filterBackgroundAudio`. Speaker ids start over when the STT session reconnects: the speaker list is cleared and the agent is told that labels may now mean different people. `SpeakerTracker` is exported for use on its own, for example over the `turns` from `transcribeWithElevenLabs`.

## Turn Modes

| Mode | Behavior |
|------|----------|
| `"vad"` (default) | Hands-free. VAD auto-detects speech boundaries + barge-in |
| `"manual"` | Push-to-talk. Call `commitTurn()` to end user's turn |
| `"stt"` | Hands-free, but the STT provider decides when the turn is over (e.g. Scribe v3 Live turn prediction). The VAD still gates audio and handles barge-in |

To use ElevenLabs' turn detection, set both:

```ts
const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken, getTTSToken, voiceId,
  stt: { commitStrategy: "turn_prediction" },
});
const voice = new GloveVoice(glove, { stt, createTTS, turnMode: "stt" });
```

With `turnMode: "vad"`, the local VAD commits after its silence window and overrides the provider. In `"stt"` mode audio keeps flowing after the VAD hears silence so Scribe can judge the pause; if Scribe hasn't committed within `sttTurnTimeoutMs`, GloveVoice commits. `start()` throws unless the adapter reports `detectsTurns: true`.

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

Turn detectors are for engines that own the commit themselves (see
`examples/layered-voice` and `examples/server-voice`). `GloveVoice` does not
use them. Which to pick:

- **Using `GloveVoice`?** Let the STT provider end turns with
  `turnMode: "stt"` and `commitStrategy: "turn_prediction"` (see
  [Turn Modes](#turn-modes)).
- **Running your own commit engine?** Use a turn detector. Wrap it in
  `ProviderTurnDetector` to add Scribe v3 Live's own end-of-turn probability
  while commits stay with you.

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
- `RemoteTurnDetector` (browser) POSTs `{ transcript, context }` to your
  scoring endpoint at each VAD boundary and maps the returned probability to
  a hold between `minHoldMs` (400ms, P ≈ 1) and `maxHoldMs` (2800ms, P ≈ 0).
  The fallback heuristic's dictation tier still floors the hold; on endpoint
  error or after `timeoutMs` (350ms) the fallback decides alone.

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
const turns = new RemoteTurnDetector({ url: "/api/turn" });
```

**Provider turn probability.** Scribe v3 Live sends an end-of-turn
probability with every partial, under every commit strategy (including
`"manual"`), judged from the audio as well as the words.
`ElevenLabsSTTAdapter` exposes the latest value as `stt.turnProbability`
(`null` before the first partial of an utterance, after a commit, and on
`scribe_v2_realtime`). `ProviderTurnDetector` adds it to another detector:

| Provider probability | Hold |
|---|---|
| P ≥ `doneAt` (0.9) | at most `doneHoldMs` (400ms); a dictation hold is kept |
| P < `unfinishedBelow` (0.2) | at least `unfinishedHoldMs` (1500ms) |
| otherwise, or no probability | the inner detector's decision |

```ts
import { ElevenLabsSTTAdapter, ProviderTurnDetector, RemoteTurnDetector } from "glove-voice";

const stt = new ElevenLabsSTTAdapter({ getToken });   // commitStrategy stays "manual"
const turns = new ProviderTurnDetector({
  source: stt,                                         // anything with turnProbability
  inner: new RemoteTurnDetector({ url: "/api/turn" }), // default: HeuristicTurnDetector
});
```

## Adapter Contracts

All adapters implement typed interfaces. Build your own by implementing:

- `STTAdapter` — Streaming speech-to-text (optional `detectsTurns` for `turnMode: "stt"`, `turnProbability` for `ProviderTurnDetector`)
- `TTSAdapter` — Streaming text-to-speech
- `VADAdapter` — Voice activity detection
- `TurnDetectorAdapter` — Semantic endpointing (is the speaker done?)

## Exports

| Entry Point | Exports | Browser-safe |
|-------------|---------|-------------|
| `glove-voice` | GloveVoice, adapters, AudioCapture, AudioPlayer, VAD | Yes |
| `glove-voice/server` | Token generators (createElevenLabsSTTToken, etc.), `transcribeWithElevenLabs` (batch Scribe v3) | No (server only) |
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
