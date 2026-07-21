# Layered Voice Agents — Orbital Dynamics

A worked example of the **Layered Voice Agents** design on top of Glove: a thin,
fast **front agent** owns the conversation and stays responsive, while a heavy
**worker agent** does the real work behind it over `glove-mesh`. Delegation is
just a mesh send; the result lands back in the front agent's inbox and is
relayed proactively.

On top of the paper's design this example tests two things you can't test with a
single agent:

1. **Custom senders** — every utterance carries a *speaker identity*, so the
   agent can tell the people in the room apart.
2. **Addressing differentiation** — the front agent hears **every** line in the
   room and decides *for herself* whether it was aimed at her, via the
   **`<speech>` protocol**: only text she wraps in `<speech>…</speech>` is ever
   spoken. No tags → she stayed quiet.

The domain is **Orbital Dynamics**, a starship sales & service center, seeded
with a large interconnected dataset (catalog, customers, registered hulls,
service history, parts, technicians, appointments, warranties, financing) so the
worker has real substance to research.

---

## The two agents

```
             ┌─────────────────────────── the room ───────────────────────────┐
  utterance  │  Sam (operator) · Dr. Okonkwo (customer) · Kit (technician)     │
  (tagged    │                                                                 │
   with a    │        │ every line, speaker-labelled                           │
   speaker)  │        ▼                                                        │
             │  ┌─────────────┐  glove_mesh_send_message(blocking)  ┌────────┐ │
   speaker ◄─┤  │ FRONT (Nova)│ ───────────────────────────────────►│ WORKER │ │
   (only     │  │ thin · fast │◄─────────────────────────────────── │ heavy  │ │
   <speech>  │  └─────────────┘   reply (in_reply_to) → inbox        │ + DB   │ │
   spans)    │   streams raw text;                                   └────────┘ │
             │   <speech>…</speech> spans are parsed out live → TTS             │
             └─────────────────────────────────────────────────────────────────┘
```

- **Front (Nova)** — small/fast model, almost no tools of her own (just a
  clock). She hears every line in the room, speaker-labelled, and decides
  whether it's for her. She delegates any data lookup to the worker with a
  **blocking** mesh send and speaks an acknowledgement in the *same* turn. When
  the worker's reply arrives she relays it conversationally.
- **Worker** — heavy model, the full shop-database tool surface. It receives
  delegated requests over the mesh (they surface as resolved inbox items),
  researches, and **replies** with `in_reply_to` set. Per the paper (§4) it
  **never acknowledges** — an ack would resolve the front agent's "still
  waiting" reminder before any answer exists.

Both run **server-side** and share an in-process `MeshNetwork`. The browser is a
thin console that streams events over SSE.

---

## The `<speech>` protocol

Nova's raw output is **not** spoken. Her system prompt instructs: anything meant
to be said out loud goes inside `<speech>…</speech>` tags —

```
Not addressed to me — noting the hull id for later.
```
→ silent.

```
<speech>One sec, let me pull that up.</speech>
```
→ spoken.

The server pipes her token stream through an **incremental tag parser**
([`speech-parser.ts`](app/lib/server/speech-parser.ts)) that finds the
demarcations mid-stream — tags can arrive split across chunks (`"<spe"` +
`"ech>hi"`), so the parser holds back only the ambiguous suffix and emits
everything else the moment it's provably in-tag. Spoken deltas stream to the
client (and straight into ElevenLabs TTS) **while the model is still
generating**; out-of-tag text never leaves the server. A turn that produces no
speech is surfaced as "Nova stayed quiet".

This replaces the earlier separate monitor/classifier agent: addressing judgment
now lives in the same model call that answers, which removes a whole model
round-trip from every utterance — the speak/stay-quiet decision costs nothing
extra.

### Inbound event tags — the model knows what's going on

`<speech>` is the *outbound* channel; a matching *inbound* vocabulary
([`events.ts`](app/lib/server/events.ts)) tells Nova what actually happened on
the audio channel. Her history always contains her full intended line (the
framework persists the whole model turn), but the room may have heard less:

- **`<user-interruption>…</user-interruption>`** — a barge-in cut her audio.
  The notice quotes the estimated prefix that actually played, embedded in a
  **synthetically closed** `<speech>` tag (the real speech was cut mid-tag, so
  the client estimates the heard prefix from playback time and the transcript
  fragment is re-closed to stay well-formed). Her prompt tells her: the history
  shows what you *meant* to say, the notice is the truth about what was
  *heard* — respond to the person first, don't re-deliver the remainder
  wholesale.
- **`<speech-failure>…</speech-failure>`** — the TTS stream failed; the room
  heard none of the line. Re-say what matters at a natural opening.
