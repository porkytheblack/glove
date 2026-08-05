# Server-side voice — the client is an audio duct

The same starship-shop voice agent as [`examples/layered-voice`](../layered-voice),
with the entire pipeline moved off the browser and onto the server. This is the
architecture every production voice platform converges on (LiveKit Agents,
Pipecat, Vapi, Retell): the client captures a microphone and plays back audio,
and **every decision happens server-side**.

`examples/layered-voice` is unchanged and still the browser-hosted reference.
This example is the other half of the comparison.

```
  Next.js app (:3000)          room SIGNAL RUN — one per call, up to an hour
  ───────────────────          ────────────────────────────────────────────
  POST /api/rooms ─────────▶   POST /api/v1/trigger → room runs on :450n
                               VAD → STT → turn detector → front agent
  mic ──PCM16──────────────▶                                  │
  speakers ◀────PCM16───────   TTS ◀──── <speech> parser ◀─────┤
                                                              │
                                          glove_mesh_send_message (blocking)
                                                              │
                                                 research SIGNAL — own process
                                                              │   worker + 12 DB tools
                               POST /mesh ◀────────────────────┘
                               threaded reply resolves her mesh:waiting item
```

Three processes, each doing the thing it is actually good at: **Next.js** serves
the UI and allocates rooms, a **room run** holds one conversation and all the
audio work, and a **research run** does the heavy lookups and reports back over
the mesh.

## What the client still does, and what it stopped doing

| | browser-hosted | server-side (this) |
| --- | --- | --- |
| mic capture, playback | client | client |
| echo cancellation | client (`getUserMedia`) | client (`getUserMedia`) |
| VAD | client (Silero) | **server** (Silero) |
| STT socket + API tokens | client (token routes) | **server** (holds the key) |
| endpointing / turn detection | client → HTTP → model | **server, in-process** |
| dispatch, dedupe, phantom filtering | client | **server** |
| barge-in decision | client | **server** (client just drops its buffer) |
| agent, TTS, delegation | server | server |
| client size | ~1100-line commitment engine | ~200 lines of plumbing |

The client-side code that remains is `web/app/lib/useRoom.ts` plus two audio
worklets. It holds no API keys, runs no VAD, and makes no endpointing decisions.

## Why this is faster, not just tidier

- **The turn detector is a function call.** In the browser pipeline the
  commitment engine runs in the tab and the LiveKit end-of-utterance model runs
  on the server, so *every VAD boundary* costs an HTTP round trip with a 350ms
  timeout and a heuristic fallback for when the network is slow. Here they share
  a process: ~25ms of ONNX inference and nothing else.
- **No token minting.** The room opens the ElevenLabs sockets directly with the
  key it already holds — no `/api/voice/*-token` round trip per session.
- **Tuning needs no client deploy.** Hold bounds, freshness windows and the
  pacing curve are server config. The "your browser is running last week's
  endpointing" class of bug cannot happen.
- **Telephony becomes possible.** A SIP trunk can terminate at the same room a
  browser does; the session logic does not know the difference.

The cost is one extra network hop for audio (browser → room → ElevenLabs
instead of browser → ElevenLabs). It is roughly a wash against the round trips
that were deleted, and it buys everything above.

## Why station

A voice session is a long-lived, stateful duplex connection. It cannot live in
a serverless function, and a bare `node server.js` gives you nothing when it
falls over. Station supplies the two primitives this architecture actually
needs:

**A room is a long-lived `signal` run** — one call, one child process, up to an
hour. The whole lifecycle is three v1 calls:

```
start    POST /api/v1/trigger          { signalName: "room", input }   scope: trigger
ready    GET  /api/v1/runs/:id                                         scope: read
hang up  POST /api/v1/runs/:id/cancel                                  scope: cancel
```

Because the room is the process and not the socket, it **outlives the page**:
reload the tab and you reattach to the same conversation, with the front agent's
history and any in-flight delegation intact. A cancel and the run timeout both
arrive as `SIGTERM`, which the room turns into a graceful close — sockets shut,
agent torn down, port released. Abandoned rooms end themselves after ten idle
minutes; the hour is the backstop for a caller who never hangs up.

