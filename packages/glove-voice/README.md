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

## Turn Modes

| Mode | Behavior |
|------|----------|
| `"vad"` (default) | Hands-free. VAD auto-detects speech boundaries + barge-in |
| `"manual"` | Push-to-talk. Call `commitTurn()` to end user's turn |

## Voice Activity Detection

**Built-in VAD** — Energy-based, zero dependencies:

```ts
// Used automatically when no custom VAD is provided
const voice = new GloveVoice(glove, { stt, createTTS });
```

**SileroVAD** — ML-based (ONNX Runtime WASM), more accurate:

```ts
// IMPORTANT: Use dynamic import to avoid pulling WASM into SSR bundle
const { SileroVADAdapter } = await import("glove-voice/silero-vad");
const vad = new SileroVADAdapter({
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  wasm: { type: "cdn" },
});
await vad.init();

const voice = new GloveVoice(glove, { stt, createTTS, vad });
```

## Security

API keys never leave your server. Adapters use short-lived, single-use tokens:

1. Your server generates a token using the provider's API
2. Token is passed to the browser
3. Browser uses token to authenticate with STT/TTS WebSockets

Token handlers: `createVoiceTokenHandler` from `glove-next` supports ElevenLabs, Deepgram, Cartesia.

## Adapter Contracts

All adapters implement typed EventEmitter interfaces. Build your own by implementing:

- `STTAdapter` — Streaming speech-to-text
- `TTSAdapter` — Streaming text-to-speech
- `VADAdapter` — Voice activity detection

## Exports

| Entry Point | Exports | Browser-safe |
|-------------|---------|-------------|
| `glove-voice` | GloveVoice, adapters, AudioCapture, AudioPlayer, VAD | Yes |
| `glove-voice/server` | Token generators (createElevenLabsSTTToken, etc.) | No (server only) |
| `glove-voice/silero-vad` | SileroVADAdapter | Yes (WASM) |

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

## License

MIT
