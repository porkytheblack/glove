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
| `TavusEchoAdapter` | first concrete adapter: Tavus `pipeline_mode: "echo"` — our PCM frames as base64 24 kHz `conversation.echo` events; the caller joins the conversation's Daily room |
| `ensureEchoPal` | reuse-or-create the MINIMAL echo PAL (no greeting, no TTS layer) — the ecosystem pattern that keeps the opening silent; used automatically when `palId` is omitted |
| `AnamPassthroughAdapter` | second concrete adapter: Anam audio-passthrough mode (`enableAudioPassthrough` on the persona — Anam's LLM/TTS stay out of the loop). The server mints the session token; the BROWSER owns the SDK session and audio input, so the adapter requires a `sendCommand` courier ferrying `audio_chunk` / `end_sequence` / `interrupt` commands to the joined client |
| `attachAvatar(rt, avatar)` | the one-call bridge from a `RealtimeAgent`: `audio` → `sendAudio`, `agent_speech_stopped` → `endUtterance`, `interrupted` → `interrupt`. Returns a detach fn |
| `runAvatarConformance` | the behavioural suite every adapter must pass against a fake transport |

## Usage

```ts
import { RealtimeAgent } from "glove-voice-s2s";
import { TavusEchoAdapter, attachAvatar } from "glove-voice-avatar";

const rt = new RealtimeAgent({ agent });   // the voice stack, exactly as before
await rt.start();

const avatar = new TavusEchoAdapter({
  apiKey: process.env.TAVUS_API_KEY!,       // server-side only
  faceId: process.env.TAVUS_FACE_ID!,       // the face it renders
  // palId omitted → ensureEchoPal() reuses-or-creates a MINIMAL echo PAL
  // (no greeting, no TTS layer) so the ONLY voice is ever the agent's.
  // Interactions travel ONLY over the Daily data channel — supply the
  // courier: a joined browser participant relaying events (what
  // examples/avatar-rooms does via its WS duct), or a server-side Daily SDK.
  sendInteraction: (event) => duct.send({ t: "avatar_interaction", event }),
});
const detach = await attachAvatar(rt, avatar);

avatar.view; // { kind: "webrtc-room", url: "https://tavus.daily.co/…" } — hand to the client
```

Barge-in follows the voice automatically: the S2S side's `interrupted`
(which #67 made unconditional) drives the avatar's `interrupt()`, which
drops the buffered tail and frames the provider interrupt — the face stops
with the voice, and the next utterance starts a fresh inference.

### Anam (audio passthrough)

```ts
import { AnamPassthroughAdapter } from "glove-voice-avatar";

const avatar = new AnamPassthroughAdapter({
  apiKey: process.env.ANAM_API_KEY!,        // server-side only
  avatarId: process.env.ANAM_AVATAR_ID!,
  // Anam's passthrough audio input lives on the BROWSER SDK
  // (createAgentAudioInputStream) — supply the courier to the joined client:
  sendCommand: (command) => duct.send({ t: "avatar_command", command }),
});
const detach = await attachAvatar(rt, avatar);

avatar.view; // { kind: "sdk-session", sessionToken, provider: "anam" } — the
             // browser boots @anam-ai/js-sdk from it (disableInputAudio: true)
```

The browser applies commands to the SDK session: `audio_chunk` →
`sendAudioChunk(base64)` (16 kHz pcm_s16le), `end_sequence` →
`endSequence()`, `interrupt` → `interruptPersona()` + `endSequence()`.

**Plan-cap fact worth knowing:** Anam force-ends conversations at its plan
limit (3/5/10 minutes on Free/Starter/Explorer; unlimited on Growth+) —
the connection closes with `SERVER_CLOSED_CONNECTION` regardless of
`maxSessionLengthSeconds`. Treat it as routine and RENEW: `disconnect()` +
`connect()` mints a fresh session and the client re-attaches from the new
`view` (`examples/avatar-rooms` does this automatically on its
`avatar_refresh` round trip — the face blinks instead of dying). The
adapter also pins `silenceBeforeSessionEndSeconds` high by default: the
avatar hears nothing by design, so silence-based ending would kill every
healthy call at the first long pause.

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
production code — and a live call proves the reading. The wire facts (create
with `pal_id`+`face_id`, bare `conversation.interrupt`, data-channel-only
interactions) are synced against docs.tavus.io's llms.txt index, and the
Tavus adapter is **live-verified** (2026-08-05) through
`examples/avatar-rooms` — including the silent open via the ensured
minimal PAL and single-voice echo throughout. `sendInteraction` is REQUIRED precisely because
the data channel is the only interaction transport and the adapter
deliberately does not own a Daily connection.

The Anam adapter is synced against anam.ai/docs (llms.txt index) and
`@anam-ai/js-sdk@4.23.1`'s type declarations; live verification is tracked
on [#71](https://github.com/porkytheblack/glove/issues/71).

## Related

- **LiveKit avatars** — [`glove-voice-livekit`](../glove-voice-livekit)
  implements this same `AvatarAdapter` contract over LiveKit's avatar
  protocol (the provider's worker joins YOUR LiveKit room), with Tavus and
  Anam variants — [#72](https://github.com/porkytheblack/glove/issues/72).

See `examples/avatar-rooms` for the full layered integration
(`AVATAR_PROVIDER=tavus|anam`), and `examples/livekit-rooms` for the
LiveKit transport variant.