Beacons are the more obvious fit for "supervised long-running process", and
this started there. The reason it moved: **beacon control exists only on
station's dashboard API, which authenticates with a session cookie** — there
are no beacon routes under `/api/v1`, so an API key cannot start or stop one.
Rooms as signals put the entire lifecycle on the surface a key can drive, so
the web app holds one credential and no password. The cost is a beacon's
`restart("always")` and heartbeat stall detection: a crashed room is a failed
run and the caller lands in a NEW room rather than a restarted one — which for
a voice call is arguably clearer, since a silently restarted room would come
back with an empty conversation anyway.

**Each delegation is a `signal` too** — a short job rather than an hour-long
one, run to completion in its own child process, with a timeout, retries, and a
durable Run record. It is
dispatched fire-and-forget and **consolidates back over the mesh**: the worker
replies with `glove_mesh_send_message` threaded via `in_reply_to`, which
resolves the front agent's pending `mesh:waiting` item and wakes her with the
findings (§5) — exactly as in `layered-voice`. Only the transport underneath
differs, because the two agents no longer share a process:

- room side: a `MeshAdapter` whose `send()` queues the signal run
- worker side: a `MeshAdapter` whose `send()` POSTs to the room's `/mesh`

`MeshAdapter`'s contract anticipates this ("in-process broker, Redis pub/sub,
NATS, HTTP webhooks…"), so neither agent can tell the difference. Running the
worker as a signal rather than an in-process peer buys three things the
in-process bus cannot:

- The heavy agent cannot take the voice loop down with it. Different process.
- The job is in the database before the worker starts, so losing the caller's
  socket never loses the delegation.
- Every delegation is inspectable afterwards — what was asked, what came back,
  how long it took, what retried. Voice systems are miserable to debug precisely
  because that record normally does not exist.

The trade: each run is a cold process with no conversation memory, which is why
the front agent's prompt insists on a **self-contained** request. For
research work that is the right shape anyway, and it makes retries safe.

### Knowing when you stopped talking

Two models decide this, and they answer different questions.

**Silero** (`lib/silero-vad-node.ts`) answers "is this speech?" per 32ms frame.
The browser example uses it through `@ricky0123/vad-web`, which is
onnxruntime-WEB; this runs the same v5 weights through onnxruntime-node, with
the frame state machine implemented directly. The weights ship inside the
vad-web package glove-voice already depends on, so there is nothing to
download.

The energy VAD it replaces thresholds loudness against a drifting noise floor,
and that is not the same question. Measured on the same clips: a quiet talker
scores **P=0.85** with Silero and falls under the energy threshold entirely;
loud broadband noise scores **P=0.12** with Silero and reads as speech to an
energy threshold. A missed boundary is expensive — the utterance falls to the
idle sweeper, arriving late or (before the freshness fix) not at all.

Silero also separates tentative from confirmed speech, which the energy VAD
cannot express: `speech_start` on the first speech-ish frame,
`speech_real_start` once it has outlasted `minSpeechMs`, `vad_misfire` when it
has not. Barge-in fires on CONFIRMED speech, so a cough no longer cuts the
agent off — the energy path has to guess with a 250ms timer instead.

**The LiveKit end-of-utterance model** then answers the different question:
"was that a complete thought?" — reading the transcript, not the audio. Silero
says the sound stopped; the EOU model says whether you were finished. Its
probability shapes the hold between `TURN_MIN_HOLD_MS` and `TURN_MAX_HOLD_MS`.

If Silero fails to load the room says so in its logs and falls back to the
energy VAD — worse, but serving.

### A promise the room heard must end in a real dispatch

Front models acknowledge without actually calling the tool often enough to
matter. With Kimi K2 the usual cause is the provider not parsing the model's
tool-call syntax back out of the token stream, so the call arrives as plain
text and the framework never sees it. Two shapes observed live:

```
<invoke name="glove_mesh_send_message"><parameter name="content">…</parameter>
glove_mesh_send_message:0<|tool_call_argument_begin|>{"to":"worker",…}<|tool_call_end|>
```

Nova has already said "checking on that", so a miss means the customer waits
forever. Three guards, cheapest first:

1. **Salvage.** The request is sitting in the raw output either way — the XML
   form is matched by regex, the native-token form by finding the first
   balanced JSON object after the tool name and reading `content` from it.
   Dispatch it directly, no extra model round.
2. **Nudge.** If she *spoke* a promise but nothing dispatched, run one silent
   corrective turn that forces the call.
