# glove-realtime

Run a built Glove agent on a realtime multimodal model — OpenAI Realtime,
GPT-Live, Gemini Live — with the agent's tools, store, permissions, context
providers, inbox and subscribers all working on the live session.

```ts
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { RealtimeSession, realtimeModel } from "glove-realtime";

const agent = new Glove({
  model: realtimeModel({ provider: "gemini", voice: "Puck" }),
  store: new MemoryStore("call-42"),
  displayManager: new Displaymanager(),
  systemPrompt: "You are Nova, a support agent. Speak briefly.",
  compaction_config: { compaction_instructions: "Summarize the call." },
})
  .fold(lookupOrder)
  .fold(refund)               // requiresPermission: true — enforced on the call
  .build();

const session = new RealtimeSession({
  agent,
  compaction: { contextLimit: 24_000 },
  permissions: async ({ tool, input }) => confirmWithSupervisor(tool, input),
});

session.on("audio", (pcm, format) => speaker.play(pcm, format.sampleRate));
session.on("interrupted", () => speaker.flush());
session.on("user_said", (text) => log("caller:", text));
await session.start();

mic.on("pcm", (pcm) => session.sendAudio(pcm));       // in session.adapter.inputFormat
camera.on("frame", (jpeg) => session.sendVideoFrame(jpeg));
```

## Why a separate package

`glove-voice-s2s` puts the adapter boundary at the model: the adapter moves
audio and reports tool calls, and everything else is layered on top of a voice
pipe. That boundary is in the wrong place for realtime models, because the
rest of the agent lives on the provider's side of the socket:

- **Tools.** Gemini accepts an OpenAPI subset and rejects the whole session
  over one unknown schema key. It can't change tools mid-session without a
  reconnect. GPT-Live registers tools on a separate backend model.
- **Context.** OpenAI Realtime has a conversation you can delete items from.
  Gemini can only append. GPT-Live has no history, only capped appends.
- **Compaction.** OpenAI can summarise its own conversation out of band and
  rewrite it in place. Gemini needs a new session seeded with the summary.
  GPT-Live manages its context itself and can't take a summary.
- **Modalities.** Gemini takes video frames and can answer in text. OpenAI
  takes images. GPT-Live is audio only.

No single "inject this" or "compact now" is right for all three. So here the
**adapter owns the provider's half of the agent** (tool registration,
synthetic prompts, compaction, modalities). **Glove owns its half**: running
tools, the store, permissions, context, the inbox, subscribers, and the
session lifecycle. They talk through a capability declaration and one
standardized event stream. The voice-only stack (`glove-voice-s2s`, avatars,
LiveKit rooms) is unchanged.

## The split

| concern | adapter (`RealtimeAdapter`) | Glove (`RealtimeSession`) |
| --- | --- | --- |
| tools | `setTools()`: schema projection; patch live or reconnect | which tools are exposed; re-registers when the agent's set changes; runs every call through glove-core's `Executor` |
| synthetic prompts | `inject({ kind, key, respond })`: system item, open client turn, or append | what to inject and when: runtime context, inbox, your relays |
| compaction | `compact()`: in place or by reconnect; `summarize()` where the model can summarise itself | when to compact (context tokens over a limit); writes the summary to the store |
| modalities | `sendAudio` / `sendText` / `sendMedia`; audio or text out | checks requests against declared capabilities; forwards image parts in runtime context |
| session | `open(spec)` with history or a resume handle; reports drops, `goAway`, handles | reconnect with backoff; resume, or re-seed from the store; moves before `goAway`; max duration |
| events | emits `RealtimeEvent`, the same shapes for every provider | maps them to Glove `SubscriberEvent`s and session events |

## Providers

| | OpenAI Realtime (`openai`) | Gemini Live (`gemini`) | GPT-Live (`openai-live`) |
| --- | --- | --- | --- |
| input | audio, text, image | audio, text, image, video | audio, text |
| output | audio or text | audio or text | audio |
| audio in / out | 24 kHz / 24 kHz | 16 kHz / 24 kHz | 16 or 24 kHz |
| tool changes | live `session.update` | reconnect with resumption handle | live (backend tools) |
| non-blocking tools | — | `NON_BLOCKING` + scheduling | — |
| context injection | system items; keyed items **replace** the previous one | open client turn (appends) | thinking / commentary / instructions appends |
| compaction | **in place**: delete items, insert summary; model writes the summary out of band | **reconnect** seeded with summary; native sliding window on by default | provider-managed only |
| resumption | — | handles + `goAway` | — |
| transcripts | turns | turns | continuous fragments; host reports playback |
| runs in | Node 22+, browser (ephemeral token) | Node 22+, browser | server only (`ws`, auth header) |

