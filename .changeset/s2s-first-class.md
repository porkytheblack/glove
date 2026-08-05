---
"glove-voice-s2s": minor
"glove-core": minor
"glove-react": minor
---

Speech-to-speech becomes a first-class way to build a Glove agent, not a side channel you hand-wire.

`glove-voice-s2s` shipped the provider contract — an `S2SAdapter`, a token minter, and `tool_call` events. Wiring it to an actual agent was still yours to do: declare every tool's JSON Schema a second time for the token mint, dispatch `tool_call` by hand in a `useEffect`, POST to a bespoke route, salvage the worker's final message out of its store, serialize concurrent runs, and stopwatch voice-to-voice yourself. The example's `/s2s` page carried all of it.

**`GloveS2S`** now wraps a Glove the way `GloveVoice` does — but where the cascade makes the Glove the whole intelligence, S2S splits it: the realtime model owns what must be *instant* (persona, turn-taking, barge-in, the voice), the Glove owns what must be *right* (tools, permissions, memory, the agent loop). The one thing crossing between them is a tool call.

**`S2SToolHost`** is that seam, and every wiring option is an implementation of it:

- `gloveToolHost(glove)` — the agent's tools one-for-one, executed through its own executor (permission gate, schema validation, retries, `tool_use_result` events).
- `delegateToolHost(glove)` — the *whole agent* as one tool: the layered pattern, with run serialization and final-message extraction built in.
- `localToolHost([...])` — tools that run where the session does (navigate, scroll, fill).
- `httpToolHost({ endpoint })` — the browser half of the bridge; `createS2SToolHandler` is the server half, as one fetch handler (`export const GET/POST = handler`).
- `composeToolHosts(a, b)` — browser tools and a server-side worker in one session.

Declarations are **derived from the agent**, so folding a tool is all it takes for the voice model to gain it — `createOpenAIRealtimeToken({ tools })` now accepts a host directly, and `createS2STokenHandler` makes the mint route a single export. There is no parallel schema list left to drift.

`GloveS2S` also handles the things that were easy to get subtly wrong: a thrown tool error becomes an error result the model can *speak about* (a realtime model holds the turn open waiting on that call, so a dead promise is worse than a failure), `toolTimeoutMs` for the same reason, `mirrorTo` to put the spoken conversation into a store the text side can read, `relay()` / `observe()` for out-of-band text, and per-turn `voice_to_voice` measurement.

**`useGloveS2S`** (`glove-react/s2s`) is the React binding — the mirror of `useGloveVoice`, minus the VAD/STT/TTS/turn-detector configuration the model now owns.

In `glove-core`, two additions that are general rather than S2S-specific — any non-text driver (a realtime model, an MCP server, an eval harness) needs the same two things:

- **`IGloveRunnable.tools`** — enumerate registered tools (pair with `getToolJsonSchema`) to publish the agent's capabilities somewhere else.
- **`IGloveRunnable.invokeTool(name, input, opts?)`** — run one tool through the full executor path without a model turn, on top of a new `Executor.runToolCall`. Never throws for a failing tool; the failure comes back as `{ status: "error" }`.
- **`extractAgentText(result)`** — unwrap whatever `processRequest` returned (`ModelPromptResult`, or a bare `Message` when a hook short-circuits) into the agent's reply text.

`examples/layered-voice` (`/s2s`) is rebuilt on this: the bespoke delegate route is gone, the page's tool plumbing is gone, and what's left is a host, two route exports, and a hook.
