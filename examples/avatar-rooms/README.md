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
# TAVUS_API_KEY + TAVUS_PAL_ID + TAVUS_FACE_ID — the face (PAL with pipeline_mode "echo")
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

## Status

**Live-verified against the Tavus API** (2026-08-05): conversation create,
echo audio through the browser courier, and the rendered face all confirmed
working end to end, on top of the conformance suite. Anam passthrough
([#71](https://github.com/porkytheblack/glove/issues/71)) and a LiveKit
transport variant ([#72](https://github.com/porkytheblack/glove/issues/72))
come next.