- **`<worker-result>…</worker-result>`** — the §5 wakeup itself: the worker
  finished a delegated request (findings arrive alongside via the framework's
  `[Inbox: N item(s) resolved]` injection). Relay out loud.
- **`<worker-trouble>…</worker-trouble>`** — the §8 failure path: a delegation
  errored or the worker finished **without replying**. The orchestrator clears
  the stale `mesh:waiting` reminders (the notice supersedes them) and Nova
  levels with the asker instead of "still checking" forever.

Audio-channel events are reported by the client via
`POST /api/session/[id]/event`; all notices are appended to Nova's history on
the front turn queue (so one can never splice into the middle of an in-flight
turn, and an interruption notice lands *before* the interrupting utterance's own
turn reads history). The room view shows audio notes as small dashed pills.

### Custom senders (application-layer today)

`glove-core`'s `Message.sender` is only `"user" | "agent"`, and the model
adapters collapse it to `role: user/assistant` with **no name field** — so there
is no first-class notion of *a different person*. The framework's own convention
(see `glove-mesh`, which folds peer identity into inbox text like
`Message from "Voice Front" (front)`) is to encode identity into the message
text. [`speakers.ts`](app/lib/server/speakers.ts) makes that explicit:

```ts
frameUtterance("customer", "is my warranty still good?")
// → '[Dr. Okonkwo (customer)] is my warranty still good?'
```

Every line reaches Nova with its speaker label; the labels + the `<speech>`
protocol together give you "who's talking, and are they talking to me".

> If you want first-class custom senders in the framework, the minimal change
> would be an optional `sender_label` / `sender_name` on `Message`, threaded
> through the adapters (Anthropic + OpenAI-compat both support a message
> `name`). This example deliberately stays at the application layer.

---

## Running it

From the monorepo root:

```bash
pnpm install
```

Set a key (OpenRouter by default):

```bash
cp examples/layered-voice/.env.example examples/layered-voice/.env.local
# edit .env.local and set OPENROUTER_API_KEY=...
```

Then:

```bash
cd examples/layered-voice
pnpm dev
# open http://localhost:3000
```

Pick a speaker (Sam / Dr. Okonkwo / Kit), type a line, and send — or click a
**scenario** chip to play a scripted scene. The left column is the room; the
right column is the backstage view of the mesh delegation, worker tool calls,
latency HUD, and per-agent token budget (notice the front stays cheap while the
worker carries the weight).

### Provider / model overrides

Defaults are affordable open models on **OpenRouter** (one `OPENROUTER_API_KEY`):

| Role | Model | Why |
| --- | --- | --- |
| front (Nova) | `openai/gpt-oss-120b` | the spoken final answer; reasoning off, `<speech>` spans stream straight into TTS |
| worker | `minimax/minimax-m2.5` | heavy lifting + a ton of tool calls over the DB (the only reasoning model) |

Override with `FRONT_MODEL` / `WORKER_MODEL`, or switch providers with
`VOICE_PROVIDER` (+ that provider's key). See [`.env.example`](.env.example).
Anthropic defaults are wired in via `VOICE_PROVIDER=anthropic`.

### Full-duplex voice (ElevenLabs)

Click **Mic** in the dock to go hands-free. Then:

- **Mic in** — your speech is captured, VAD-segmented, and transcribed by
  ElevenLabs Scribe. Each finalized utterance is sent as the **currently selected
  speaker** (the chip you have highlighted is "who's at the mic"), so switch
  speakers to play the operator vs. the customer.
- **TTS out (streaming, genuinely realtime)** — Nova's parsed `<speech>` tokens
  stream into ElevenLabs as they arrive over SSE. Three mechanics make audio
  start *mid-generation* instead of after it:
  1. **`auto_mode`** on the TTS WebSocket — without it, ElevenLabs buffers
     ~120+ chars before synthesizing anything, so short replies (Nova's whole
     style) only produced audio at the end-of-turn flush.
  2. **Sentence chunking** — tokens accumulate in a `SentenceBuffer` and each
     *completed sentence* is sent; auto_mode synthesizes at each sentence end.
  3. **Prewarmed socket** — the TTS WebSocket (token mint + handshake,
     ~300-600 ms) is opened *while the model is thinking* and adopted by the
     next spoken turn, so that cost overlaps model latency
     (`tts_stream_open_ms` logs `0` with `adopted: true` when it worked).
  Covers every spoken turn including the proactive relay. The worker never
  reaches the speaker, and neither does Nova's out-of-tag text.
- **Barge-in** — start talking while Nova is speaking and she stops; the
  interruption is counted and timed, and any speech queued behind the current
  turn is voided too.
- **The §5 audio gate** — the server may finish generating a relay while the
  previous turn's audio is still playing (async delegation means model work and
  playback overlap). Spoken turns are therefore **queued client-side**: a new
  turn's audio does not start until the current turn has fully drained from the
  speaker AND the user isn't mid-utterance (their turn takes priority — exactly
  the paper's wakeup flowchart). Only the audio waits; the relay's model work
  still pipelines in the background. `speech_queue_wait_ms` measures the gate.

