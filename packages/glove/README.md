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
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| `minimax` | `MINIMAX_API_KEY` | `MiniMax-M2.5` |
| `kimi` | `MOONSHOT_API_KEY` | `kimi-k2.5` |
| `glm` | `ZHIPUAI_API_KEY` | `glm-4-plus` |

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

## Key exports

- **`Glove`** — Builder class. Chain `.fold()` to register tools, `.addSubscriber()` for events, `.build()` to get a runnable agent.
- **`Displaymanager`** — Slot-based UI state manager. `pushAndWait` blocks tool execution; `pushAndForget` doesn't.
- **`SqliteStore`** — SQLite-backed conversation store.
- **`createAdapter`** — Unified provider factory for all supported LLMs.
- **`AnthropicAdapter`** / **`OpenAICompatAdapter`** — Direct model adapter classes.
- **`createTaskTool`** — Auto-registered task management tool when the store supports tasks.
- **`AbortError`** — Error class thrown when a request is cancelled via AbortSignal.

## Adapter interfaces

The core defines four pluggable adapter interfaces:

- **`ModelAdapter`** — LLM provider (`prompt`, `setSystemPrompt`)
- **`StoreAdapter`** — Persistence layer (`getMessages`, `appendMessages`, `getTokenCount`, `resetCounters`, etc.). Full message history is preserved across compaction — `resetCounters()` resets token and turn counts without deleting messages.
- **`DisplayManagerAdapter`** — UI slot management (`pushAndWait`, `pushAndForget`, `subscribe`)
- **`SubscriberAdapter`** — Event observer (`record` receives `text_delta`, `tool_use`, `tool_use_result`, `model_response_complete`)

## Documentation

- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Core API Reference](https://glove.dterminal.net/docs/core)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
