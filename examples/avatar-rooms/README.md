# avatar-rooms — the layered voice architecture, with a face

The fourth step in the voice-example series, kept as its own example so every
step stays runnable ([#70](https://github.com/porkytheblack/glove/issues/70)):

| example | pipeline | surface |
| --- | --- | --- |
| [`examples/layered-voice`](../layered-voice) | cascade (VAD → STT → LLM → TTS) | browser-hosted, audio |
| [`examples/server-voice`](../server-voice) | cascade | server rooms, audio |
| [`examples/s2s-rooms`](../s2s-rooms) | speech-to-speech | server rooms, audio |
| **this** | speech-to-speech | server rooms, **live avatar video** |

Same starship shop, same layering — thin front agent driven by the realtime
model, capable worker over the mesh, rooms as station signal runs — plus a
**Tavus echo** avatar as the agent's face:

```
  Next.js app (:3002)          avatar-room SIGNAL RUN — one per call
  ───────────────────          ─────────────────────────────────────────────
  mic ──16k PCM (duct)──▶      RealtimeAgent (gpt-realtime / Gemini Live)
  transcripts ◀── (duct)              │ agent PCM (24 kHz)
                                      ▼
  Daily call object ◀───────── TavusEchoAdapter — frames conversation.echo
  (the face AND the voice,     events; the BROWSER relays them into the
   plus the event courier)     Daily data channel (the only transport
                               Tavus interactions have)
                                      │ glove_mesh_send_message
                                      ▼
                               research SIGNAL — the worker (unchanged)
                                      │ threaded mesh reply
  POST /mesh ◀────────────────────────┘ → rt.inject(…, { respond: true })
```

The split that makes it work: **your mic still flows up our duct to the S2S
model** (echo mode has no perception — the avatar can't hear), and **the
agent's voice now arrives through the Daily room instead of down the duct**
(sending both would double the audio). Barge-in chains all the way through:
provider VAD → S2S `interrupted` → playback flush + `attachAvatar` bridge →
Tavus interrupt — the face stops with the voice.

## Run it

```bash
cp .env.example .env.local
# OPENAI_API_KEY (or GEMINI_API_KEY)  — the brain + voice
# OPENROUTER_API_KEY                  — the worker
# TAVUS_API_KEY + TAVUS_FACE_ID       — the face (a minimal echo PAL is ensured automatically)
# STATION_USERNAME / STATION_PASSWORD

pnpm install                   # from the repo root
pnpm start                     # station: runner + dashboard on :4420
pnpm key "web app" trigger read cancel   # → STATION_API_KEY into .env.local

cd web && pnpm dev             # the app on :3002
```

Open http://localhost:3002, Connect, and allow the mic. The page joins the
avatar's Daily room automatically (muted — the room is the agent's face and
voice; YOUR mic flows through this page's duct) and doubles as the event
courier: Tavus interactions only travel over the Daily data channel, so the
room sends them down the WS and the browser relays them via sendAppMessage.
Ask for a price and watch the delegation run in the station dashboard
(:4420/signals) while the avatar holds the floor.

Ports are shifted so this runs side by side with the whole series: station
:4420, rooms :4701+, web :3002.

## Debugging the realtime provider

If a call connects but the agent never answers, probe the provider directly —
it drives the same agent and tools the room does, minus the microphone, and
prints the provider's own error (a rejected setup frame is the usual cause,
and it otherwise presents as silence):

```bash
pnpm probe:gemini          # → "✓ WORKING — 48000 audio samples back" or the close reason
pnpm probe:gemini --list   # → which models THIS key can open a Live session with
```

`--list` exists because Gemini's most common failure — `<model> is not found
for API version v1beta, or is not supported for bidiGenerateContent` — has
three causes the message can't tell apart (wrong model id, wrong API version,
no Live access on the key). It asks Google directly and prints the
`S2S_MODEL=` / `S2S_API_VERSION=` lines to paste into `.env.local`. Newer
preview models frequently land on `v1alpha` before `v1beta`.

## Status

**Tavus: live-verified against the Tavus API** (2026-08-05): conversation
create, echo audio through the browser courier, the rendered face, barge-in,
and the silent open (ensured minimal PAL — no second voice) all confirmed
working end to end, on top of the conformance suite.

**Anam: wired, awaiting live verification**
([#71](https://github.com/porkytheblack/glove/issues/71)): set
`AVATAR_PROVIDER=anam` + `ANAM_API_KEY`/`ANAM_AVATAR_ID` and the room swaps
the face to `AnamPassthroughAdapter` (audio-passthrough mode — Anam's LLM and
TTS stay out of the loop). The duct is the courier here too: the room sends
commands down the WS and the browser applies them to the Anam SDK session
(`sendAudioChunk` / `endSequence` / `interruptPersona`). Conformance-tested;
needs a live run with an Anam key.

The LiveKit transport variant
([#72](https://github.com/porkytheblack/glove/issues/72)) lives in
[`examples/livekit-rooms`](../livekit-rooms) with both providers as LiveKit
avatars.
