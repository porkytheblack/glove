# glove-voice

## 3.2.0

### Minor Changes

- [#42](https://github.com/porkytheblack/glove/pull/42) [`857fc41`](https://github.com/porkytheblack/glove/commit/857fc41b4139b569e6eebd794dc3ee38a5326360) Thanks [@porkytheblack](https://github.com/porkytheblack)! - React Native / Expo support for the Glove voice pipeline.

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

- [#42](https://github.com/porkytheblack/glove/pull/42) [`ca951e2`](https://github.com/porkytheblack/glove/commit/ca951e265e7c1a8677e07e06d61f97702cf28e06) Thanks [@porkytheblack](https://github.com/porkytheblack)! - State-of-the-art noise handling: STT now only transcribes actual speech, not background noise.

  - **Speech-gated STT streaming (`SpeechGate`)**: in `"vad"` turn mode, mic audio is no longer streamed to the STT provider continuously. Audio is held in a rolling pre-roll buffer and only released to STT when the VAD confirms a speech segment — background noise (keyboards, traffic, music) never reaches the provider, eliminating hallucinated transcripts and cutting STT cost. On by default; opt out with `speechGating: false`.
  - **Confirmed-speech lifecycle**: `VADAdapterEvents` gains `speech_real_start` (speech survived the minimum-duration filter), `vad_misfire` (tentative speech retracted — treated as noise), and `speech_prob` (per-frame probability for meters/tuning). Adapters advertise the tentative→confirmed lifecycle via `supportsRealStart`.
  - **Silero VAD**: defaults moved to the model's recommended operating point (`positiveSpeechThreshold: 0.5`, `negativeSpeechThreshold: 0.35`, `minSpeechMs: 250`); emits the new events. **Behavior change**: misfires now emit `vad_misfire` instead of a synthetic `speech_end` — with gating on, the audio is discarded entirely; ungated pipelines still get an STT flush via GloveVoice's misfire handler.
  - **Noise-robust barge-in**: with a confirming VAD (Silero), barge-in triggers on `speech_real_start` instead of first-frame `speech_start` — a door slam no longer cuts the agent off mid-sentence.
  - **Adaptive energy VAD**: the built-in `VAD` is now time-based (`silenceMs` / `minSpeechMs` — the old chunk-count options were miscalibrated for AudioWorklet's 128-sample chunks) and tracks the ambient noise floor, raising its effective threshold above steady background noise. Legacy `silentFrames` / `speechFrames` still honored.
  - **Mic capture**: `getUserMedia` now also requests `voiceIsolation` (platform voice isolation where supported, ignored elsewhere), and `GloveVoiceConfig.micConstraints` / `AudioCapture`'s second constructor arg let you override any audio constraint (device pick, disable noiseSuppression, etc.).
