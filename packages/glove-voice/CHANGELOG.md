# glove-voice

## 3.6.0

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

- [#45](https://github.com/porkytheblack/glove/pull/45) [`1809a99`](https://github.com/porkytheblack/glove/commit/1809a99d7c9d9fb5d966bcc138f66461e51abfc5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Turn detection: deciding when a speaker has actually finished, not just when they paused.

  A VAD boundary answers "did the audio stop", which is not the same question as "was that the end of the turn" — a speaker thinking mid-sentence produces the same silence as a speaker who is done. Fixed silence thresholds have to choose between cutting people off and feeling sluggish, and get it wrong in both directions.

  - **`TurnDetectorAdapter`** — a small contract taking the transcript so far (plus optional conversation context) and returning `{ holdMs, reason }`: how much _longer_ to wait past the VAD boundary before committing, and a short machine-readable label for metrics. `holdMs: 0` means commit now. A hold is cancelled if the speaker resumes.
  - **`HeuristicTurnDetector`** — zero-dependency default. Holds are keyed on how the transcript ends, because streaming providers auto-punctuate their partials: a `?` is a finished question, a trailing `.` is only weak evidence (lazy-paced fragments arrive period-terminated), and a conjunction or filler is strong evidence more is coming.
  - **`RemoteTurnDetector`** — defers to an HTTP endpoint you host, with a timeout and a fallback to the heuristic, so a slow or failed scorer degrades rather than stalling the turn.
  - **`LiveKitEouScorer`** (from `glove-voice/server`) — runs LiveKit's end-of-utterance model in-process via `@huggingface/transformers`, turning its probability into a hold with a shaping curve. Exported alongside `normalizeForEou` for the text preparation the model expects.

  Running the scorer in-process rather than behind HTTP is the point: endpointing sits directly in the path between someone finishing a sentence and hearing a reply, so a round trip per VAD boundary is paid on every single turn.

  Also on the ElevenLabs TTS adapter, for short replies that previously only synthesized at flush:

  - **`autoMode`** — generate as soon as a sentence completes rather than waiting for the default character schedule. Send whole sentences under this, not raw token fragments.
  - **`generationConfig.chunkLengthSchedule`** — override the buffering schedule instead (50–500 per value), which beats sentence-boundary triggering for short single-sentence replies.

  Both default off; existing behaviour is unchanged.

### Patch Changes

- [#45](https://github.com/porkytheblack/glove/pull/45) [`1809a99`](https://github.com/porkytheblack/glove/commit/1809a99d7c9d9fb5d966bcc138f66461e51abfc5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Two ElevenLabs adapter fixes, both found on live calls and both silent until they weren't.

  - **A failed STT reconnect could take down the host process.** The auto-reconnect path called `connect()` without handling rejection, and `connect()` both rejects on a socket error and throws when the token mint fails. A transient 5xx from the token endpoint therefore surfaced as an unhandled rejection — which for a voice gateway means the room dies mid-call and the caller's microphone goes permanently dead. Failures now emit `error`, and `close` once the retry budget is spent, so a supervisor can act on them.

  - **`flushUtterance()` could be silently ignored, gluing two utterances together.** Scribe throttles any commit carrying less than 0.3s of uncommitted audio, and the rejection is invisible: the caller believes the buffer was cleared while the provider keeps accumulating, so the next utterance arrives with the previous one still attached. The flush now sends enough silence to clear that floor. It costs ~320ms of padding at an utterance boundary, where the speaker has already stopped talking.

- Updated dependencies [[`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109)]:
  - glove-core@3.6.0
