# s2s-rooms — the layered voice architecture on a speech-to-speech model

The third step in the voice-example series, kept as its own example so every
step stays runnable:

| example | pipeline | where it runs |
| --- | --- | --- |
| [`examples/layered-voice`](../layered-voice) | cascade (VAD → STT → LLM → TTS) | browser-hosted |
| [`examples/server-voice`](../server-voice) | cascade | server rooms (station signals) |
| **this** | **speech-to-speech** — one realtime model | server rooms (station signals) |

Same starship shop, same layering, same primitives as `server-voice` — and
the entire cascaded pipeline (~2200 lines of VAD/STT/endpointing/TTS session
machinery) deleted, because a speech-to-speech model can hear:

```
  Next.js app (:3001)          s2s-room SIGNAL RUN — one per call
  ───────────────────          ─────────────────────────────────────────────
  POST /api/rooms ─────────▶   POST /api/v1/trigger → room runs on :460n
  mic ──16k PCM────────────▶   RealtimeAgent + OpenAI gpt-realtime (or
  speakers ◀──16k PCM──────    Gemini Live) in transport mode — the model
                               IS Nova: voice, turn-taking, barge-in
                                              │ glove_mesh_send_message
                                              ▼
                               research SIGNAL — the capable worker, own
                               process, full shop-DB tool surface
                                              │ threaded mesh reply
  POST /mesh ◀──────────────────────────────────┘
    └─▶ rt.inject("<worker-result>…", { respond: true })  — spoken relay
```

What is preserved from the layered architecture:

- **Thin front, capable worker.** The realtime model is Nova — persona and
  the spoken channel — and still cannot look anything up. Every catalog
  fact delegates to the worker (`lib/worker-agent.ts`, unchanged from
  `server-voice`), run as a `research` signal with retries, a timeout and a
  durable Run record.
- **Rooms as the communication primitive.** A room is a long-lived signal
  run owning one conversation; delegation is the same
  `glove_mesh_send_message` folded by `mountMesh`, crossing processes via
  `lib/mesh-transport.ts`; the reply lands on the room's `/mesh` endpoint
  and is injected into the LIVE session with `respond: true`.
- **The client is a duct.** `web/` ships 16 kHz PCM up and plays 16 kHz
  down; the room resamples to whatever the adapter declares (OpenAI is
  24 kHz both ways, Gemini 16 in / 24 out).

What is gone: `voice-session.ts`, `turn-engine.ts`, the server-side Silero
VAD, the end-of-utterance model, the TTS stage, and the ~90 lines of
front-agent prompt about surviving a hostile audio channel
(`lib/s2s-front-agent.ts` keeps only the selling and delegation rules).

## Run it

```bash
cp .env.example .env.local     # OPENAI_API_KEY (or GEMINI_API_KEY),
                               # OPENROUTER_API_KEY for the worker,
                               # STATION_USERNAME / STATION_PASSWORD

pnpm install                   # from the repo root
pnpm start                     # station: runner + dashboard on :4410
pnpm key "web app" trigger read cancel   # → STATION_API_KEY into .env.local

cd web && pnpm dev             # the app on :3001
```

Open http://localhost:3001, Connect, allow the mic, and talk to Nova. Ask
for a price or a ship and watch the delegation run appear in the station
dashboard (http://localhost:4410/signals) and the answer come back over the
mesh into the live call.

Ports are shifted so this runs SIDE BY SIDE with `server-voice`: station
:4410, rooms :4601+, web :3001.

## Providers

`signals/s2s-room.ts` takes a `provider` input (default: `S2S_PROVIDER`,
else whichever of `OPENAI_API_KEY` / `GEMINI_API_KEY` is set, OpenAI
first):

| provider | adapter | audio |
| --- | --- | --- |
| `openai` | `OpenAIRealtimeSocketAdapter` (gpt-realtime over WebSocket) | 24 kHz both ways |
| `gemini` | `GeminiLiveAdapter` | 16 kHz in, 24 kHz out |

Both implement the same transport-mode `S2SAdapter` contract from
`glove-voice-s2s`, so the room is identical from the adapter down. Needs
Node 22+ (global WebSocket).

## Files

| | |
| --- | --- |
| `station.config.ts` | the whole deployment: signals dir, adapters, dashboard on :4410 |
| `signals/s2s-room.ts` | a room — audio duct, RealtimeAgent, `/mesh` inbound |
| `signals/research.ts` | the delegation job, replying over the mesh (as in server-voice) |
| `lib/s2s-front-agent.ts` | Nova, minus the audio-channel machinery |
| `lib/worker-agent.ts` | the capable worker (as in server-voice) |
| `lib/mesh-transport.ts` | the two mesh adapters spanning the process boundary |
| `web/` | the audio-duct client (as in server-voice, s2s-only) |
