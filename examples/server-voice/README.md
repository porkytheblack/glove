# Server-side voice — the client is an audio duct

The same starship-shop voice agent as [`examples/layered-voice`](../layered-voice),
with the entire pipeline moved off the browser and onto the server. This is the
architecture every production voice platform converges on (LiveKit Agents,
Pipecat, Vapi, Retell): the client captures a microphone and plays back audio,
and **every decision happens server-side**.

`examples/layered-voice` is unchanged and still the browser-hosted reference.
This example is the other half of the comparison.

```
browser                      gateway BEACON (supervised)              signal RUN (per job)
────────                     ───────────────────────────              ───────────────────
mic ──PCM16──────────────▶   VAD → STT → turn detector → front agent
                                                            │
speakers ◀────PCM16───────   TTS ◀───── <speech> parser ◀────┤
                                                            │
                                              delegate_to_worker
                                                            │
                                                     station queue ──▶ worker agent
                                                            ▲          12 DB tools
                                              answer ───────┘
```

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

The client-side code that remains is `public/client.js` plus two audio worklets.
It holds no API keys, runs no VAD, and makes no endpointing decisions.

## Why this is faster, not just tidier

- **The turn detector is a function call.** In the browser pipeline the
  commitment engine runs in the tab and the LiveKit end-of-utterance model runs
  on the server, so *every VAD boundary* costs an HTTP round trip with a 350ms
  timeout and a heuristic fallback for when the network is slow. Here they share
  a process: ~25ms of ONNX inference and nothing else.
- **No token minting.** The gateway opens the ElevenLabs sockets directly with
  the key it already holds — no `/api/voice/*-token` round trip per session.
- **Tuning needs no client deploy.** Hold bounds, freshness windows and the
  pacing curve are server config. The "your browser is running last week's
  endpointing" class of bug cannot happen.
- **Telephony becomes possible.** A SIP trunk can terminate at the same gateway
  a browser does; the session logic does not know the difference.

The cost is one extra network hop for audio (browser → gateway → ElevenLabs
instead of browser → ElevenLabs). It is roughly a wash against the round trips
that were deleted, and it buys everything above.

## Why station

A voice session is a long-lived, stateful duplex connection. It cannot live in
a serverless function, and a bare `node server.js` gives you nothing when it
falls over. Station supplies the two primitives this architecture actually
needs:

**The gateway is a `beacon`** — a supervised long-running process.
`restart("always")` brings it back within a second of a crash; `.heartbeat("10s")`
catches a wedged event loop and recycles it instead of leaving it accepting
connections it will never serve; `ctx.onStop` drains in-flight callers politely.
The dashboard shows incarnation, restart count, uptime and live logs.

**Each delegation is a `signal`** — a discrete job, run to completion in its own
child process, with a timeout, retries, and a durable Run record. That buys
three things the in-process mesh in `layered-voice` cannot:

- The heavy agent cannot take the voice loop down with it. Different process.
- The job is in the database before the worker starts, so a gateway restart
  loses the conversation but never the delegation.
- Every delegation is inspectable afterwards — what was asked, what came back,
  how long it took, what retried. Voice systems are miserable to debug precisely
  because that record normally does not exist.

The trade: each run is a cold process with no conversation memory, which is why
the front agent's tool description insists on a **self-contained** request. For
research work that is the right shape anyway, and it makes retries safe.

## Run it

```bash
cp .env.example .env.local     # ELEVENLABS_API_KEY + OPENROUTER_API_KEY
pnpm install
pnpm start                     # supervises the gateway + drains the queue
```

Open **http://localhost:4500**, hit Connect, and talk.

The first boot downloads the open [`livekit/turn-detector`](https://huggingface.co/livekit/turn-detector)
weights (~150MB, one-time, into the HF cache). The beacon does this *before*
reporting itself ready, so the first caller never pays for it. If the download
fails the gateway still serves — `LocalTurnDetector` falls back to the
heuristic tiers.

```bash
npx station                    # dashboard → http://localhost:4400
```

`/beacons` is the voice tier; `/signals` is every delegation with its input,
answer and timing.

### Things to try

- **Ask about a hull.** "Nova, is hull KES-0007 still under warranty?" — watch
  the delegation appear as a Run in the dashboard while Nova acknowledges out
  loud and keeps the floor.
- **Talk over her.** Barge-in is decided server-side; the browser just drops its
  buffer when told. The next turn tells the model exactly how much of the cut
  line the room actually heard.
- **Switch speaker** in the dropdown and talk *about* Nova rather than to her.
  She hears every line and decides for herself whether she was addressed.
- **Kill the gateway.** `kill` the `voice-gateway` child, or stop it from the
  dashboard — the supervisor restarts it, and a delegation queued beforehand
  still completes.

## Files

| | |
| --- | --- |
| `runner.ts` | the one process you start — supervises both runners |
| `beacons/voice-gateway.ts` | HTTP + WebSocket, one `VoiceSession` per connection |
| `signals/research.ts` | the delegation job |
| `lib/turn-engine.ts` | the commitment engine, ported from the browser hook |
| `lib/turn-detector-local.ts` | in-process end-of-utterance scoring |
| `lib/voice-session.ts` | per-caller orchestration: STT, agent, TTS, barge-in |
| `lib/front-agent.ts` / `lib/worker-agent.ts` | Nova and the researcher |
| `lib/protocol.ts` | the whole client/server contract |
| `public/` | the client: one HTML file, one JS file, two worklets |

Timings stream to the browser and append to `voice-metrics.jsonl`:
`front_ttft_ms`, `tts_first_audio_ms`, `stt_dispatch_ms`, `endpoint_hold`,
`barge_in`, `delegation_roundtrip_ms`, plus the phantom/sweep counters the
commitment engine emits.
