# glove-voice-avatar

Live avatars for the Glove agent framework — a **face over the
speech-to-speech voice stack** (`glove-voice-s2s`), tracked in
[#70](https://github.com/porkytheblack/glove/issues/70).

## The idea

A realtime avatar provider is a lip-sync renderer over an audio stream: PCM
in, a talking face out on a WebRTC surface. That is exactly the shape of the
`audio` events a transport-mode `S2SAdapter` emits — so the avatar is a
rendering **layer** over the existing layered architecture (S2S front agent,
capable worker over the mesh, rooms as signals), not a replacement for any
of it. The mic path, tools, and delegation are untouched.

```
mic ──▶ S2S model (the brain + voice) ──▶ agent PCM ──▶ AvatarAdapter ──▶ the face,
             │ tool calls unchanged                     on the provider's WebRTC surface
             ▼
        worker over the mesh
```

## The pieces

| piece | what it is |
| --- | --- |
| `AvatarAdapter` | the contract: `connect()` → a `view` clients attach to, `sendAudio(pcm, format)`, `endUtterance()`, `interrupt()` (always safe — conformance-enforced) |
| `AvatarView` | how a client attaches, as a tagged union: a WebRTC room URL (Tavus/Daily) or an SDK session token (Anam) |
| `TavusEchoAdapter` | first concrete adapter: Tavus `pipeline_mode: "echo"` — our PCM streams into the rendered replica as base64 24 kHz `conversation.echo` events; the caller joins the conversation's Daily room |
| `attachAvatar(rt, avatar)` | the one-call bridge from a `RealtimeAgent`: `audio` → `sendAudio`, `agent_speech_stopped` → `endUtterance`, `interrupted` → `interrupt`. Returns a detach fn |
| `runAvatarConformance` | the behavioural suite every adapter must pass against a fake transport |

## Usage

```ts
import { RealtimeAgent } from "glove-voice-s2s";
import { TavusEchoAdapter, attachAvatar } from "glove-voice-avatar";

const rt = new RealtimeAgent({ agent });   // the voice stack, exactly as before
await rt.start();

const avatar = new TavusEchoAdapter({
  apiKey: process.env.TAVUS_API_KEY!,      // server-side only
  personaId: process.env.TAVUS_PERSONA_ID!, // a persona with pipeline_mode: "echo"
});
const detach = await attachAvatar(rt, avatar);

avatar.view; // { kind: "webrtc-room", url: "https://tavus.daily.co/…" } — hand to the client
```

Barge-in follows the voice automatically: the S2S side's `interrupted`
(which #67 made unconditional) drives the avatar's `interrupt()`, which
drops the buffered tail and frames the provider interrupt — the face stops
with the voice, and the next utterance starts a fresh inference.

## Echo-mode facts worth knowing (Tavus)

- Echo bypasses Tavus's whole pipeline — Perception, STT, LLM, TTS. The
  avatar does not hear or see the caller; the caller's mic keeps flowing
  through YOUR path to the S2S model.
- Audio is 24 kHz PCM — natively what gpt-realtime and Gemini emit, so the
  hot path never resamples (the adapter resamples if handed anything else).
- Interruption logic is yours. Ours is conformance-enforced on both sides.
- `disconnect()` ends the conversation so the Daily room (and the meter)
  actually closes.

## Verification honesty

Same posture as every adapter in this series: the conformance suite proves
an adapter is wired correctly against its own reading of the protocol — via
harnesses that capture real wire frames, no `__conformance` shims in
production code — and only a live call with credentials proves the reading.
The Tavus interaction *transport* is injectable (`sendInteraction`) because
that is the part a live test is most likely to move (e.g. onto the Daily
data channel).

## Roadmap

- Anam audio-passthrough adapter — [#71](https://github.com/porkytheblack/glove/issues/71)
- LiveKit as a room transport (the plugin catalogue for free) — [#72](https://github.com/porkytheblack/glove/issues/72)

See `examples/avatar-rooms` for the full layered integration.
