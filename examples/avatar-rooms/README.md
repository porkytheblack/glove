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
  Daily room iframe ◀───────── TavusEchoAdapter — lip-syncs into the
  (the face AND the voice)     conversation's Daily room
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
# TAVUS_API_KEY + TAVUS_PERSONA_ID    — the face (persona with pipeline_mode "echo")
# STATION_USERNAME / STATION_PASSWORD

pnpm install                   # from the repo root
pnpm start                     # station: runner + dashboard on :4420
pnpm key "web app" trigger read cancel   # → STATION_API_KEY into .env.local

cd web && pnpm dev             # the app on :3002
```

Open http://localhost:3002, Connect, allow the mic, and join the embedded
Daily room when it appears (its mic can stay off — the room is the agent's
face and voice; YOUR mic flows through this page). Ask for a price and watch
the delegation run in the station dashboard (:4420/signals) while the avatar
holds the floor.

Ports are shifted so this runs side by side with the whole series: station
:4420, rooms :4701+, web :3002.

## Status

The `AvatarAdapter` contract and Tavus adapter pass the avatar conformance
suite; **nothing here has spoken to the live Tavus API yet** — this example
is that verification, same as `s2s-rooms` was for gpt-realtime. Anam
passthrough ([#71](https://github.com/porkytheblack/glove/issues/71)) and a
LiveKit transport variant
([#72](https://github.com/porkytheblack/glove/issues/72)) come next.
