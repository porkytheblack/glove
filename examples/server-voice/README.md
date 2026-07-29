# Server-side voice — the client is an audio duct

The same starship-shop voice agent as [`examples/layered-voice`](../layered-voice),
with the entire pipeline moved off the browser and onto the server. This is the
architecture every production voice platform converges on (LiveKit Agents,
Pipecat, Vapi, Retell): the client captures a microphone and plays back audio,
and **every decision happens server-side**.

`examples/layered-voice` is unchanged and still the browser-hosted reference.
This example is the other half of the comparison.

```
  Next.js app (:3000)          room BEACON — one per room, started on demand
  ───────────────────          ────────────────────────────────────────────
  POST /api/rooms ─────────▶   station starts room-N on :450N
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
the UI and allocates rooms, a **room beacon** holds one durable conversation and
all the audio work, and a **signal run** does the heavy research and reports
back over the mesh.

## What the client still does, and what it stopped doing

| | browser-hosted | server-side (this) |
| --- | --- | --- |
| mic capture, playback | client | client |
| echo cancellation | client (`getUserMedia`) | client (`getUserMedia`) |
| VAD | client | **server** |
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

**A room is a `beacon`** — a supervised, long-running process that owns ONE
conversation. Rooms are `.manualStart()`, so a slot sits stopped until the app
claims it:

```
POST /api/beacons/room-2/start   { "config": { "roomId": "…", "port": 4502 } }
POST /api/beacons/room-2/stop    ← hang up, slot released
```

Because the room is the process and not the socket, it **outlives the page**:
reload the tab and you reattach to the same conversation, with the front agent's
history and any in-flight delegation intact. `restart("always")` brings a
crashed room back mid-call; `.heartbeat("10s")` recycles a wedged event loop;
`ctx.onStop` drains the caller's socket politely; and the dashboard shows a row
per room with incarnation, uptime and live logs.

**Each delegation is a `signal`** — a discrete job, run to completion in its own
child process, with a timeout, retries, and a durable Run record. It is
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
- The job is in the database before the worker starts, so a gateway restart
  loses the caller's socket but never the delegation.
- Every delegation is inspectable afterwards — what was asked, what came back,
  how long it took, what retried. Voice systems are miserable to debug precisely
  because that record normally does not exist.

The trade: each run is a cold process with no conversation memory, which is why
the front agent's prompt insists on a **self-contained** request. For
research work that is the right shape anyway, and it makes retries safe.

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
cp .env.example .env.local     # keys + STATION_USERNAME / STATION_PASSWORD
pnpm install

pnpm start                     # 1. the backend → `station`
pnpm --filter glove-server-voice-web dev    # 2. the app you test in
```

`STATION_USERNAME` and `STATION_PASSWORD` are **required** — station refuses to
boot without them, with no default. Its API can start and stop processes on the
host, so an unauthenticated one is a remote-execution endpoint and a built-in
default password is the same thing with extra steps.

`station` reads `station.config.ts`, builds the signal and beacon runners from
`signals/` and `beacons/`, supervises rooms, drains the research queue, and
serves the dashboard. Rooms stay **stopped** until the app claims one.

- **http://localhost:3000** — the app. Hit Connect: it claims a room, waits for
  it to come up, then streams your microphone to it.
- **http://localhost:4400** — the dashboard. `/beacons` is one row per room
  (status, incarnation, restart count, live logs, start/stop/restart);
  `/signals` is every delegation with its input, answer and timing; `/env`
  manages the API keys injected into runs.

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

### Credentials — two kinds, covering different routes

This trips people up, so it is worth stating plainly. Station has two
credential types and they do **not** cover the same surface:

| | `/api/*` (dashboard API) | `/api/v1/*` (programmatic API) |
| --- | --- | --- |
| session cookie (login) | ✅ | ✅ |
| API key (`Authorization: Bearer sk_live_…`) | ❌ 401 "Session required" | ✅ scoped |
| **beacon start / stop lives here** | ✅ | ✗ no beacon routes |

So **room control necessarily goes through the session**: the web app logs in
server-side with `STATION_USERNAME` / `STATION_PASSWORD`, caches the cookie, and
re-authenticates on a 401 (`web/app/lib/station.ts`). An API key from `pnpm key`
covers the v1 surface — signals, runs, events, health — for anything else the
app wants to read, and is scoped (`read`, `trigger`, `cancel`, `admin`).

Neither credential ever reaches the browser. The client is handed a WebSocket
URL and nothing else.

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
- **Kill a room.** `kill` the `room-N` child, or restart it from the dashboard —
  the supervisor brings it straight back.
- **Watch the pool.** Connect from several tabs; each claims its own room on its
  own port, and the fifth is refused rather than silently sharing one.

## Files

| | |
| --- | --- |
| `station.config.ts` | the whole deployment: dirs, adapters, dashboard port |
| `beacons/rooms.ts` | the room pool — WebSocket audio in/out, `/mesh` inbound |
| `signals/research.ts` | the delegation job, replying over the mesh |
| `lib/mesh-transport.ts` | the two mesh adapters that span the process boundary |
| `web/` | the Next.js app you actually test in |
| `lib/turn-engine.ts` | the commitment engine, ported from the browser hook |
| `lib/turn-detector-local.ts` | in-process end-of-utterance scoring |
| `lib/voice-session.ts` | per-caller orchestration: STT, agent, TTS, barge-in |
| `lib/front-agent.ts` / `lib/worker-agent.ts` | Nova and the researcher |
| `lib/protocol.ts` | the whole client/server contract |

Timings stream to the browser and append to `voice-metrics.jsonl`:
`front_ttft_ms`, `tts_first_audio_ms`, `stt_dispatch_ms`, `endpoint_hold`,
`barge_in`, `delegation_roundtrip_ms`, plus the phantom/sweep counters the
commitment engine emits.
