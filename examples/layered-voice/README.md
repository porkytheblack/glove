# Layered Voice Agents — Orbital Dynamics

A worked example of the **Layered Voice Agents** design on top of Glove: a thin,
fast **front agent** owns the conversation and stays responsive, while a heavy
**worker agent** does the real work behind it over `glove-mesh`. Delegation is
just a mesh send; the result lands back in the front agent's inbox and is
relayed proactively.

On top of the paper's design this example adds a third agent and tests two
things you can't test with a single agent:

1. **Custom senders** — every utterance carries a *speaker identity*, so the
   agents can tell the people in the room apart.
2. **Addressing differentiation** — a passive **monitor agent** (no microphone)
   reads each utterance and decides whether it was said *to the assistant* or
   *to another person*. The front agent only responds when it's actually
   addressed.

The domain is **Orbital Dynamics**, a starship sales & service center, seeded
with a large interconnected dataset (catalog, customers, registered hulls,
service history, parts, technicians, appointments, warranties, financing) so the
worker has real substance to research.

---

## The three agents

```
             ┌─────────────────────────── the room ───────────────────────────┐
  utterance  │  Sam (operator) · Dr. Okonkwo (customer) · Kit (technician)     │
  (tagged    │                                                                 │
   with a    │        │                                                        │
   speaker)  │        ▼                                                        │
             │  ┌─────────────┐   "addressed to a person" → Nova stays quiet   │
             │  │   MONITOR   │───────────────────────────────────────────────►│  (overheard,
             │  │  (no mic)   │                                                 │   appended as
             │  └─────┬───────┘   "addressed to Nova"                          │   context)
             │        ▼                                                        │
             │  ┌─────────────┐  glove_mesh_send_message(blocking)  ┌────────┐ │
   speaker ◄─┤  │ FRONT (Nova)│ ───────────────────────────────────►│ WORKER │ │
             │  │ thin · fast │◄─────────────────────────────────── │ heavy  │ │
             │  └─────────────┘   reply (in_reply_to) → inbox        │ + DB   │ │
             │       relay                                           └────────┘ │
             └─────────────────────────────────────────────────────────────────┘
```

- **Front (Nova)** — small/fast model, almost no tools of its own (just a
  clock). It sounds responsive, delegates any data lookup to the worker with a
  **blocking** mesh send, and speaks an acknowledgement in the *same* turn. When
  the worker's reply arrives it relays it conversationally.
- **Worker** — heavy model, the full shop-database tool surface. It receives
  delegated requests over the mesh (they surface as resolved inbox items),
  researches, and **replies** with `in_reply_to` set. Per the paper (§4) it
  **never acknowledges** — an ack would resolve the front agent's "still
  waiting" reminder before any answer exists.
- **Monitor** — the second frontend agent. It has no microphone and never joins
  the conversation. On every utterance it reads the speaker label + recent
  transcript and returns a single verdict: `assistant`, `human`, or `ambiguous`.
  That verdict gates whether Nova responds at all.

All three run **server-side** and share an in-process `MeshNetwork`. The browser
is a thin console that streams events over SSE.

---

## The two things this example tests

### 1. Custom senders (application-layer today)

`glove-core`'s `Message.sender` is only `"user" | "agent"`, and the model
adapters collapse it to `role: user/assistant` with **no name field**. So there
is **no first-class notion of a *different person*** today.

The framework's own convention (see `glove-mesh`, which folds peer identity into
inbox text like `Message from "Voice Front" (front)`) is to **encode the speaker
identity into the message text**. This example makes that convention explicit
and reusable in [`app/lib/server/speakers.ts`](app/lib/server/speakers.ts):

```ts
frameAddressed("customer", "is my warranty still good?")
// → '[Dr. Okonkwo (customer) → Nova] is my warranty still good?'

frameOverheard("bystander", "bay three's open")
// → '[overheard · Kit (bystander), not addressed to Nova] bay three's open'
```

Both the monitor and Nova read these labels, so they can tell the operator from
the customer, and — crucially — tell a line said *to* Nova apart from one merely
overheard. Overheard lines are appended to Nova's context with
`store.appendMessages(...)` **without** triggering a response, so she keeps
situational awareness of the room without barging in.

