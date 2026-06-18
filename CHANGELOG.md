# Changelog

## v3.1.0 — Prompt caching

**Package:** `glove-core` 3.1.0

### Prompt caching

A `cache` affordance on the model factory, every model adapter, and the
`glove-next` chat handler enables provider prompt caching from one consistent
switch. Pass `cache: true` for sensible defaults or `cache: { ttl: "1h" }` to
tune the lifetime.

```ts
createAdapter({ provider: "anthropic", cache: true });
createAdapter({ provider: "anthropic", cache: { ttl: "1h" } });
createChatHandler({ provider: "anthropic", cache: true });
```

How it's applied per provider:

- **anthropic** / **anthropic-compat** — `cache_control` ephemeral breakpoints
  on the stable prefix (tools render before the system prompt, so one
  breakpoint caches both) and on the latest conversation turn, so each
  follow-up request reuses the prior context. `ttl` (`"5m"` default / `"1h"`)
  is honoured. Below a model's minimum cacheable prefix the API silently skips
  caching — no error.
- **bedrock** — `cachePoint` checkpoints after the tool list, after the system
  prompt, and on the latest turn (cache-capable models only). `ttl` maps onto
  Bedrock's `CacheTTL` (`"5m"` / `"1h"`).
- **openrouter** — `cache_control` breakpoints forwarded to the upstream
  Anthropic / Gemini model.
- **openai / gemini / minimax / kimi / glm / mimo / ollama / lmstudio** — these
  providers cache automatically, so enabling has no request-side effect.

Regardless of the `cache` setting, every adapter now surfaces the provider's
reported cache usage on `ModelPromptResult.cache_creation_input_tokens` /
`cache_read_input_tokens` (OpenAI-compatible providers report reads via
`prompt_tokens_details.cached_tokens`), and forwards those counts on the
`model_response` / `model_response_complete` subscriber events. Inspect
`cache_read_input_tokens` to confirm cache hits.

### Cache usage for downstream clients (billing)

Cache token counts flow all the way through the token-accounting path so
downstream clients can use them for billing / cost attribution:

- **`TokenConsumptionCounter`** gains optional `cache_creation_input_tokens` /
  `cache_read_input_tokens`, so the per-turn **`token_consumption`** subscriber
  event carries cache usage — the canonical real-time billing surface.
- **`StoreAdapter.getTokenConsumption?()`** (new optional method, implemented by
  `MemoryStore`) returns the session's cumulative `TokenConsumptionCounter`
  including cache totals, for aggregate billing queries without replaying the
  event stream.
- **`glove-react`**: `GloveStats` (from `useGlove().stats`) gains
  `cache_creation_input_tokens` / `cache_read_input_tokens`, accumulated from
  the `token_consumption` event.
- **`glove-next` / remote model**: the SSE `done` event (`RemoteStreamEvent`)
  and `RemotePromptResponse` carry optional cache fields, so a Next.js chat
  handler reports provider cache usage and the client-side agent loop threads it
  into the `token_consumption` event and `stats`.

## v3.0.0 — Subagents, observability & MemoryStore

**Release date:** May 2026

---

### Highlights

- **First-class subagents** via `defineSubAgent` with a factory pattern — the parent agent invokes a registered subagent through the auto-registered `glove_invoke_subagent` tool, the framework runs the child Glove and returns its final agent text as the tool result.
- **Sub-stores** (`StoreAdapter.createSubAgentStore`) so subagent conversations and token usage can be tracked independently for per-run cost attribution.
- **Comprehensive subscriber events** for hooks, skills, and subagents — including bracketed `subagent_invoked` / `subagent_completed` with **guaranteed 1:1 symmetry** even on parent abort.
- **`MemoryStore` in `glove-core`** — comprehensive default `StoreAdapter` with sub-store support, used automatically when `Glove` is constructed without a store.
- **Pre-emptive compaction** — `Observer.ESCAPE_COMPACTION_THRESHOLD` (default 90%) keeps `tool_use` / `tool_result` pairs from being split across compactions.

### Updated Packages

| Package | Version |
|---------|---------|
| `glove-core` | 3.0.0 |
| `glove-react` | 3.0.0 |
| `glove-voice` | 3.0.0 |
| `glove-next` | 3.0.0 |

### New / promoted packages (early-access at 0.5.0)

