---
"glove-voice": minor
---

Turn detection: deciding when a speaker has actually finished, not just when they paused.

A VAD boundary answers "did the audio stop", which is not the same question as "was that the end of the turn" — a speaker thinking mid-sentence produces the same silence as a speaker who is done. Fixed silence thresholds have to choose between cutting people off and feeling sluggish, and get it wrong in both directions.

- **`TurnDetectorAdapter`** — a small contract taking the transcript so far (plus optional conversation context) and returning `{ holdMs, reason }`: how much *longer* to wait past the VAD boundary before committing, and a short machine-readable label for metrics. `holdMs: 0` means commit now. A hold is cancelled if the speaker resumes.
- **`HeuristicTurnDetector`** — zero-dependency default. Holds are keyed on how the transcript ends, because streaming providers auto-punctuate their partials: a `?` is a finished question, a trailing `.` is only weak evidence (lazy-paced fragments arrive period-terminated), and a conjunction or filler is strong evidence more is coming.
- **`RemoteTurnDetector`** — defers to an HTTP endpoint you host, with a timeout and a fallback to the heuristic, so a slow or failed scorer degrades rather than stalling the turn.
- **`LiveKitEouScorer`** (from `glove-voice/server`) — runs LiveKit's end-of-utterance model in-process via `@huggingface/transformers`, turning its probability into a hold with a shaping curve. Exported alongside `normalizeForEou` for the text preparation the model expects.

Running the scorer in-process rather than behind HTTP is the point: endpointing sits directly in the path between someone finishing a sentence and hearing a reply, so a round trip per VAD boundary is paid on every single turn.

Also on the ElevenLabs TTS adapter, for short replies that previously only synthesized at flush:

- **`autoMode`** — generate as soon as a sentence completes rather than waiting for the default character schedule. Send whole sentences under this, not raw token fragments.
- **`generationConfig.chunkLengthSchedule`** — override the buffering schedule instead (50–500 per value), which beats sentence-boundary triggering for short single-sentence replies.

Both default off; existing behaviour is unchanged.
