---
"glove-voice": minor
---

ElevenLabs Scribe v3 Live and Scribe v3.

- **`ElevenLabsSTTAdapter` defaults to `scribe_v3_live`.** Set `model: "scribe_v2_realtime"` to keep the previous model.
- **New realtime options:** `commitStrategy` (`"manual"`, `"vad"` or `"turn_prediction"`), `diarize`, `multilangMode`, `secondaryLanguages`, `keyterms`, `includeTimestamps`, `includeLanguageDetection`, `noVerbatim`, `filterBackgroundAudio`, `previousText`, `keepaliveIntervalMs` and `extraParams`. `language: null` lets Scribe detect the language.
- **Scribe events on `adapter.scribe`:** `diarized` (speaker turns for each committed segment, with merges applied), `speakers_merged`, `turn_probability`, `committed` (with word timings and language when requested), `session_started` and `warning`. The adapter keeps the plain `STTAdapter` events, so `GloveVoice` is unchanged. `resolveSpeaker(id)` follows merges.
- **All Scribe error messages are reported.** `quota_exceeded`, `auth_error`, `rate_limited`, `session_time_limit_exceeded` and the other error types now emit `error`; previously only `error` and `invalid_request` did. `commit_throttled` and `insufficient_audio_activity` emit `warning`.
- **No duplicate commits under server-side commit strategies.** With `vad` or `turn_prediction`, `flushUtterance()` sends nothing when Scribe has already committed the audio.
- **`transcribeWithElevenLabs` in `glove-voice/server`.** Batch transcription with Scribe v3 (`scribe_v3`) from a file, a URL or cloud storage, returning the text, the words and speaker turns.
- **`turnMode: "stt"` lets the STT provider end turns.** With `ElevenLabsSTTAdapter({ commitStrategy: "turn_prediction" })`, Scribe v3 Live decides when the speaker is done. The local VAD still gates audio and handles barge-in but never commits. Audio keeps flowing through the pause so Scribe can judge it, and if Scribe hasn't committed `sttTurnTimeoutMs` (default 2500) after the VAD heard speech end, GloveVoice commits. `STTAdapter` gains an optional `detectsTurns`; `start()` throws in `"stt"` mode without it.
- **Push-to-talk warning.** `GloveVoice` warns at `start()` when `turnMode` is `"manual"` and the adapter ends turns on its own (`detectsTurns: true`), since the provider would split a push-to-talk hold into several turns.
- **`ProviderTurnDetector` and `turnProbability`.** Scribe v3 Live sends an end-of-turn probability with every partial, under every commit strategy. `ElevenLabsSTTAdapter.turnProbability` holds the latest one (`STTAdapter` gains an optional `turnProbability`). `ProviderTurnDetector` wraps another `TurnDetectorAdapter` and uses it at each VAD boundary: P ≥ 0.9 caps the hold at 400ms (a dictation hold is kept), P < 0.2 raises it to at least 1500ms. Engines that commit themselves keep `commitStrategy: "manual"` and still get Scribe's turn prediction.