Create adapters directly, or through the factory (explicit args first,
environment second, credentials checked when the adapter is built):

```ts
import { createRealtimeAdapter } from "glove-realtime";

createRealtimeAdapter();                                     // REALTIME_PROVIDER / key presence
createRealtimeAdapter({ provider: "openai", turnDetection: { type: "semantic_vad", eagerness: "low" } });
createRealtimeAdapter({ provider: "gemini", realtimeInput: { activityHandling: "NO_INTERRUPTION" } });
createRealtimeAdapter({ provider: "openai-live", backendModel: "gpt-5.6-luna" });
```

| env | meaning |
| --- | --- |
| `REALTIME_PROVIDER` | `openai` \| `openai-live` \| `gemini`. Unset: whichever key exists, OpenAI first |
| `REALTIME_MODEL` | model id; unset = `gpt-realtime` / `gpt-live-1` / `models/gemini-3.1-flash-live-preview` |
| `REALTIME_VOICE` | provider voice name |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | the credential when no `apiKey` / `getToken` is passed |

## How Glove primitives work on a session

- **Tools** (`fold`, `replaceTools`) are registered with the provider at
  start. After each call, if the agent's tools or system prompt changed (a
  discovery tool folded new ones, MCP refreshed, a goal's `configure`
  rewrote the prompt), the change is sent *before* the result goes back. Calls run through glove-core's `Executor`: Zod
  validation, `generateSummary`, `subagent_invoked`/`subagent_completed`
  brackets, `tool_use_result` with `duration_ms`. Retries default to 0,
  because a retry on a live call is silence; set `maxToolRetries` to change
  it. Every outcome reaches the provider, including unknown tools, bad JSON,
  denials and errors. `renderData` and summaries are stripped first.
  `excludeTools` withholds tools. `nonBlockingTools` lets the conversation go
  on while they run, where the provider supports it.
- **`requiresPermission`** is enforced. The store's existing decision comes
  first. Otherwise `permissions` decides: `"display"` asks through the
  agent's display stack (the same `permission_request` renderer a text turn
  uses), `"deny"` / `"allow"` are fixed and not remembered, and a function
  gives your own ruling, which is remembered. The default is `"deny"` for a
  `serverMode` agent and `"display"` otherwise.
- **The store** receives user and agent turns, each tool call with its result
  (appended together, so a later text turn never sees an orphaned call),
  resolved inbox items, and compaction summaries in the same
  `is_compaction` form core uses. A fresh provider session is seeded from
  the store, so a call that starts after a text conversation knows what was
  said, and the next text turn knows what was said on the call.
- **Runtime context providers** are injected on open, after each tool, and
  when the user starts speaking. A snapshot is skipped when it hasn't
  changed. On OpenAI it replaces the previous snapshot item. Elsewhere it is
  appended and says it supersedes the last one. Image parts are sent as
  media, once each, to providers that take images.
- **The inbox**: resolved items are injected and marked consumed, as a text
  turn would. Pending blocking items join the snapshot.
