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

## Usage

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