3. **Enforced silence.** The nudge turn's speech is parsed but never reaches
   TTS. This one is not politeness — a nudged model that ignores "say nothing"
   will happily invent an answer, and reading a wrong warranty date to a
   customer is worse than saying nothing at all. Measured: it did exactly that
   before the guard existed.

Every path is counted in the metrics log (`delegation_salvaged`,
`delegation_nudge`, `delegation_recovered`) so the failure rate is visible
rather than folded into "it usually works".

One rough edge remains, and the guards cannot fix it: when the model emits
*only* a malformed tool call and no `<speech>` at all, the work is still
recovered and the answer still arrives, but Nova says nothing on that turn.
Setting `FRONT_MODEL` to a model whose tool calls the provider parses reliably
avoids the whole class.

## Run it

Two processes, in two terminals.

```bash
cp .env.example .env.local     # provider keys + STATION_USERNAME / STATION_PASSWORD
pnpm install

pnpm start                     # 1. the backend → `station`
pnpm key "web app" trigger read cancel      # 2. mint the app's only credential
#    → paste the key into .env.local as STATION_API_KEY
pnpm --filter glove-server-voice-web dev    # 3. the app you test in
```

That one `.env.local` serves everything — station, the scripts, the Next.js app,
and every room and research run (child processes inherit station's environment).
station's CLI does not read dotfiles by itself, so `lib/load-env.ts` loads it
from `station.config.ts` and the scripts, and `web/next.config.ts` loads it for
the app. Anything exported in your shell still wins.

`STATION_USERNAME` and `STATION_PASSWORD` are **required** — station refuses to
boot without them, with no default. Its API can start and stop processes on the
host, so an unauthenticated one is a remote-execution endpoint and a built-in
default password is the same thing with extra steps.

`station` reads `station.config.ts`, builds the signal runner from `signals/`,
runs rooms and research jobs, and serves the dashboard. Nothing starts until the
app triggers a room.

- **http://localhost:3000** — the app. Hit Connect: it claims a room, waits for
  it to come up, then streams your microphone to it.
- **http://localhost:4400** — the dashboard. `/signals` and `/runs` carry both
  kinds of work: every call is a room run with a duration, an outcome and its
  logs, and every delegation shows its input, answer and attempts. `/env`
  manages the provider keys injected into runs.

The first room to start downloads the open [`livekit/turn-detector`](https://huggingface.co/livekit/turn-detector)
weights (~150MB, one-time, into the HF cache) — so the first Connect is slow and
every later one is not. A room loads the model *before* reporting itself ready,
so no caller ever talks to a room that would pay for it mid-conversation. If the download
fails the gateway still serves — `LocalTurnDetector` falls back to the
heuristic tiers.

```bash
PORT=4501 pnpm smoke           # end-to-end check against a room, no mic needed
pnpm runs                      # the durable delegation records
pnpm key                       # mint an API key for station's v1 API
```

### Credentials

The web app holds **one** credential: a station API key with `trigger`, `read`
and `cancel`. That is the whole room lifecycle. No login, no session, no
password in the app at all.

`STATION_USERNAME` / `STATION_PASSWORD` are for station itself — the dashboard
login, and minting keys with `pnpm key`. The app never sees them.

This split is forced by station's two credential types, which do **not** cover
the same surface, and it is the reason rooms are signals:

| | `/api/*` (dashboard API) | `/api/v1/*` (programmatic API) |
| --- | --- | --- |
| session cookie (login) | ✅ | ✅ |
| API key (`Authorization: Bearer sk_live_…`) | ❌ 401 "Session required" | ✅ scoped |
| beacon start / stop | ✅ only here | ✗ no beacon routes |
| signal trigger / run cancel | ✅ | ✅ |

The key never reaches the browser either. The client is handed a WebSocket URL
and nothing else.

### Things to try

- **Ask about a hull.** "Nova, is hull KES-0007 still under warranty?" — watch
  the delegation appear as a Run in the dashboard while Nova acknowledges out
  loud and keeps the floor.
- **Talk over her.** Barge-in is decided server-side; the browser just drops its
  buffer when told. The next turn tells the model exactly how much of the cut
  line the room actually heard.
- **Switch speaker** in the dropdown and talk *about* Nova rather than to her.
  She hears every line and decides for herself whether she was addressed.
- **Reload the page mid-conversation.** The room is the process, not the
  socket: you reattach to the same conversation with its history intact.
- **Watch the pool.** Connect from several tabs; each triggers its own room run
  on its own port, and the fifth is refused rather than silently sharing one.
  Ports are allocated from station's run records, not by probing, so
  simultaneous claims cannot collide.
- **Hang up and check the dashboard.** The run shows as `cancelled` with its
  logs and duration — every call leaves an audit trail.

## S2S rooms — the same layering on a speech-to-speech model

The room pool has a second flavour: pick **s2s room** in the app's header
before connecting (or `POST /api/rooms` with `{ "mode": "s2s" }`). It claims
the same kind of long-lived signal run on the same ports — but the run is
`signals/s2s-room.ts`, which replaces the entire cascaded pipeline
(VAD → STT → endpointing → front model → TTS, ~2200 lines of session
machinery) with one `RealtimeAgent` from `glove-voice-s2s` on a Gemini Live
session in transport mode.

What stays exactly the same is the LAYERING:

- **The front is thin, the worker is the capable model.** The realtime model
  IS Nova — persona, turn-taking, barge-in, the voice — and it still cannot
  look anything up. Every catalog fact is delegated.
- **The rooms are the communication primitive.** Delegation is the same
  `glove_mesh_send_message` tool folded by `mountMesh`, dispatched as the
  same `research` signal run, replying to the same `/mesh` endpoint with the
  same mesh token. The worker cannot tell which room flavour asked.
- **The client is untouched.** Same audio duct, same protocol; the room
  resamples Gemini's 24 kHz output to the duct's 16 kHz.

What changes is who drives the front agent: `RealtimeAgent` reads the same
Glove declaration (prompt, tools, mesh send) to configure the live session,
executes each tool call through the same `Tool.run`, and when the worker's
reply lands at `/mesh`, the room injects it into the live conversation with
`rt.inject("<worker-result>…", { respond: true })` — the proactive-relay
wakeup, spoken by the provider instead of synthesized by a TTS stage.

Two providers, one room: **OpenAI Realtime** (gpt-realtime over WebSocket,
`OpenAIRealtimeSocketAdapter`) or **Gemini Live** (`GeminiLiveAdapter`).
Set `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env.local` — the room defaults
to whichever is present (OpenAI first; force with `S2S_PROVIDER`). Needs
Node 22+ for the global WebSocket. `S2S_MODEL` / `S2S_VOICE` are optional
overrides.

## Files

| | |
| --- | --- |
| `station.config.ts` | the whole deployment: dirs, adapters, dashboard port |
| `signals/room.ts` | a room — WebSocket audio in/out, `/mesh` inbound |
| `signals/s2s-room.ts` | the S2S flavour — same room, pipeline replaced by `RealtimeAgent` + Gemini Live |
| `signals/research.ts` | the delegation job, replying over the mesh — shared by both room flavours |
| `lib/s2s-front-agent.ts` | Nova for S2S rooms: the audio-channel prompt machinery gone, the selling and delegation rules kept |
| `lib/mesh-transport.ts` | the two mesh adapters that span the process boundary |
| `web/` | the Next.js app you actually test in |
| `lib/turn-engine.ts` | the commitment engine, ported from the browser hook |
| `lib/silero-vad-node.ts` | the neural VAD, onnxruntime-node instead of -web |
| `lib/turn-detector-local.ts` | in-process end-of-utterance scoring |
| `lib/voice-session.ts` | per-caller orchestration: STT, agent, TTS, barge-in |
| `lib/front-agent.ts` / `lib/worker-agent.ts` | Nova and the researcher |
| `lib/protocol.ts` | the whole client/server contract |
| `lib/load-env.ts` | puts `.env.local` where station and its children can see it |
| [`PRODUCTION.md`](./PRODUCTION.md) | adapting this pattern for real: invariants, the failure taxonomy, and what here is demo-grade |

Timings stream to the browser and append to `voice-metrics.jsonl`:
`front_ttft_ms`, `tts_first_audio_ms`, `stt_dispatch_ms`, `endpoint_hold`,
`barge_in`, `delegation_roundtrip_ms`, plus the phantom/sweep counters the
commitment engine emits.
