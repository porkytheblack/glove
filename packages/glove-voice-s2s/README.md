# glove-voice-s2s

Speech-to-speech (realtime voice model) sessions for the Glove agent
framework — the architecture step past the cascaded pipeline.

## Why

`glove-voice`'s cascade (VAD → STT → LLM → TTS) bottoms out around
**1.3–1.6s** voice-to-voice: every stage adds serial latency, and
end-of-turn must be reconstructed from transcripts with heuristics or an
EOU model. A speech-to-speech model collapses the cascade — audio in, one
model, audio out — with turn-taking decided by the model *listening*.
Production S2S APIs run **500–800ms** voice-to-voice.

## The split

`GloveVoice` wraps a Glove with a cascade and the Glove is the whole
intelligence. `GloveS2S` wraps a Glove with a **realtime model**, and the
intelligence splits in two:

- the realtime model owns everything that has to be **instant** — persona,
  addressing judgment, turn-taking, barge-in, the voice;
- the Glove owns everything that has to be **right** — tools, permissions,
  memory, the agent loop.

The only thing crossing between them is a tool call, and `S2SToolHost` is
that seam. Declarations are **derived from the agent** (`glove.tools`), so
folding a tool is all it takes for the voice model to gain it — there is no
second JSON-Schema list to keep in sync.

| host | what the model sees | when |
| --- | --- | --- |
| `gloveToolHost(glove)` | the agent's tools, one for one | fast, well-scoped calls |
| `delegateToolHost(glove)` | the **whole agent** as one tool | multi-step research (the layered pattern) |
| `localToolHost([...])` | tools running where the session does | browser-only work: navigate, scroll, fill |
| `httpToolHost({ endpoint })` | whatever your server declares | the agent lives on the server (the usual case) |
| `composeToolHosts(a, b)` | the union | browser tools + a server-side worker |

## Usage

**Server** — one host, read by both routes, so the declaration the model is
given and the code that answers it can't drift apart:

```ts
// app/lib/server/s2s.ts
import { delegateToolHost } from "glove-voice-s2s/server";
export const host = () => delegateToolHost(workerAgent());   // or gloveToolHost(agent)

// app/api/voice/s2s-token/route.ts — API keys never reach the browser
import { createS2STokenHandler } from "glove-voice-s2s/server";
export const POST = createS2STokenHandler(() => ({
  instructions: NOVA_PERSONA,
  voice: "marin",
  tools: host(),
}));

// app/api/s2s/tools/route.ts
import { createS2SToolHandler } from "glove-voice-s2s/server";
const handler = createS2SToolHandler(host);
export const GET = handler;
export const POST = handler;
```

**Browser:**

```ts
import { GloveS2S, OpenAIRealtimeAdapter, httpToolHost } from "glove-voice-s2s";

const s2s = new GloveS2S({
  adapter: new OpenAIRealtimeAdapter({ getToken: () => fetchToken("/api/voice/s2s-token") }),
  tools: httpToolHost({ endpoint: "/api/s2s/tools" }),
  publishTools: false,          // the token already baked the list in
});

s2s.on("state", (s) => setStatus(s));                       // listening → thinking → speaking
s2s.on("voice_to_voice", (ms) => console.log("v2v", ms));   // user quiet → agent audible
s2s.on("agent_transcript_done", (text) => console.log("nova:", text));
await s2s.start();
```

In React, `useGloveS2S` from `glove-react/s2s` is the same object with the
state already wired:

```tsx
const s2s = useGloveS2S({
  adapter: () => new OpenAIRealtimeAdapter({ getToken }),
  tools: httpToolHost({ endpoint: "/api/s2s/tools" }),
  publishTools: false,
});
// s2s.state, s2s.enabled, s2s.error, s2s.transcript, s2s.agentTranscript,
// s2s.voiceToVoiceMs, s2s.toolsRunning, s2s.start/stop/interrupt/relay/observe
```

### Out-of-band text

The wakeup path for anything that finishes *after* the turn that asked for
it — a slow worker, a webhook, a background job:

```ts
s2s.relay("The parts quote came back: 4,200 credits, ready Thursday.");  // speaks in reaction
s2s.observe("[the customer just typed: my hull is KES-0007]");           // context, no reply
```

## What survives from the layered-agents architecture

| layered concept | S2S equivalent |
| --- | --- |
| thin fast front agent | the realtime model itself (persona + addressing + voice in one) |
| delegation over the mesh | `delegateToolHost(worker)` — the heavy text worker runs unchanged |
| §5 proactive relay wakeup | `s2s.relay(result)` / a tool result + response trigger |
| barge-in + heard-prefix repair | provider-native interruption handling |
| client endpointing (VAD, holds, EOU scoring) | **deleted** — provider semantic VAD |

## What `GloveS2S` handles for you

- Publishes the host's declarations into the session on connect.
- Dispatches `tool_call` → host → `sendToolResult`, turning a thrown error
  into an error result the model can *speak about* — a realtime model is
  holding the turn open waiting on that call, so a dead promise is worse
  than a failure. `toolTimeoutMs` exists for the same reason.
- `mirrorTo` — mirrors the spoken conversation into a `StoreAdapter` (pass a
  Glove directly) so the text side can read what was said out loud.
- Voice-to-voice measurement, per turn.

## Tradeoffs

What S2S deletes is as notable as what it adds: client endpointing (VAD,
holds, EOU scoring) and heard-prefix barge-in repair go away entirely.
What it costs: turn-taking becomes a black box you cannot inspect or tune,
and you take one provider's voice and model together. `glove-voice` remains
the right choice when you need to swap STT/TTS independently, run on-device
VAD, or tune endpointing yourself.

The `S2SAdapter` interface is provider-agnostic — Gemini Live / Amazon Nova
Sonic implementations slot into the same contract, and `GloveS2S`, the tool
hosts, and the React hook work against any of them unchanged.

See `examples/layered-voice` (`/s2s` page) for a full working integration
with true voice-to-voice measurement.
