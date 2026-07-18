---
"glove-voice": minor
"glove-voice-native": minor
---

React Native / Expo support for the Glove voice pipeline.

**glove-voice** — platform seam + portability:

- New `AudioIO` contract (`AudioCaptureAdapter` / `AudioPlayerAdapter`): `GloveVoiceConfig.audio` lets any platform supply mic capture and PCM playback while the rest of the pipeline (VAD, speech gating, STT/TTS adapters, barge-in, narrate) runs unchanged. Browser implementations remain the default — no consumer changes.
- ElevenLabs STT/TTS adapters no longer use `btoa`/`atob` (absent in Hermes) — portable pure-JS base64 (`bytesToBase64` / `base64ToBytes`, exported) makes them work in React Native as-is.
- `useGlovePTT`'s hotkey binding is now guarded for environments without `window`.

**glove-voice-native** — new package (first release):

- `NativeAudioCapture`: on-device mic capture via `react-native-audio-api`'s `AudioRecorder` — requests permissions, configures the iOS audio session for full-duplex voice chat (`playAndRecord` + `voiceChat` mode → OS echo cancellation), emits pipeline-format Int16 PCM chunks.
- `NativeAudioPlayer`: gapless streaming PCM playback on `react-native-audio-api`'s Web Audio implementation.
- `createNativeAudioIO()` / `withNativeAudio()`: one-liner to run `GloveVoice` / `useGloveVoice` in an Expo app.
- `glove-voice-native/silero-vad`: `SileroVADNativeAdapter` — Silero VAD v5 on `onnxruntime-react-native` with the same confirmed-speech lifecycle as the browser adapter (`speech_real_start` / `vad_misfire` / `speech_prob`), so speech gating and noise-robust barge-in work identically on-device. Downloads + caches the model via `expo-file-system`, or accepts a bundled local path.
- Works with Expo dev clients / prebuild (native modules — not Expo Go); mic permissions via `react-native-audio-api`'s config plugin.
