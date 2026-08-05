# glove-voice-s2s

Speech-to-speech (realtime voice model) adapters for the Glove agent
framework — the architecture step past the cascaded pipeline.

## Why

`glove-voice`'s cascade (VAD → STT → LLM → TTS) bottoms out around
**1.3–1.6s** voice-to-voice: every stage adds serial latency, and
end-of-turn must be reconstructed from transcripts with heuristics or an
EOU model. A speech-to-speech model collapses the cascade — audio in, one
model, audio out — with turn-taking decided by the model *listening*.
Production S2S APIs run **500–800ms** voice-to-voice.

## What survives from the layered-agents architecture

| layered concept | S2S equivalent |
| --- | --- |
| thin fast front agent | the realtime model itself (persona + addressing + voice in one) |
| delegation over the mesh | a function **tool** the model calls; the heavy text worker runs unchanged |
| §5 proactive relay wakeup | `injectText(result, { respond: true })` / tool result + response trigger |
| barge-in + heard-prefix repair | provider-native interruption handling |
| client endpointing (VAD, holds, EOU scoring) | **deleted** — provider semantic VAD |

## The pieces

| piece | what it is |
| --- | --- |
| `S2SAdapter` | the provider contract: one live session — audio in/out, tool calls as events, a text side-channel (`types.ts`) |
| `OpenAIRealtimeAdapter` | **device**-mode adapter (WebRTC, browser-only): owns the mic and plays the reply itself |
| `OpenAIRealtimeSocketAdapter` | **transport**-mode OpenAI adapter (plain WebSocket, Node + browser): 24 kHz PCM both ways — gpt-realtime in a server room |
| `GeminiLiveAdapter` | **transport**-mode adapter (plain WebSocket, Node + browser): moves PCM only — the mode a server-hosted room needs |
| `RealtimeAgent` | run a built Glove on an S2S model: its prompt + tools configure the session, tool calls execute through the same `Tool.run` |
| `createS2SAdapter` | provider/model/credential factory, same shape as glove-core's `createAdapter` — args first, `S2S_*` env second |
| `runConformance` | the behavioural suite every adapter must pass against a fake socket |
| `createOpenAIRealtimeToken` (`/server`) | mint an ephemeral client secret server-side |

### Audio modes

Every adapter declares `mode: "device" | "transport"` so a host can refuse a
mismatch loudly at startup instead of discovering silence on the first call:

- **device** — the adapter opens the microphone and plays the reply itself.
  Least code at the call site; browser-only.
- **transport** — the adapter moves PCM and nothing else: the host feeds
  `sendAudio()` and receives `audio` events. The only mode a server room or
  phone bridge can use — there is no microphone in the process. Watch the
  declared formats: Gemini takes 16 kHz in and emits 24 kHz out.

### `createS2SAdapter` — the factory

The same configuration shape as glove-core's `createAdapter`:

```ts
import { createS2SAdapter } from "glove-voice-s2s";

// server-side: everything from env (S2S_PROVIDER, S2S_MODEL, OPENAI_API_KEY / GEMINI_API_KEY)
const adapter = createS2SAdapter();

// or explicit — args always win over env
const adapter = createS2SAdapter({ provider: "openai", model: "gpt-realtime-2.1" });

// browser: pass getToken (an ephemeral secret) — env keys never belong client-side
const adapter = createS2SAdapter({ provider: "openai-webrtc", getToken: fetchEphemeral });
```

| env | meaning |
| --- | --- |
| `S2S_PROVIDER` | `openai` (WS transport) \| `openai-webrtc` (browser device) \| `gemini`. Unset: whichever key exists, OpenAI first |
| `S2S_MODEL` | model id; unset = provider default (`gpt-realtime` / `models/gemini-live-2.5-flash-preview`) |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | the credential when no `getToken`/`apiKey` is passed (server-side only) |
| `S2S_TURN_DETECTION` | OpenAI: `semantic_vad` (default) \| `server_vad` (snappier barge-in) |