> **If you want first-class custom senders in the framework**, the minimal
> change would be an optional `sender_label` / `sender_name` on `Message`,
> threaded through the adapters (Anthropic supports a `name` on messages; the
> OpenAI-compat wire format does too). This example deliberately does it at the
> application layer so it needs no core change and mirrors how mesh already
> works.

### 2. Addressing differentiation ("me vs. someone else")

The monitor agent ([`monitor-agent.ts`](app/lib/server/monitor-agent.ts)) is the
"one active when the other's speaking, no mic, can infer if the conversation is
directed at it or someone else" piece. Watch the verdict badge on each utterance
in the console:

- **`→ Nova`** — Nova responds (and may delegate).
- **`→ a person`** — Nova stays quiet; the line is appended as overheard context.
- **`ambiguous`** — flagged; Nova stays out of it.

Play the **"Addressed vs. overheard"** scenario to see the customer talk to Sam
(Nova silent) and then Sam ask Nova (Nova responds + delegates), in one scene.

---

## Running it

From the monorepo root:

```bash
pnpm install
```

Set a key (Anthropic by default):

```bash
cp examples/layered-voice/.env.example examples/layered-voice/.env.local
# edit .env.local and set ANTHROPIC_API_KEY=...
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
and per-agent token budget (notice the front stays cheap while the worker
carries the weight).

### Provider / model overrides

Defaults: front + monitor on `claude-haiku-4-5` (small/fast), worker on
`claude-sonnet-4` (heavy). Override via env — see
[`.env.example`](.env.example). To use another provider set `VOICE_PROVIDER` and
that provider's API key.

---

## How a delegated turn actually flows

1. An utterance arrives tagged with a speaker. The **monitor** classifies the
   addressee.
2. If it's for Nova, the front agent runs one turn: it speaks a short ack **and**
   calls `glove_mesh_send_message({ to: "worker", blocking: true, content })` in
   the same turn. The blocking send drops a `mesh:waiting:<id>` pending item in
   Nova's inbox — her "still waiting" reminder.
3. The orchestrator drains the delegation: it runs the **worker**, which sees the
   request as a resolved inbox item, researches with its tools, and replies with
   `glove_mesh_send_message({ to: "front", in_reply_to, content })`.
4. The reply resolves Nova's pending item **and** lands in her inbox. The
   orchestrator fires a synthetic **relay** turn (the paper's §5 wakeup, driven
   at the app layer): Nova sees `[Inbox: N item(s) resolved]` and relays the
   answer. It's rendered as a dashed "proactive relay" bubble.

The `mesh:waiting` reminder is why Nova never fabricates an answer while the
worker is still working — it's her source of truth (paper §3).

---

## Where real voice plugs in

This console is the **cognitive layer** of a voice session, driven by simulated
STT transcripts with speaker-diarization labels — which is exactly the seam a
real pipeline provides. To go fully live you'd:

- Replace typed utterances with `glove-voice` STT output. A diarizing STT
  provider gives you the speaker label per utterance (the "custom sender").
- Feed each finalized utterance through the same
  `session.handleUtterance(speaker, text)` entry point.
- Speak Nova's `say` events (and only those) through TTS. The monitor and worker
  never reach the speaker.

Everything else — the monitor gate, the blocking delegation, the proactive relay
— is already the real mechanism, not a mock.

---

## File map

```
app/
  api/session/route.ts                 POST → create a session (3 agents + mesh)
  api/session/[id]/utterance/route.ts  POST → run one tagged utterance
  api/session/[id]/stream/route.ts     GET  → SSE of all pipeline events
  components/Console.tsx               the two-column console UI
  lib/
    shared/types.ts                    types shared client ↔ server
    data/seed.ts                       the seeded Orbital Dynamics database
    data/queries.ts                    query helpers the worker's tools wrap
    server/
      speakers.ts                      custom-sender framing convention
      models.ts                        per-role model adapters
      front-agent.ts                   Nova — thin, fast, voice-facing
      worker-agent.ts                  the heavy capability layer + DB tools
      monitor-agent.ts                 the passive addressing classifier
      session.ts                       orchestrator: mesh wiring + the pipeline
    client/
      useSession.ts                    SSE client hook
      scenarios.ts                     scripted multi-party scenes
```

Built with [Glove](https://github.com/porkytheblack/glove) —
`glove-core` + `glove-mesh`.
