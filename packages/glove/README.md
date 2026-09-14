# glove-core

Core runtime engine for the [Glove](https://github.com/porkytheblack/glove) agent framework — the agent loop, tool execution, display manager, model adapters, and stores.

## Install

```bash
npm install glove-core
```

## Usage

### Server-side agent

```typescript
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import { SqliteStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { z } from "zod";

const model = createAdapter({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  stream: true, // default
});

const app = new Glove({
  store: new SqliteStore({ dbPath: "./glove.db", sessionId: "my-session" }),
  model,
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: {
    compaction_instructions: "Summarize the conversation so far.",
  },
})
  .fold({
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: z.object({ city: z.string().describe("City name") }),
    async do(input) {
      const res = await fetch(`https://wttr.in/${input.city}?format=j1`);
      return await res.json();
    },
  })
  .build();

await app.processRequest("What's the weather in Tokyo?");
```

### In-memory store

For scripts, prototyping, or when you don't need persistence:

```typescript
import type { StoreAdapter, Message, TokenConsumptionCounter } from "glove-core";

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Message[] = [];
  private tokenCount = 0;
  private turnCount = 0;

  constructor(id: string) { this.identifier = id; }

  async getMessages() { return this.messages; }
  async appendMessages(msgs: Message[]) { this.messages.push(...msgs); }
  async getTokenCount() { return this.tokenCount; }
  async addTokens(args: TokenConsumptionCounter) { this.tokenCount += args.tokens_in + args.tokens_out; }
  async getTurnCount() { return this.turnCount; }
  async incrementTurn() { this.turnCount++; }
  async resetCounters() { this.tokenCount = 0; this.turnCount = 0; }
}

const agent = new Glove({
  store: new MemoryStore("my-session"),
  model,
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: { compaction_instructions: "Summarize the conversation." },
}).build();
```

### Provider factory

```typescript
import { createAdapter, getAvailableProviders } from "glove-core/models/providers";

const model = createAdapter({
  provider: "openai",      // openai | anthropic | openrouter | gemini | minimax | kimi | glm
  model: "gpt-4.1",       // optional — uses provider default
  apiKey: "sk-...",        // optional — defaults to env var
  maxTokens: 4096,
  stream: true,            // default: true
});
```

| Provider | Env Variable | Default Model |
|----------|-------------|---------------|
| `openai` | `OPENAI_API_KEY` | `gpt-4.1` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.6-flash` |
| `minimax` | `MINIMAX_API_KEY` | `MiniMax-M2.5` |
| `kimi` | `MOONSHOT_API_KEY` | `kimi-k2.5` |
| `glm` | `ZHIPUAI_API_KEY` | `glm-4-plus` |
| `ollama` | _(none)_ | _(user-specified)_ |
| `lmstudio` | _(none)_ | _(user-specified)_ |
| `bedrock` | `AWS_ACCESS_KEY_ID` | `anthropic.claude-3-5-sonnet-20241022-v2:0` |

### Browser-safe imports

The main `glove-core` barrel includes native dependencies (better-sqlite3). For browser code, use subpath imports:

| Import | Content | Browser-safe |
|--------|---------|-------------|
| `glove-core` | Everything (barrel) | No |
| `glove-core/core` | Core types, Agent, PromptMachine, Executor, Observer | Yes |
| `glove-core/glove` | Glove builder class | Yes |
| `glove-core/display-manager` | Displaymanager | Yes |
| `glove-core/tools/task-tool` | Task tool factory | Yes |
| `glove-core/models/anthropic` | AnthropicAdapter | No |
| `glove-core/models/openai-compat` | OpenAICompatAdapter | No |
| `glove-core/models/providers` | Provider factory | No |

OpenAI-compatible adapters persist opaque `provider_options` on messages and
tool calls and return them only to the provider that produced them. This makes
Gemini 3 multi-step function calling work automatically: encrypted thought
signatures survive durable conversation storage without being interpreted or
sent to fallback providers.

## Key exports