A missing credential fails at **construction** with the env-var name, not at
`connect()` with a 401. Constructing adapters directly still works — the
factory is sugar over the same classes.

## Running a Glove agent on an S2S model

Author the agent exactly as you always do — tools, prompt, store — and hand
it to `RealtimeAgent`. One definition, two runtimes: the same tools serve
text turns through the normal loop and voice turns through the provider's.

```ts
import { RealtimeAgent, GeminiLiveAdapter } from "glove-voice-s2s";

const rt = new RealtimeAgent({
  agent,                                   // a built Glove (IGloveRunnable)
  adapter: new GeminiLiveAdapter({ getToken: () => fetchToken("/api/voice/gemini-token") }),
  instructions: SPOKEN_PERSONA,            // optional: re-voice the text prompt for speech
  excludeTools: ["render_chart"],          // withhold tools that don't belong in a call
});

rt.on("user_said", (t) => log("caller:", t));
rt.on("agent_said", (t) => log("agent:", t));
await rt.start();

// transport mode: wire audio yourself
micStream.on("pcm", (pcm) => rt.sendAudio(pcm));
rt.adapter.on("audio", (pcm, format) => speaker.play(pcm, format.sampleRate));

// push async results into the live call — the model relays them out loud
rt.inject("the lookup finished: covered until 2031", { respond: true });
```

**What the voice path does NOT do** (deliberately — the provider owns the
loop, so the Glove Executor never runs):

- `requiresPermission` is not enforced — there is no permission prompt
  mid-call. Put gated tools in `excludeTools`.
- `display.pushAndWait` tools get no `handOver` and will throw. Exclude
  them too; voice-first tools should return descriptive `data` instead.
- Tool calls and transcripts are not persisted to the agent's store and do
  not fire subscriber events. Use `RealtimeAgent`'s own events
  (`user_said`, `agent_said`, `tool_started`, `tool_finished`) to log.

What IS shared with the text path: tool definitions and JSON schemas (via
`getToolJsonSchema`), Zod input validation before `run`, the system prompt,
and the `renderData`-stays-client-side contract — the bridge strips
`renderData` / `summary` before anything reaches the provider, exactly like
the model adapters do.

## Writing a new provider adapter

Implement `S2SAdapter`, then run the conformance suite against a fake
socket. The suite drives your adapter with synthetic descriptors that your
test harness translates into the provider's real wire shapes — so the cases
exercise your actual mapping code (see `tests/conformance.test.ts` for the
Gemini harness):

```ts
import { runConformance } from "glove-voice-s2s";

const results = await runConformance(() => makeAdapterAndFakeSocket());
```

Passing means the adapter is wired correctly against its own understanding
of the protocol. Only a live call proves the provider accepts the frames —
verify with credentials before shipping.

## Raw adapter usage (no Glove)

Server (mint an ephemeral token — API keys never reach the browser):

```ts
import { createOpenAIRealtimeToken } from "glove-voice-s2s/server";

const { token } = await createOpenAIRealtimeToken({
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: NOVA_PERSONA,
  voice: "marin",
  tools: [{ name: "delegate_to_worker", description: "…", parameters: {…} }],
});
```

Browser:

```ts
import { OpenAIRealtimeAdapter } from "glove-voice-s2s";

const s2s = new OpenAIRealtimeAdapter({ getToken: () => fetchToken("/api/voice/s2s-token") });
s2s.on("tool_call", async ({ callId, name, arguments: args }) => {
  const result = await runWorker(JSON.parse(args).request); // your heavy agent
  s2s.sendToolResult(callId, result); // model relays it out loud
});
s2s.on("agent_transcript_done", (text) => console.log("nova:", text));
await s2s.connect();
```

The `S2SAdapter` interface is provider-agnostic — Gemini Live / Amazon Nova
Sonic implementations slot into the same contract.

See `examples/layered-voice` (`/s2s` page) for a full working integration
with true voice-to-voice measurement.
