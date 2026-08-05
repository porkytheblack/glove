---
"glove-voice": patch
---

Two ElevenLabs adapter fixes, both found on live calls and both silent until they weren't.

- **A failed STT reconnect could take down the host process.** The auto-reconnect path called `connect()` without handling rejection, and `connect()` both rejects on a socket error and throws when the token mint fails. A transient 5xx from the token endpoint therefore surfaced as an unhandled rejection — which for a voice gateway means the room dies mid-call and the caller's microphone goes permanently dead. Failures now emit `error`, and `close` once the retry budget is spent, so a supervisor can act on them.

- **`flushUtterance()` could be silently ignored, gluing two utterances together.** Scribe throttles any commit carrying less than 0.3s of uncommitted audio, and the rejection is invisible: the caller believes the buffer was cleared while the provider keeps accumulating, so the next utterance arrives with the previous one still attached. The flush now sends enough silence to clear that floor. It costs ~320ms of padding at an utterance boundary, where the speaker has already stopped talking.