| Package | Version | Description |
|---------|---------|-------------|
| `glove-mcp` | 0.5.0 | MCP server bridging — `mountMcp` reloads previously-activated servers and registers the `discovermcp` discovery subagent. Promoted from internal use to a stable surface. |
| `glovebox-core` | 0.5.0 | Authoring kit and `glovebox` build CLI for shipping a built `Glove` runnable as a sandboxed, network-addressable service. |
| `glovebox-kit` | 0.5.0 | In-container runtime for Glovebox — hosts a Glove agent behind a single authenticated WebSocket plus an HTTP `/files` route. |
| `glovebox-client` | 0.5.0 | Client SDK for talking to a deployed Glovebox server. |

The `glovebox-*` packages are at 0.x because the surface is still solidifying. The `glove-mcp` jump from 0.1 to 0.5 reflects the migration to first-class subagent dispatch (see breaking changes below).

### Deprecated

- **`glove-sqlite`** — no longer receiving new features. The new `MemoryStore` in `glove-core` covers most prototyping needs; for production, BYO `StoreAdapter`. The package still installs and works, just without `createSubAgentStore` support.

---

### Breaking Changes

#### `StoreAdapter.addTokens(args: TokenConsumptionCounter)`
Was `(count: number)`. The counter is `{ tokens_in: number; tokens_out: number }` — the framework now records both directions separately, useful for per-direction cost reporting. `getTokenCount()` still returns a single sum. **Affects every custom `StoreAdapter` implementation.**

```ts
// Before
async addTokens(count: number) { this.tokens += count }

// After
async addTokens(args: TokenConsumptionCounter) {
  this.tokens += args.tokens_in + args.tokens_out
}
```

In `glove-react`, the same change applies to `RemoteStoreActions.addTokens(sessionId, args: TokenConsumptionCounter)`.

#### `Glove.defineMention` → `Glove.defineSubAgent` (factory pattern)
`defineMention(args)` is removed. The `Mention*` family of types is replaced by `SubAgent*`. The shape changed too: instead of returning string content, the factory builds and returns a fully-built child `Glove`, and the framework calls `child.processRequest(prompt, signal)` and uses the final agent text as the tool result.

```ts
// Before
glove.defineMention({
  name: "researcher",
  handler: async ({ prompt, controls }) => "research result",
})

// After
glove.defineSubAgent({
  name: "researcher",
  factory: async ({ parentStore, parentControls, prompt }) => {
    const subStore = await parentStore.createSubAgentStore?.("researcher", false)
    return new Glove({
      store: subStore,
      model: parentControls.glove.model,
      displayManager: parentControls.displayManager,
      systemPrompt: "You are a researcher.",
      compaction_config: { compaction_instructions: "Summarize research progress." },
    }).fold(searchTool).build()
  },
})
```

#### `glove-mcp`: `discoveryTool` → `discoverySubAgent`; `find_capability` → `discovermcp`
`discoveryTool({...})` is renamed `discoverySubAgent({...})` and now returns `DefineSubAgentArgs` (used with `glove.defineSubAgent(...)` instead of `glove.fold(...)`). The discovery subagent's name is `discovermcp` (was `find_capability`); the model invokes via `glove_invoke_subagent({ name: "discovermcp", prompt: "..." })`. `mountMcp` consumers don't need to change anything — it wires the new shape internally.

#### Hook / skill directives — placeholders, not stripped
User text containing `/skill-name` or `/hook-name` directives is no longer stripped from the persisted user message. Each bound directive is replaced by a non-triggerable placeholder of the form `[invoked_extension__hook_<name>]` or `[invoked_extension__skill_<name>]`. Hook and skill handlers receive `parsedText` containing the placeholder, not the bare directive.

#### `Tool.run` and `GloveFoldArgs.do` gain optional `signal`
`Tool.run(input, handOver?, signal?)` — backward-compatible; tools that ignore the third arg still work. `GloveFoldArgs.do(input, display, glove, signal?)` similarly gains an optional fourth `signal`. Tools that perform long-running internal work (subagent dispatchers, fetches) should forward it.

---

### Features

#### Core (`glove-core`)