Set your key server-side (never `NEXT_PUBLIC_`):

```
ELEVENLABS_API_KEY=...
# optional: NEXT_PUBLIC_ELEVENLABS_VOICE_ID=<voice id for Nova>
```

The browser only ever gets short-lived tokens from `/api/voice/stt-token` and
`/api/voice/tts-token` (glove-next's `createVoiceTokenHandler`).

Because the agents run server-side, this is wired à la carte with `glove-voice`'s
ElevenLabs adapters rather than `useGloveVoice({ runnable })` — that hook assumes
an in-browser agent and can't speak the proactive relay, which arrives outside
the initiating turn.

### Persistence — does the mesh need a database?

**No.** The mesh transport (`MeshNetwork` + `InMemoryMeshAdapter`) is an
in-process bus; both agents live in one Node process, so nothing external is
needed. A broker/DB only enters the picture if you split agents across
processes (BYO `MeshAdapter`).

What *can* persist is each agent's **store** — transcripts and the inbox, which
is where all mesh state actually lives (pending `mesh:waiting` items, worker
replies). Opt in with:

```
VOICE_PERSIST=pglite
```

This backs both agents with a small custom `StoreAdapter`
([`stores.ts`](app/lib/server/stores.ts)) over
[PGlite](https://pglite.dev) — Postgres compiled to WASM, **zero native
bindings**. Both agents share one data directory (`./voice-agents-db`,
override with `VOICE_DB_DIR`), scoped by session/role ids, so transcripts and
mesh inbox traffic survive restarts. Inspect it from node:

```bash
node -e "import('@electric-sql/pglite').then(async ({PGlite}) => {
  const db = new PGlite('voice-agents-db');
  console.log((await db.query('SELECT session_id, tag, status FROM inbox ORDER BY created_at')).rows);
})"
```

**Clearing is easy**, three ways:

- the **Clear data** button in the console header — wipes all DB rows + the
  metrics file and starts a fresh session (works while the server runs);
- `pnpm clear` — deletes the data directory + metrics file (run with the
  server stopped);
- or just delete `voice-agents-db/` yourself.

Default remains `memory` (nothing persists, nothing to clean).

### Latency metrics → local file

Every turn is instrumented and both **streamed to a live HUD** (right column) and
**appended to a local JSONL file** for offline analysis. Default file:
`voice-metrics.jsonl` in the app's working dir (override with
`VOICE_METRICS_FILE`).

Measured (server-side unless noted):

| metric | meaning |
| --- | --- |
| `time_to_first_audio_ms` | **client** — utterance sent → first Nova audio (the headline voice latency) |
| `front_ttft_ms` | utterance received → Nova's first *spoken* token (first in-tag token) |
| `front_turn_ms` | the whole front turn; `data` carries `spoke`, `speaker`, `workerBusy` (was she answering *while* research ran — the interleaving evidence), and per-turn `<speech>` protocol health (`spokenChars` / `discardedChars` / `speechBlocks` / `unclosedTag`) |
| `speech_tag_unclosed` | count event — a turn ended inside an unclosed `<speech>` (tolerated, but a prompt-tuning signal) |
| `delegation_dispatched` | count event — a batch of delegations handed to the background worker |
| `worker_queue_wait_ms` | dispatch → worker run start (runs serialize, so batches can queue) |
| `worker_ms` | background worker research time; `data`: `delegations`, `toolCalls`, `replies`, `failed` |
| `worker_no_reply` | count event — a worker run ended **without replying** (the paper's §8 silence failure: the front is left waiting) |
| `relay_ms` | proactive relay turn time; `data`: `spoke`, `items` (>2 = coalescing in action), `unclosedTag` |
| `relay_skipped` | count event — the queued relay found nothing resolved because a **user turn won** (§5) |
| `delegation_roundtrip_ms` | delegation dispatched → relay spoken (the async round-trip) |
| `stt_final_ms` | **client** — end-of-speech → final transcript |
| `speech_queue_wait_ms` | **client** — how long a spoken turn's audio was held by the §5 gate (previous audio draining / user speaking) before it started |
| `tts_stream_open_ms` | **client** — TTS WebSocket + auth handshake cost per spoken turn (`0` + `data.adopted: true` when the prewarmed socket was used) |
| `tts_synth_ms` / `tts_playback_ms` | **client** — TTS first-audio / playback duration |
| `barge_in` | **client** — an interruption; `ms` Nova had been speaking, `data.droppedQueuedTurns` = queued speech voided with it, `data.heardChars` = estimated heard prefix length |
| `user_interruption` | count event — a `<user-interruption>` notice was logged into Nova's history (`data.heardChars`) |
| `speech_failure` | count event — a `<speech-failure>` notice was logged (TTS never played the line) |

The `data` payloads are where the analysis lives, e.g.:

```bash
# how often Nova answered something else while the worker researched
cat voice-metrics.jsonl | jq 'select(.name=="front_turn_ms" and .data.workerBusy==true)'
# speech-protocol health: silent-note volume vs spoken volume per turn
cat voice-metrics.jsonl | jq 'select(.name=="front_turn_ms") | {spoke:.data.spoke, spoken:.data.spokenChars, discarded:.data.discardedChars}'
# worker effort per delegation batch
cat voice-metrics.jsonl | jq 'select(.name=="worker_ms") | {ms, calls:.data.toolCalls, replies:.data.replies}'
```

Each line is one `MetricRecord` (`{ ts, sessionId, source, name, ms?, utteranceId?, data? }`).
Analyze with e.g.:

```bash
# average time-to-first-audio
cat voice-metrics.jsonl | jq -s '[.[]|select(.name=="time_to_first_audio_ms").ms]|add/length'
# every barge-in
cat voice-metrics.jsonl | jq 'select(.name=="barge_in")'
```

---

## How a delegated turn actually flows — fully async

1. An utterance arrives tagged with a speaker and goes straight to Nova,
   speaker-labelled. If it isn't for her, she emits no `<speech>` and the
   console shows "Nova stayed quiet".
2. If it is for her and needs data, she speaks a short ack (in `<speech>` tags,
   already streaming to TTS) **and** calls
   `glove_mesh_send_message({ to: "worker", blocking: true, content })` in the
   same turn. The blocking send drops a `mesh:waiting:<id>` pending item in her
   inbox — and **her turn ends right there**. Nothing waits on the worker.
3. The orchestrator hands the delegation to the **worker in the background**
   (its own run queue, concurrent with front turns — the "Worker researching"
   pill in the header). Meanwhile the room keeps talking and Nova keeps
   answering; the pending `mesh:waiting` reminder is what keeps her honest
   about what's still in flight (paper §3) — ask her "well?" and she'll say
   she's still checking rather than invent an answer.
4. The worker replies with `glove_mesh_send_message({ to: "front", in_reply_to,
   content })`, which resolves Nova's pending item **and** lands in her inbox.
   The orchestrator then queues a **relay** turn — the paper's §5 wakeup —
   behind whatever front turn is in flight, with both of the paper's rules:
   - **Coalescing** — replies that arrive while a relay is queued share one
     relay turn (`[Inbox: N item(s) resolved]` batches naturally).
   - **User turn wins** — if a user utterance got there first and consumed the
     result (Nova weaves it into that answer), the queued relay finds nothing
     resolved and is skipped entirely.
   A spoken relay renders as a dashed "proactive relay" bubble.

---

## File map

```
app/
  api/session/route.ts                 POST → create a session (2 agents + mesh)
  api/session/[id]/utterance/route.ts  POST → run one tagged utterance
  api/session/[id]/stream/route.ts     GET  → SSE of all pipeline events
  api/voice/stt-token/route.ts         GET  → short-lived ElevenLabs STT token
  api/voice/tts-token/route.ts         GET  → short-lived ElevenLabs TTS token
  api/metrics/route.ts                 POST → append client metrics to the file
  api/admin/clear/route.ts             POST → wipe persisted data (DB rows + metrics)
  components/Console.tsx               the console UI (room + backstage + HUD)
  lib/
    shared/types.ts                    types shared client ↔ server
    data/seed.ts                       the seeded Orbital Dynamics database
    data/queries.ts                    query helpers the worker's tools wrap
    server/
      speakers.ts                      custom-sender framing convention
      speech-parser.ts                 incremental <speech> tag parser (stream-safe)
      models.ts                        per-role model adapters
      front-agent.ts                   Nova — thin, fast, speaks via <speech> tags
      worker-agent.ts                  the heavy capability layer + DB tools
      session.ts                       orchestrator: mesh wiring + pipeline + metrics
      stores.ts                        store factory: MemoryStore or PGlite persistence
      metrics.ts                       local JSONL metrics sink
    client/
      useSession.ts                    SSE client hook
      useVoice.ts                      full-duplex ElevenLabs mic + streaming TTS
      scenarios.ts                     scripted multi-party scenes
```

Built with [Glove](https://github.com/porkytheblack/glove) —
`glove-core` + `glove-mesh` + `glove-voice`.
