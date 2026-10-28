---
"glove-voice-s2s": patch
---

Gemini Live: nullable tool parameters no longer send a `null` type. `z.toJSONSchema()` writes `.nullable()` as `anyOf: [T, { type: "null" }]`, and `geminiSchema` passed the `{ type: "null" }` branch through to the setup frame. Gemini's Schema has no null type. The null branch now becomes `nullable: true`, folded into `T` when it is the only other branch.