- **`defineSubAgent(args)`** — register a subagent factory. Receives `{ name, prompt, parentStore, parentControls }` and returns an `IGloveRunnable`. Parent subscribers automatically fan out to the child for the duration of the run.
- **`SUBAGENT_DISPATCH_TOOL_NAME`** — exported constant (`"glove_invoke_subagent"`); the Executor uses it to recognize subagent dispatch calls and bracket them.
- **`StoreAdapter.createSubAgentStore?(namespace, durable?)`** — optional. `durable: false` (default) returns a fresh child store per call; `durable: true` returns a cached child for the namespace.
- **`MemoryStore`** — comprehensive in-memory store exported from `glove-core`. Implements the full `StoreAdapter` surface including `createSubAgentStore`. Used as the default when `Glove` is constructed without a store.
- **`Glove.build(store?)` and `Glove.rebuild(store?)`** — store can be supplied at build time. Tools folded before build are correctly transferred into the rebuilt executor.
- **`IGloveRunnable.setDisplayManager(dm)` / `IGloveBuilder.setDisplayManager(dm)`** — chainable post-build setter. Subagents can share the parent's display via `parentControls.displayManager`.
- **`AgentControls` extended** with `store: StoreAdapter` and `displayManager: DisplayManagerAdapter` direct accessors.
- **Subscriber events**: `token_consumption`, `hook_invoked`, `skill_invoked`, `subagent_invoked`, `subagent_completed`. Bracket events fire from the Executor for guaranteed 1:1 symmetry on abort.
- **`Observer.ESCAPE_COMPACTION_THRESHOLD`** (default 90%) — pre-emptive compaction in `Agent.ask` runs `runCompactionNow()` if the soft threshold is crossed AND the model just produced tool calls, keeping `tool_use` / `tool_result` pairs together.
- **`Message.pre_modified_text`** — when a hook rewrites a user message, the original text is preserved on this field so UIs can still show what the user typed.

#### MCP (`glove-mcp` 0.5.0)

- **`discoverySubAgent(config)`** — replaces `discoveryTool`. Returns a `DefineSubAgentArgs` for `glove.defineSubAgent(...)`. Subagent name is `discovermcp`.
- **Bracketed observability** — every discovery run emits `subagent_invoked` / `subagent_completed` plus all child events between (parent subscribers fan out automatically). Per-run token usage is tracked independently on the child store.

#### Glovebox (`glovebox-core` / `glovebox-kit` / `glovebox-client` 0.5.0)

- **Authoring kit and CLI** — wrap a built `Glove` runnable, run `glovebox build`, ship the resulting Dockerfile (or nixpacks bundle) to any container host.
- **In-container runtime** — `glovebox-kit` hosts a Glove agent behind a single authenticated WebSocket endpoint plus an HTTP `/files` route for outputs.
- **Client SDK** — `glovebox-client` provides a typed client for talking to a deployed Glovebox server. One WebSocket per session, multiple prompts multiplexed.

---

### Documentation

