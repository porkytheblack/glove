# glove-voice-native

React Native / Expo audio backends for the [Glove](https://glove.dterminal.net) voice pipeline.

`glove-voice`'s pipeline — VAD, speech gating, STT/TTS adapters, barge-in, narration — is platform-neutral. Only the edges touch the platform: the microphone and the speaker. This package supplies those edges for iOS and Android:

- **`NativeAudioCapture`** — on-device mic capture (Int16 mono PCM chunks), backed by [`react-native-audio-api`](https://docs.swmansion.com/react-native-audio-api/)'s `AudioRecorder`. Configures the iOS audio session for full-duplex voice chat (`playAndRecord` + `voiceChat` mode → OS echo cancellation), requests permissions, converts to the pipeline format.
- **`NativeAudioPlayer`** — gapless streaming PCM playback via `react-native-audio-api`'s Web Audio implementation.
- **`SileroVADNativeAdapter`** (`glove-voice-native/silero-vad`) — Silero VAD v5 running on [`onnxruntime-react-native`](https://www.npmjs.com/package/onnxruntime-react-native), with the same confirmed-speech lifecycle (`speech_start` / `speech_real_start` / `vad_misfire` / `speech_end` / `speech_prob`) as the browser adapter — so speech gating and noise-robust barge-in work identically on-device.

## Install

```bash
npx expo install react-native-audio-api
pnpm add glove-voice glove-voice-native

# Optional — neural VAD (recommended) + model caching:
pnpm add onnxruntime-react-native
npx expo install expo-file-system
```

These are **native modules** — they work in an Expo dev client / `expo prebuild` build, not in Expo Go:

```bash
npx expo prebuild && npx expo run:ios   # or run:android
```

## Expo config

Use `react-native-audio-api`'s config plugin for the mic permission:

```jsonc
// app.json
{
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
}
```

## Usage

Everything from the web voice stack carries over — the only change is `audio` in the voice config (and the native Silero adapter):

```tsx
import { useGlove } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import { createElevenLabsAdapters } from "glove-voice";
import { createNativeAudioIO } from "glove-voice-native";
import { SileroVADNativeAdapter } from "glove-voice-native/silero-vad";

const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("https://your-server/api/voice/stt-token"),
  getTTSToken: () => fetchToken("https://your-server/api/voice/tts-token"),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});

// Downloads + caches the Silero v5 model on first run (via expo-file-system).
// Bundle it yourself and pass a local path to skip the download.
const vad = new SileroVADNativeAdapter();
await vad.init();

function VoiceScreen() {
  const glove = useGlove({ endpoint: "https://your-server/api/chat", systemPrompt, tools });
  const voice = useGloveVoice({
    runnable: glove.runnable,
    voice: { stt, createTTS, vad, audio: createNativeAudioIO() },
  });

  return <Button title={voice.mode} onPress={voice.enabled ? voice.stop : voice.start} />;
}
```

Or with the convenience wrapper:

```ts
import { withNativeAudio } from "glove-voice-native";

const voice = useGloveVoice({
  runnable,
  voice: withNativeAudio({ stt, createTTS, vad }),
});
```

No neural VAD? Skip `onnxruntime-react-native` entirely — `GloveVoice` falls back to the built-in adaptive energy VAD from `glove-voice` (pure JS, runs anywhere). Speech gating still applies; you lose the tentative→confirmed noise filtering.

Push-to-talk (`turnMode: "manual"`, `useGlovePTT`) works too — wire `ptt.bind`'s pointer handlers to a `Pressable`.

## Options

```ts
createNativeAudioIO({
  bufferLengthMs: 50,          // mic chunk size (latency vs CPU)
  requestPermissions: true,    // ask for mic permission in init()
  manageAudioSession: true,    // set + activate the shared audio session
  iosCategory: "playAndRecord",
  iosMode: "voiceChat",        // OS echo cancellation — keeps TTS out of the mic
  iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
});

new SileroVADNativeAdapter({
  model: SILERO_V5_MODEL_URL,  // or a local file path
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 1400,
  minSpeechMs: 250,
});
```

## Notes

- **Sample rate**: the pipeline default is 16 kHz mono — leave it unless your STT/TTS provider requires otherwise.
- **Auth**: same token model as the web — your server exchanges the provider API key for short-lived tokens (`createVoiceTokenHandler` from `glove-next`, or any HTTP endpoint).
- **Hermes**: the Silero adapter uses an int64 tensor (`BigInt64Array`) — use a recent React Native (0.74+) where Hermes ships BigInt typed arrays.
- **One recorder at a time**: `react-native-audio-api` recommends a single `AudioRecorder` instance; `GloveVoice` creates one per `start()` and releases it on `stop()` — don't run two voice pipelines at once.