- **Skills and subagents** the agent invokes (`glove_invoke_skill`,
  `glove_invoke_subagent`) run as tools. Their events (`skill_invoked`,
  the subagent's own stream between its brackets) reach session subscribers.
- **Subscribers** receive the `SubscriberEvent`s a text turn produces:
  `text_delta`, `tool_use`, `tool_use_result`, `model_response_complete`,
  `token_consumption`, `compaction_start` / `compaction_end`,
  `runtime_context`. That includes the agent's own subscribers
  (`agent.addSubscriber`, through glove-core's `notifySubscribers`), so
  existing UIs, tracers and modules that listen on the agent work without
  changes. `session.addSubscriber()` adds one that only hears this session.
- **Compaction.** With `compaction.contextLimit` set, the session compacts
  when the provider reports a larger context, after pending tools finish.
  The summary comes from the adapter's `summarize()` if it has one (OpenAI:
  the model that heard the call writes it), otherwise from
  `compaction.model` (any glove-core text adapter), otherwise from the
  transcript itself. The adapter applies it. Without a limit, compaction is
  left to the provider. `session.compact()` compacts on demand.

- **Goals, forms and other per-turn preparation** (glove-memory): tools and
  status snapshots work as they are. Their per-turn work is preparation,
  resuming interrupted lifecycle hooks and re-applying `configure`. It is
  registered with glove-core's `addTurnPreparer`, and the session runs it
  (`agent.prepareTurn()`) before it opens and when each user turn starts. A
  text turn runs it at the start of `processRequest`. Prompt or tool changes
  it makes are sent to the provider. Nothing to wire:

  ```ts
  useGoalRunner(agent, goalAdapter, { scope, configure });
  const session = new RealtimeSession({ agent });   // goals prepare on every turn
  ```

  `beforeTurn` adds per-turn work that isn't registered on the agent. It
  runs after the agent's preparers.

Not translated: `/hook` and `/skill` directives in typed text. `say()` sends
text as a user turn, and the directive parsing belongs to the text loop.

## Session lifecycle

```ts
session.on("state", (state) => hud.show(state));    // idle → connecting → open ⇄ reconnecting → closing → closed
session.on("resumable", (handle) => saveHandle(callId, handle));
await session.start({ resumeHandle: loadHandle(callId) });   // resume after a process restart
```

- **Drops** are retried (`reconnect: { attempts: 3, backoffMs: 500 }` by
  default). The first attempt resumes with the latest handle. Later attempts
  open a fresh session seeded from the store, so a stale handle can't use up
  every attempt. When every attempt fails the session emits `ended`.
- **`goAway`** (Gemini) moves the session to a resumed connection before the
  provider ends this one.
- **Reconnect windows.** A tool result or inbox item that is ready while the
  provider session is reconnecting waits for it. If the session resumes, it
  is delivered there; inbox items are only marked consumed once they have
  actually been sent. When a reconnect or compaction replaces the provider's
  conversation with a fresh one, results for calls the old one made are
  dropped, and the context snapshot is sent again.
- **Store order.** After the user stops speaking, store writes wait (up to
  4 s) for the transcript of what they said. Transcription arrives
  asynchronously, and the reply must not be stored ahead of the question.
  While compaction runs, writes wait for the summary, so turns said in the
  meantime follow it instead of being hidden behind it.
- `maxDurationMs` ends the session. `stop()` waits for the adapter to close
  (GPT-Live: until final usage arrives) and for pending store writes. A
  `stop()` while `start()` is still connecting cancels the open: `start()`
  rejects with an `OpenCancelled` error and no provider session is left
  running.

## Synthetic prompts, media, and output

```ts
session.inject({ kind: "user", text: "The warranty check came back: covered until 2031." });  // spoken about
session.inject({ kind: "context", text: "Caller is a VIP.", persist: true });                  // silent
session.inject({ kind: "instruction", text: "Wrap up the call politely." });
session.respond("Greet the caller in one short sentence.");
session.say("typed message from the chat box");
session.sendImage(pngBytes, "image/png");
```

Text output instead of speech: `new RealtimeSession({ agent, output: "text" })`
then read `agent_delta` / `agent_said` (OpenAI Realtime and Gemini).

## Writing an adapter

Implement `RealtimeAdapter` (extending `AdapterBase` gives you the listener
set). Declare `capabilities` truthfully: the session chooses strategies from
them and refuses mismatched requests at construction. Emit only
`RealtimeEvent`s. `interrupt()` must always emit `interrupted`, because the
host's playback queue often still holds audio after the provider has
finished generating it. In addition:

- `close()` must cancel an `open()` that is still connecting.
- `isOpen` must be false while you reconnect, so the session holds results
  until you're back.
- An adapter that applies `setTools` / `setInstructions` by reconnecting
  should return a promise that settles once the new session is open.
- Continuous providers emit `output.transcript` deltas, which drive captions
  and `text_delta`, alongside `transcript.fragment`, which marks turns for
  the store. The tests in `tests/` drive each adapter against a
fake socket, and are a template for a new one.

Passing those tests shows the adapter matches its own understanding of the
protocol. Only a live session shows the provider accepts the frames. Check
with real credentials before shipping. For the adapters here, these frames
are not yet checked against a live session:

- **Gemini.** Silent context goes in as an open `clientContent` turn mid-session,
  as in `glove-voice-s2s`. Google documents `clientContent` for seeding
  history, so check that runtime snapshots and inbox items reach the model.
  Also check `NON_BLOCKING` scheduling, `toolCallCancellation` and the
  `usageMetadata` totals.
- **OpenAI.** Check out-of-band `conversation: "none"` summaries and
  client-chosen item ids.