- **Site overhaul** — every docs page rewritten for the new API surface.
- **MCP guide** — discovery section rewritten for the factory pattern and `discovermcp` subagent name.
- **Migration guide** — new [`/docs/v3`](https://glove.dterminal.net/docs/v3) page covers the migration step-by-step.
- **Registry section removed** — the `/tools` registry has been deleted from the site.
- **Claude Code skill** — `.claude/skills/glove/` rewritten to match 3.0.0.

---
---

## v2.0.0 — Voice Support

**Release date:** February 2026

---

### New Package

| Package | Version | Description |
|---------|---------|-------------|
| `glove-voice` | 2.0.0 | Voice pipeline: STT/TTS adapters, VAD, audio capture/playback, barge-in, sentence chunking |

### Updated Packages

| Package | Version |
|---------|---------|
| `glove-core` | 2.0.0 |
| `glove-react` | 2.0.0 |
| `glove-next` | 2.0.0 |

---

### Features

#### Voice Pipeline (`glove-voice`)

- **`GloveVoice` class**: Orchestrates the full voice loop — listens via STT, sends transcripts through the Glove agent, streams responses through TTS, and plays audio. Manages mode transitions (`idle` → `listening` → `thinking` → `speaking`) and exposes `start()`, `stop()`, `interrupt()`. (`a0d08b1`)

- **ElevenLabs adapters**: Built-in STT adapter (Scribe Realtime WebSocket) and TTS adapter (Input Streaming WebSocket) for ElevenLabs. `createElevenLabsAdapters()` convenience factory wires both from a single config. (`a0d08b1`)

- **Server-side token helpers**: `createElevenLabsSTTToken()` and `createElevenLabsTTSToken()` generate short-lived API tokens server-side, keeping API keys off the client. Placeholder exports for Deepgram and Cartesia. (`a0d08b1`)

- **Silero VAD integration**: `createSileroVAD()` dynamically imports `@ricky0123/vad-web` and configures it for voice activity detection. Handles ONNX runtime setup, audio worklet registration, and provides `onSpeechStart` / `onSpeechEnd` / `onSpeechCancel` callbacks. (`b4b765e`)

- **Built-in VAD fallback**: `BuiltInVAD` provides a lightweight volume-threshold VAD for environments where Silero is unavailable. Configurable `threshold` and `silentFrames` parameters. (`a0d08b1`)

- **Audio capture and playback**: `AudioCapture` manages microphone access and raw PCM streaming. `AudioPlayer` handles queued audio chunk playback with `onStart` / `onEnd` callbacks for mode synchronization. (`a0d08b1`)

- **Sentence chunker**: Splits streaming text into sentence-sized chunks for natural TTS pacing. Handles abbreviations, decimal numbers, and ellipses without false splits. (`a0d08b1`)

- **Barge-in with `unAbortable` protection**: When the user speaks during agent output, `GloveVoice` calls `interrupt()` to stop TTS and abort the current request. But if a `pushAndWait` resolver is pending (`displayManager.resolverStore.size > 0`), barge-in is suppressed — and tools with `unAbortable: true` continue executing even after abort. (`9977ced`)

- **Adapter interface contracts**: `STTAdapter` and `TTSAdapter` interfaces define the protocol for plugging in any speech provider. `TTSFactory` creates fresh TTS instances per utterance for clean WebSocket lifecycle. (`a0d08b1`)

- **Text extraction utility**: `extractText()` pulls plain text from `ModelPromptResult` responses, handling both string content and content-part arrays. Used to feed agent output into TTS. (`a0d08b1`)

#### Core Engine (`glove-core`)

- **`unAbortable` tools**: Tools can set `unAbortable: true` to run to completion even when the abort signal fires. The executor skips `abortablePromise` wrapping and allows retries regardless of signal state. Critical for tools that perform mutations (e.g. checkout, payments). (`9977ced`)

- **`"aborted"` tool result status**: Tool results now support a third status `"aborted"` alongside `"success"` and `"error"`. When a request is aborted, non-`unAbortable` tools that haven't started yet receive an aborted result instead of being silently skipped. (`9977ced`)

- **`abortablePromise` utility**: New helper wraps a promise so it rejects with `AbortError` when the signal fires, providing clean abort semantics for tool execution. (`9977ced`)

- **`setSystemPrompt()`**: New method on `IGloveRunnable` updates the system prompt mid-session without rebuilding the agent. Used by voice pipelines to switch between text-mode and voice-mode prompts. (`9977ced`)

- **`removeSubscriber()`**: New method on `PromptMachine` and `Executor` allows dynamic subscriber removal. Enables the voice pipeline to attach/detach its subscriber without leaking. (`9977ced`)

- **`IGloveRunnable` exported**: The runnable interface is now exported from `glove-core/glove`, allowing external consumers (like `glove-voice` and `useGloveVoice`) to type-safely reference the built agent. (`9977ced`)

#### React Bindings (`glove-react`)

- **`useGloveVoice` hook**: New hook that wraps `GloveVoice` for React. Takes a `runnable` (from `useGlove().runnable`) and voice config, returns `mode`, `transcript`, `isActive`, `error`, `start()`, `stop()`, `interrupt()`. Handles lifecycle cleanup on unmount. Exported from `glove-react/voice`. (`9977ced`)

- **`runnable` exposed from `useGlove`**: The hook now returns the underlying `IGloveRunnable` instance (or `null` before initialization). This is the bridge that connects `useGlove` to `useGloveVoice`. (`9977ced`)

- **`"aborted"` status in timeline**: `TimelineEntry` tool status now includes `"aborted"`. When a request is aborted, running tools are marked as aborted in the timeline rather than left in a `"running"` state. (`9977ced`)

- **`unAbortable` in `defineTool` and `ToolConfig`**: Both `defineTool()` and the `ToolConfig` interface accept `unAbortable?: boolean`, passing it through to the core tool definition. (`9977ced`)

- **`glove-react/voice` subpath export**: New subpath export provides `useGloveVoice` and re-exports voice types (`VoiceMode`, `TurnMode`, `GloveVoiceConfig`, `TTSFactory`) so consumers don't need to import `glove-voice` directly. (`9977ced`)

#### Next.js Integration (`glove-next`)

- **`createVoiceTokenHandler`**: New factory for Next.js App Router GET handlers that return short-lived voice API tokens. Supports ElevenLabs (STT and TTS tokens), Deepgram, and Cartesia. Resolves API keys from config or environment variables. (`9977ced`)

#### Examples

- **Lola — Voice-First Movie Companion** (`examples/lola`): A voice-primary app where users speak to discover movies. Features a cinematic dark UI with amber accent, central voice orb, transcript strip, and 9 TMDB-powered tools (`search_movies`, `get_movie_details`, `get_ratings`, `get_trailer`, `compare_movies`, `get_recommendations`, `get_person`, `get_streaming_availability`, `remember_preference`). All tools use `pushAndForget` for non-blocking voice flow. TMDB API proxied server-side. (`b4efb16`)

- **Coffee Shop — Voice-Enabled**: The existing coffee shop example now supports voice alongside text. Adds a voice orb toggle, thinking sound, dynamic system prompt switching (text vs voice mode), and voice-aware tool variants (`get_products`, `get_cart`) that return data for verbal narration instead of visual-only display. The checkout tool uses `unAbortable: true` to protect against barge-in during payment. (`9977ced`, `b4b765e`)

#### Documentation

- **Voice integration guide**: New docs page (`/docs/voice`) covering the voice pipeline architecture, adapter setup, VAD configuration, barge-in behavior, `unAbortable` tools, and the two-layer protection model. (`b4efb16`)

- **Coffee Shop showcase page**: New showcase walkthrough (`/docs/showcase/coffee-shop`) explaining the coffee shop architecture, tool categories, voice integration, and `unAbortable` checkout pattern. (`b4efb16`)

- **Lola showcase page**: New showcase walkthrough (`/docs/showcase/lola`) covering voice-first design, TMDB integration, tool design for voice, visual area pattern, and voice orb states. (`b4efb16`)

- **`unAbortable` documented across all surfaces**: Added to Core API, React API, agent skill reference, and examples. (`b4efb16`)

- **Sidebar voice badges**: Showcase entries with voice support display an amber "voice" pill in the docs sidebar. (`b4efb16`)

#### Developer Experience

- **Agent skill updated**: `.claude/skills/glove/` updated with `unAbortable` documentation, voice barge-in patterns, and corrected VAD defaults. (`b4efb16`)

---

### Breaking Changes

- **Tool result status type widened**: `ToolResultData.status` is now `"success" | "error" | "aborted"` (was `"success" | "error"`). Code that exhaustively switches on status will need to handle the new `"aborted"` case.

- **`TimelineEntry` tool status widened**: Same change in the React layer — tool entries can now be `"running" | "success" | "error" | "aborted"`.

- **`IGloveRunnable` interface expanded**: Now includes `setSystemPrompt()`, `addSubscriber()`, and `removeSubscriber()` in addition to the existing `processRequest()`, `setModel()`, and `displayManager`. Custom implementations of this interface will need to add the new methods.

---
---

## v1.0.0 — Initial Release

> Initial public release of the Glove framework — a TypeScript toolkit for building AI-powered applications where an agent loop replaces traditional navigation and routing.

**Release date:** February 2026

---

### Packages

| Package | Version | Description |
|---------|---------|-------------|
| `glove-core` | 1.0.0 | Runtime engine: agent loop, tool execution, display manager, model adapters, stores |
| `glove-react` | 1.0.0 | React hooks, `GloveClient`, `GloveProvider`, `defineTool`, `<Render>` component, adapters |
| `glove-next` | 1.0.0 | One-line Next.js App Router handler (`createChatHandler`) for streaming SSE |

---

### Features

#### Core Agent Engine (`glove-core`)

- **Builder-pattern agent construction**: The `Glove` class provides a chainable API — call `.fold()` to register tools, `.addSubscriber()` for event listeners, and `.build()` to finalize. This makes agent setup declarative and composable. (`f7a3d26`, `b19591a`)

- **Agentic tool loop**: `Agent.ask()` drives a prompt-execute-loop — the model is called, tool calls are extracted and executed, results are fed back, and the loop continues until the model responds with plain text. This is the core behavior that lets an LLM orchestrate multi-step workflows. (`f7a3d26`)

- **Display Manager (slot-based UI system)**: Tools can render interactive UI to the user via `pushAndWait` (blocks tool execution until the user responds) and `pushAndForget` (fire-and-forget display). This is the key primitive that lets tools collect user input — forms, confirmations, option pickers — without breaking the agent loop. (`b19591a`)

- **Multi-provider model support**: Ship with adapters for **Anthropic** (native SDK), **OpenAI**, **OpenRouter**, **Google Gemini**, **MiniMax**, **Kimi (Moonshot)**, and **GLM (Zhipu AI)**. A unified `createAdapter()` factory resolves provider config, API keys from env vars, and default models automatically. (`aeed728`, `b19591a`)

- **OpenAI-compatible adapter**: Any provider that speaks the OpenAI chat completions API — including OpenRouter, Gemini, MiniMax, Kimi, and GLM — is handled by a single `OpenAICompatAdapter` with streaming support. This means adding new providers is trivial. (`aeed728`)

- **SQLite conversation store**: `SqliteStore` persists messages, tool results, tasks, and permissions in a local SQLite database with WAL mode. Supports session isolation, token/turn counting, and automatic schema migrations. Ideal for server-side agents and CLI tools. (`a950312`)

- **Task management system**: A built-in task tool lets the agent create, update, and track structured tasks (with `pending`, `in_progress`, `completed` states). Tasks are automatically registered when the store supports them. (`38d170b`)

- **Conversation compaction**: The `Observer` class monitors conversation length and triggers automatic compaction when a configurable turn limit is reached. This keeps context windows manageable during long-running sessions. (`f7a3d26`, `aeed728`)

- **Abort signal support**: `processRequest` accepts an optional `AbortSignal`, allowing the client to cancel in-flight requests cleanly. (`81edcea`)

- **Hot model swapping**: `setModel()` on a running `Glove` instance lets you switch the underlying LLM provider mid-session without rebuilding the agent. (`aeed728`)

- **Multimodal message support**: `ContentPart` types support `text`, `image`, `video`, and `document` parts, enabling vision and multi-modal workflows. (`81edcea`)

- **`renderData` on tool results**: Tool results can now include a `renderData` field — data that is not sent to the model but is preserved for rendering tool results from history (e.g., showing a completed checkout form on page reload). (`81edcea`)

#### React Bindings (`glove-react`)

- **`useGlove` hook**: The primary React integration point. Manages the full agent lifecycle — initializes store + model, runs the agent loop, tracks timeline/streaming/slots/tasks state, and exposes `sendMessage`, `abort`, `resolveSlot`, `rejectSlot`, and render helpers. Supports both simple endpoint mode (`useGlove({ endpoint: "/api/chat" })`) and advanced mode with explicit adapters. (`4fee30e`)

- **`<Render>` component**: A fully declarative renderer for Glove conversations. Supports four layout strategies — `interleaved` (slots appear inline next to their tool call), `slots-before`, `slots-after`, and `slots-only`. Every element is customizable via render props: `renderMessage`, `renderToolStatus`, `renderStreaming`, `renderInput`, and `renderSlotContainer`. (`81edcea`)

- **`defineTool` helper**: A type-safe way to define tools with colocated `render` and `renderResult` functions. Accepts Zod schemas for input, display props, and resolve values. Eliminates boilerplate by auto-wrapping return values and wiring up the slot renderer key. (`81edcea`)

- **Timeline-based state model**: The React layer tracks conversation as a typed `TimelineEntry[]` — entries are `user`, `agent_text`, or `tool` (with `running`/`success`/`error` status). This replaces raw message arrays and gives components a clean, structured view of the conversation. (`4fee30e`, `81edcea`)

- **Enhanced slot system**: `EnhancedSlot` extends core slots with `toolName`, `toolCallId`, `createdAt`, `displayStrategy`, and `status` fields. Three display strategies control slot lifecycle: `stay` (always visible), `hide-on-complete` (hidden when resolved), and `hide-on-new` (only the latest invocation of each tool is shown). (`81edcea`)

- **`renderToolResult` for history replay**: When a page reloads, live interactive slots are gone — but `renderResult` callbacks on tools can reconstruct a read-only view from the stored `renderData`. The `<Render>` component automatically falls back to this when no active slot exists. (`81edcea`)

- **`GloveClient` and `GloveProvider`**: A client class that holds shared config (system prompt, tools, compaction settings) and a React context provider for dependency injection. Avoids prop-drilling agent config through component trees. (`4fee30e`)

- **Adapters for client-server split**: `MemoryStore` (in-memory conversation store for client-side use), `createEndpointModel` (SSE-based model adapter that talks to a server endpoint), `createRemoteStore`, and `createRemoteModel` for more advanced setups. (`4fee30e`)

- **SSE stream parser**: `parseSSEStream` provides an async iterable over Server-Sent Events from a `Response` object. Used internally by the endpoint model adapter. (`4fee30e`)

#### Next.js Integration (`glove-next`)

- **`createChatHandler`**: A one-line factory for Next.js App Router POST handlers. Pass a provider name and optional model — it returns a handler that accepts `RemotePromptRequest`, streams LLM responses as SSE events, and works with all seven supported providers. Dynamically imports SDK dependencies to keep bundle size minimal. (`4fee30e`)

- **SSE streaming utilities**: `createSSEStream` and `SSE_HEADERS` handle the low-level ReadableStream creation for server-sent events. (`4fee30e`)

#### Examples

- **Coding Agent** (`examples/coding-agent`): A full-stack coding assistant with a WebSocket + REST server, React SPA client with session management, model switching, permission prompts, task lists, and a timeline view. Demonstrates the `SqliteStore`, multi-provider support, and the display stack for tool permissions. (`131faa7`, `a950312`)

- **Weather Agent** (`examples/weather-agent`): A minimal CLI agent example showing basic tool registration and the agent loop. (`b19591a`)

- **Next.js Agent** (`examples/nextjs-agent`): A Next.js app demonstrating the `glove-react` + `glove-next` integration — `createChatHandler` on the server, `useGlove` with endpoint mode on the client. (`4fee30e`)

- **Coffee Shop Agent** (`examples/coffee`): A polished e-commerce demo where an AI barista helps users browse products, manage a cart, and check out. Features rich tool UIs (product cards, cart view, checkout form) built with `defineTool` and colocated renderers. Includes a test suite. (`2dca070`)

#### Developer Experience

- **Claude Code agent skill** (`.claude/skills/glove/`): A bundled skill definition with API reference and examples, enabling Claude Code to provide expert guidance when building with Glove. (`a00b1eb`)

- **Production build pipeline**: `tsup` configs for all three packages with ESM output, declaration files, and proper `exports` maps in `package.json`. (`3619842`)

- **Monorepo structure**: pnpm workspace with `packages/glove`, `packages/react`, `packages/next`, `packages/site`, and `examples/*`. Shared `tsconfig.base.json` and coordinated build scripts. (`131faa7`)

---

### Bug Fixes

- **Timeline reload with `renderData`**: Tool results now persist `renderData` through the store, so tools with `renderResult` callbacks can reconstruct their UI after a page reload. Previously, interactive tool UIs were lost on refresh. (`81edcea`)

- **Streaming text flush on tool calls**: The React subscriber now correctly flushes the streaming text buffer to the timeline when a tool call arrives, preventing text from being swallowed when the model interleaves text and tool calls. (`81edcea`)

- **Model adapter `setSystemPrompt` on hot swap**: `setModel()` now correctly propagates the existing system prompt to the new model adapter, preventing blank system prompts after a provider switch. (`aeed728`)

---

### Documentation

- **Documentation site** (`packages/site`): A Next.js-powered docs site at [glove.dterminal.net](https://glove.dterminal.net) with pages for Getting Started, Core Concepts, Display Stack, React integration, Next.js integration, and three showcase walkthroughs (Coding Agent, E-commerce Store, Travel Planner). (`69030d4`)

- **Agent Skill docs page**: Added a dedicated documentation page explaining how to use the Claude Code agent skill for Glove development. (`d11effb`)

- **API reference and examples**: The `.claude/skills/glove/` directory includes `api-reference.md` and `examples.md` with comprehensive code samples for all major APIs. (`a00b1eb`)

- **README and LICENSE**: Project README with installation instructions, quick-start guide, and architecture overview. MIT license. (`68da115`)

- **OG metadata**: Site includes Open Graph image and metadata for social sharing. (`acbbb05`, `b02e8c9`)

---

### Breaking Changes

None — this is the initial release.
