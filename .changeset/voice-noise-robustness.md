---
"glove-voice": minor
---

State-of-the-art noise handling: STT now only transcribes actual speech, not background noise.

- **Speech-gated STT streaming (`SpeechGate`)**: in `"vad"` turn mode, mic audio is no longer streamed to the STT provider continuously. Audio is held in a rolling pre-roll buffer and only released to STT when the VAD confirms a speech segment — background noise (keyboards, traffic, music) never reaches the provider, eliminating hallucinated transcripts and cutting STT cost. On by default; opt out with `speechGating: false`.
- **Confirmed-speech lifecycle**: `VADAdapterEvents` gains `speech_real_start` (speech survived the minimum-duration filter), `vad_misfire` (tentative speech retracted — treated as noise), and `speech_prob` (per-frame probability for meters/tuning). Adapters advertise the tentative→confirmed lifecycle via `supportsRealStart`.
- **Silero VAD**: defaults moved to the model's recommended operating point (`positiveSpeechThreshold: 0.5`, `negativeSpeechThreshold: 0.35`, `minSpeechMs: 250`); emits the new events. **Behavior change**: misfires now emit `vad_misfire` instead of a synthetic `speech_end` — with gating on, the audio is discarded entirely; ungated pipelines still get an STT flush via GloveVoice's misfire handler.
- **Noise-robust barge-in**: with a confirming VAD (Silero), barge-in triggers on `speech_real_start` instead of first-frame `speech_start` — a door slam no longer cuts the agent off mid-sentence.
- **Adaptive energy VAD**: the built-in `VAD` is now time-based (`silenceMs` / `minSpeechMs` — the old chunk-count options were miscalibrated for AudioWorklet's 128-sample chunks) and tracks the ambient noise floor, raising its effective threshold above steady background noise. Legacy `silentFrames` / `speechFrames` still honored.
- **Mic capture**: `getUserMedia` now also requests `voiceIsolation` (platform voice isolation where supported, ignored elsewhere), and `GloveVoiceConfig.micConstraints` / `AudioCapture`'s second constructor arg let you override any audio constraint (device pick, disable noiseSuppression, etc.).
