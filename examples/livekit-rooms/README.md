# livekit-rooms — the layered voice architecture over a LiveKit transport

The fifth step in the voice-example series, kept as its own example so every
step stays runnable ([#72](https://github.com/porkytheblack/glove/issues/72)):

| example | pipeline | transport |
| --- | --- | --- |
| [`examples/layered-voice`](../layered-voice) | cascade (VAD → STT → LLM → TTS) | browser-hosted |
| [`examples/server-voice`](../server-voice) | cascade | bespoke WS duct (raw PCM) |
| [`examples/s2s-rooms`](../s2s-rooms) | speech-to-speech | bespoke WS duct |
| [`examples/avatar-rooms`](../avatar-rooms) | speech-to-speech + Tavus face | duct up, Daily room down |
| **this** | speech-to-speech | **LiveKit, both directions** |

Same starship shop, same layering — thin front agent driven by the realtime
model, capable worker over the mesh, rooms as station signal runs — but the
audio duct is replaced by a LiveKit session:

```
  Next.js app (:3003)            livekit-room SIGNAL RUN — one per call
  ───────────────────            ──────────────────────────────────────────────
  Room.connect(url, token)       agent joins the SAME LiveKit room via
  setMicrophoneEnabled(true)     @livekit/rtc-node:
        │  WebRTC tracks              mic track  ──▶ resample ──▶ S2S model
        ▼                             S2S audio  ──▶ AudioSource ──▶ agent track
  ┌─────────────────┐                 barge-in   ──▶ source.clearQueue()
  │  LiveKit room   │◀───────────     transcripts/state ──▶ data channel JSON
  └─────────────────┘
                                        │ glove_mesh_send_message
                                        ▼
                                  research SIGNAL — the worker (unchanged)
                                        │ threaded mesh reply
  POST /mesh (:480x) ◀──────────────────┘ → rt.inject(…, { respond: true })
```

What the transport swap buys, measured in deleted code: the browser hook drops
from ~500 lines to ~250 — no audio worklets, no playback ring buffer, no local
VAD reflex, no pause/resume/clear dance, no drain accounting. LiveKit's WebRTC
stack owns capture, echo cancellation, jitter and codecs; barge-in is
server-authoritative (the room flushes its own outbound `AudioSource` queue,
so there is no client buffer to chase). The room's HTTP port now carries only
`/health` and `/mesh` — audio never touches it.

## Run it

You need a LiveKit server. The Cloud free tier works: create a project at
cloud.livekit.io and copy the URL + API key/secret. (Self-hosted works too.)

```bash
cp .env.example .env.local
# LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET   — the transport
# OPENAI_API_KEY (or GEMINI_API_KEY)                   — the brain + voice
# OPENROUTER_API_KEY                                   — the worker
# STATION_USERNAME / STATION_PASSWORD

pnpm install                   # from the repo root
pnpm start                     # station: runner + dashboard on :4430
pnpm key "web app" trigger read cancel   # → STATION_API_KEY into .env.local

cd web && pnpm dev             # the app on :3003
```

Open http://localhost:3003, Connect, and allow the mic. The app triggers a
`livekit-room` signal run, mints a caller token server-side (the browser never
sees the API secret), and joins the LiveKit room the agent is already sitting
in. Ask for a price and watch the delegation run in the station dashboard
(:4430/signals) while the conversation keeps flowing.

Ports are shifted so this runs side by side with the whole series: station
:4430, room signal ports :4801+ (health + mesh only), web :3003.

## Status

Milestone 1 of [#72](https://github.com/porkytheblack/glove/issues/72): voice
transport parity with `s2s-rooms` — layered agents, mesh delegation,
server-authoritative barge-in — over LiveKit. Milestone 2 (the avatar
catalogue joining the room as a participant) comes next.
