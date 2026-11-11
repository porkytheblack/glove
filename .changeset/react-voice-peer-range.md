---
"glove-react": minor
---

The optional `glove-voice` peer dependency is published as a caret range (`^x.y.z`) instead of an exact version, so a new minor release of `glove-voice` satisfies it.

`useGloveVoice` returns `speakers`, `dominantSpeaker()` and `nameSpeaker()` for pipelines whose STT adapter labels speakers (`ElevenLabsSTTAdapter({ diarize: true })`).
