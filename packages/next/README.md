# glove-next

Next.js API route handlers for the [Glove](https://github.com/porkytheblack/glove) agent framework — one-line SSE streaming endpoints.

## Install

```bash
npm install glove-next
```

Requires either `openai` or `@anthropic-ai/sdk` as a peer dependency (depending on your provider).

## Usage

```typescript
// app/api/chat/route.ts
import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",           // openai | anthropic | openrouter | gemini | minimax | kimi | glm
  model: "claude-sonnet-4-20250514", // optional — uses provider default
  apiKey: process.env.ANTHROPIC_API_KEY, // optional — defaults to env var
  maxTokens: 4096,
});
```

That's it. The handler accepts POST requests from `glove-react`'s `createEndpointModel` or `GloveClient` and streams responses as SSE.

## How it works

`createChatHandler` returns a `(req: Request) => Promise<Response>` compatible with Next.js App Router route handlers.

The handler:
1. Reads the request body (messages, tools, system prompt)
2. Forwards to the configured LLM provider
3. Streams the response as Server-Sent Events

### SSE protocol

Each SSE line contains a `RemoteStreamEvent`:

```typescript
type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; message: Message; tokens_in: number; tokens_out: number };
```

## Supported providers

| Provider | Env Variable | Default Model |
|----------|-------------|---------------|
| `openai` | `OPENAI_API_KEY` | `gpt-4.1` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| `minimax` | `MINIMAX_API_KEY` | `MiniMax-M2.5` |
| `kimi` | `MOONSHOT_API_KEY` | `kimi-k2.5` |
| `glm` | `ZHIPUAI_API_KEY` | `glm-4-plus` |

## Pair with glove-react

On the client side, use `GloveClient` with an `endpoint` pointing to your handler:

```typescript
import { GloveClient } from "glove-react";

const client = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful assistant.",
  tools: [/* your tools */],
});
```

Or use `createEndpointModel` directly:

```typescript
import { createEndpointModel } from "glove-react";
const model = createEndpointModel("/api/chat");
```

## Documentation

- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