- **`Glove`** — Builder class. Chain `.fold()` to register tools, `.addSubscriber()` for events, `.build()` to get a runnable agent.
- **`Displaymanager`** — Slot-based UI state manager. `pushAndWait` blocks tool execution; `pushAndForget` doesn't.
- **`SqliteStore`** — SQLite-backed conversation store.
- **`createAdapter`** — Unified provider factory for all supported LLMs.
- **`AnthropicAdapter`** / **`OpenAICompatAdapter`** — Direct model adapter classes.
- **`createTaskTool`** — Auto-registered task management tool when the store supports tasks.
- **`AbortError`** — Error class thrown when a request is cancelled via AbortSignal.

## Built-in tasks

`Glove` automatically exposes `glove_update_tasks` to the model and through
`glove.tools`. The default `MemoryStore` supports it out of the box; custom
stores must implement both `getTasks()` and `addTasks(tasks)` (which replaces
the full task list). Stores without both methods do not expose the tool.
The tool also binds to a store supplied through `.build(store)`.

Agents call it with `{ todos: [{ content: "Run tests", activeForm: "Running tests",
status: "in_progress" }] }`, sending the full updated list each time. Status is
`pending`, `in_progress`, or `completed`; an empty list clears the tasks.
Applications can read the saved list with `await glove.store.getTasks?.()`.

For integrations that use `Context` and `Executor` directly, import
`createTaskTool` from `glove-core` or `glove-core/tools/task-tool` and register
`createTaskTool(context)` with the executor. Regular `Glove` agents need no
manual registration.

## Adapter interfaces

The core defines four pluggable adapter interfaces:

- **`ModelAdapter`** — LLM provider (`prompt`, `setSystemPrompt`)
- **`StoreAdapter`** — Persistence layer (`getMessages`, `appendMessages`, `getTokenCount`, `resetCounters`, etc.). Full message history is preserved across compaction — `resetCounters()` resets token and turn counts without deleting messages.
- **`DisplayManagerAdapter`** — UI slot management (`pushAndWait`, `pushAndForget`, `subscribe`)
- **`SubscriberAdapter`** — Typed event observer. The `record` method is generic over a `SubscriberEvent` discriminated union (`text_delta`, `tool_use`, `tool_use_result`, `model_response`, `model_response_complete`, `compaction_start`, `compaction_end`).

## Documentation

- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Server-Side Agents](https://glove.dterminal.net/docs/server-side)
- [Core API Reference](https://glove.dterminal.net/docs/core)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT

## Live runtime context

Register changing external state with `glove.addContextProvider(async signal => renderCurrentState(signal))`. The method returns an unregister function and works before or after `build()`. Before each model iteration (including after tools), Glove appends nonempty provider output as transient user-role messages after saved history. Providers compose in registration order; failures stop the model call. System instructions and stored conversation messages remain unchanged, preserving the stable prefix for provider caching.

`await glove.getRuntimeContext(signal?)` resolves the same snapshots for external runtimes. Subscribers receive a `runtime_context` event containing detached `messages`. Runnable wrappers must forward both APIs. Registration remains local to the runnable; adapters own durable state. This API requires glove-core 4.0 or newer.

### Migrating to core 4

See the [copyable runtime migration guide](MIGRATION-4.md) for wrappers, custom loops, tracing, and realtime voice.

Standard `Glove` users keep the same mounting calls and upgrade core together with glove-memory 2. Custom runnable implementations must implement `addContextProvider` and `getRuntimeContext`; custom builders must implement `addContextProvider`. Transparent wrappers forward these methods to the underlying Glove instance. Custom execution loops resolve and append runtime context before each model iteration. Exhaustive subscriber-event handlers must accept `runtime_context`.

No model/storage adapter or saved-data migration is required. Code that previously read dynamic goals/forms/context from `getSystemPrompt()` must use `getRuntimeContext()` instead. Voice users upgrading to glove-voice-s2s 0.3 must await `refreshSession()` and handle its errors.

### Framework context and turn boundaries

Runtime snapshots carry `Message.framework_context: "runtime"`; synthetic inbox entries use `"inbox"`. This optional provenance field does not change provider roles. Tool-result summarization ignores these entries and existing skill/compaction markers when locating the last real user turn. Pending inbox reminders follow complete tool-result bundles. Preserve the marker in custom message processing and preserve structured media when merging adjacent user content.
