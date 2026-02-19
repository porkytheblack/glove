# Changelog — Glove v1.0.0

> Initial public release of the Glove framework — a TypeScript toolkit for building AI-powered applications where an agent loop replaces traditional navigation and routing.

**Release date:** February 2026

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `glove-core` | 1.0.0 | Runtime engine: agent loop, tool execution, display manager, model adapters, stores |
| `glove-react` | 1.0.0 | React hooks, `GloveClient`, `GloveProvider`, `defineTool`, `<Render>` component, adapters |
| `glove-next` | 1.0.0 | One-line Next.js App Router handler (`createChatHandler`) for streaming SSE |

---

## Features

### Core Agent Engine (`glove-core`)

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

### React Bindings (`glove-react`)

- **`useGlove` hook**: The primary React integration point. Manages the full agent lifecycle — initializes store + model, runs the agent loop, tracks timeline/streaming/slots/tasks state, and exposes `sendMessage`, `abort`, `resolveSlot`, `rejectSlot`, and render helpers. Supports both simple endpoint mode (`useGlove({ endpoint: "/api/chat" })`) and advanced mode with explicit adapters. (`4fee30e`)

- **`<Render>` component**: A fully declarative renderer for Glove conversations. Supports four layout strategies — `interleaved` (slots appear inline next to their tool call), `slots-before`, `slots-after`, and `slots-only`. Every element is customizable via render props: `renderMessage`, `renderToolStatus`, `renderStreaming`, `renderInput`, and `renderSlotContainer`. (`81edcea`)

- **`defineTool` helper**: A type-safe way to define tools with colocated `render` and `renderResult` functions. Accepts Zod schemas for input, display props, and resolve values. Eliminates boilerplate by auto-wrapping return values and wiring up the slot renderer key. (`81edcea`)

- **Timeline-based state model**: The React layer tracks conversation as a typed `TimelineEntry[]` — entries are `user`, `agent_text`, or `tool` (with `running`/`success`/`error` status). This replaces raw message arrays and gives components a clean, structured view of the conversation. (`4fee30e`, `81edcea`)

- **Enhanced slot system**: `EnhancedSlot` extends core slots with `toolName`, `toolCallId`, `createdAt`, `displayStrategy`, and `status` fields. Three display strategies control slot lifecycle: `stay` (always visible), `hide-on-complete` (hidden when resolved), and `hide-on-new` (only the latest invocation of each tool is shown). (`81edcea`)

- **`renderToolResult` for history replay**: When a page reloads, live interactive slots are gone — but `renderResult` callbacks on tools can reconstruct a read-only view from the stored `renderData`. The `<Render>` component automatically falls back to this when no active slot exists. (`81edcea`)

- **`GloveClient` and `GloveProvider`**: A client class that holds shared config (system prompt, tools, compaction settings) and a React context provider for dependency injection. Avoids prop-drilling agent config through component trees. (`4fee30e`)

- **Adapters for client-server split**: `MemoryStore` (in-memory conversation store for client-side use), `createEndpointModel` (SSE-based model adapter that talks to a server endpoint), `createRemoteStore`, and `createRemoteModel` for more advanced setups. (`4fee30e`)

- **SSE stream parser**: `parseSSEStream` provides an async iterable over Server-Sent Events from a `Response` object. Used internally by the endpoint model adapter. (`4fee30e`)

### Next.js Integration (`glove-next`)

- **`createChatHandler`**: A one-line factory for Next.js App Router POST handlers. Pass a provider name and optional model — it returns a handler that accepts `RemotePromptRequest`, streams LLM responses as SSE events, and works with all seven supported providers. Dynamically imports SDK dependencies to keep bundle size minimal. (`4fee30e`)

- **SSE streaming utilities**: `createSSEStream` and `SSE_HEADERS` handle the low-level ReadableStream creation for server-sent events. (`4fee30e`)

### Examples

- **Coding Agent** (`examples/coding-agent`): A full-stack coding assistant with a WebSocket + REST server, React SPA client with session management, model switching, permission prompts, task lists, and a timeline view. Demonstrates the `SqliteStore`, multi-provider support, and the display stack for tool permissions. (`131faa7`, `a950312`)

- **Weather Agent** (`examples/weather-agent`): A minimal CLI agent example showing basic tool registration and the agent loop. (`b19591a`)

- **Next.js Agent** (`examples/nextjs-agent`): A Next.js app demonstrating the `glove-react` + `glove-next` integration — `createChatHandler` on the server, `useGlove` with endpoint mode on the client. (`4fee30e`)

- **Coffee Shop Agent** (`examples/coffee`): A polished e-commerce demo where an AI barista helps users browse products, manage a cart, and check out. Features rich tool UIs (product cards, cart view, checkout form) built with `defineTool` and colocated renderers. Includes a test suite. (`2dca070`)

### Developer Experience

- **Claude Code agent skill** (`.claude/skills/glove/`): A bundled skill definition with API reference and examples, enabling Claude Code to provide expert guidance when building with Glove. (`a00b1eb`)

- **Production build pipeline**: `tsup` configs for all three packages with ESM output, declaration files, and proper `exports` maps in `package.json`. (`3619842`)

- **Monorepo structure**: pnpm workspace with `packages/glove`, `packages/react`, `packages/next`, `packages/site`, and `examples/*`. Shared `tsconfig.base.json` and coordinated build scripts. (`131faa7`)

---

## Bug Fixes

- **Timeline reload with `renderData`**: Tool results now persist `renderData` through the store, so tools with `renderResult` callbacks can reconstruct their UI after a page reload. Previously, interactive tool UIs were lost on refresh. (`81edcea`)

- **Streaming text flush on tool calls**: The React subscriber now correctly flushes the streaming text buffer to the timeline when a tool call arrives, preventing text from being swallowed when the model interleaves text and tool calls. (`81edcea`)

- **Model adapter `setSystemPrompt` on hot swap**: `setModel()` now correctly propagates the existing system prompt to the new model adapter, preventing blank system prompts after a provider switch. (`aeed728`)

---

## Documentation

- **Documentation site** (`packages/site`): A Next.js-powered docs site at [glove.dterminal.net](https://glove.dterminal.net) with pages for Getting Started, Core Concepts, Display Stack, React integration, Next.js integration, and three showcase walkthroughs (Coding Agent, E-commerce Store, Travel Planner). (`69030d4`)

- **Agent Skill docs page**: Added a dedicated documentation page explaining how to use the Claude Code agent skill for Glove development. (`d11effb`)

- **API reference and examples**: The `.claude/skills/glove/` directory includes `api-reference.md` and `examples.md` with comprehensive code samples for all major APIs. (`a00b1eb`)

- **README and LICENSE**: Project README with installation instructions, quick-start guide, and architecture overview. MIT license. (`68da115`)

- **OG metadata**: Site includes Open Graph image and metadata for social sharing. (`acbbb05`, `b02e8c9`)

---

## Breaking Changes

None — this is the initial release.
