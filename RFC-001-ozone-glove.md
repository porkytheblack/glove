# RFC-001: Ozone Agent Framework & Glove Developer API

**Status:** Draft
**Author:** d3nv
**Date:** 2026-02-13
**Scope:** Core agent runtime, model adapters, display layer, developer API

---

## 1. Summary

Ozone is a TypeScript agent framework built around a canonical while-loop with five core components. Glove is the developer-facing API layer that composes those components into a builder-pattern interface with first-class human-in-the-loop support via a display stack abstraction.

The framework's differentiator is the separation between agent logic, model communication, tool execution, and user interface. A Glove agent can run identically in a CLI, a web app, or a mobile shell by swapping a single `DisplayStackAdapter` implementation.

---

## 2. Motivation & Prior Art

### 2.1 Research Findings

Analysis of three production coding agents revealed a shared architecture:

| Agent | Loop | Tools | Context | Differentiator |
|-------|------|-------|---------|----------------|
| **Claude Code** | `while(true)` + `stop_reason` check | 10+ file/bash/search tools | Compaction via summarization | Best tool definitions, permission system |
| **OpenCode** | `agentLoop()` with session state | File, bash, diagnostics | Token counting + truncation | LSP integration, Go implementation |
| **Codex CLI** | `handleTurn()` recursive | Shell, file apply, browser | Rollback via git stash | Sandboxed execution, multi-provider |

All three share the same fundamental pattern:

```
while true:
  response = model.prompt(history + tools)
  if response has tool_calls:
    results = execute(tool_calls)
    history.append(results)
    continue
  else:
    return response.text
```

### 2.2 Gaps in Existing Frameworks

- **LangChain/LangGraph:** Heavy abstractions, poor TypeScript DX, no display layer
- **Vercel AI SDK:** Streaming-first but no human-in-the-loop primitives
- **Mastra:** Good tool system but UI is bolted on, not first-class
- **None of the above** separate "what the agent does" from "how the human sees it"

### 2.3 Design Goals

1. **Canonical loop, not a pipeline.** The agent is a while-loop, not a chain of middleware.
2. **Typed everything.** Zod schemas for tool inputs, typed store interface, no `any` in public APIs.
3. **Display stack as a first-class concept.** UI is pluggable, not hardcoded.
4. **Human-in-the-loop by default.** Tools can pause and ask the human mid-execution.
5. **Model-agnostic.** Adapters normalize provider differences behind a single interface.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Glove (Developer API)          │
│  fold() · addSubscriber() · build() · process() │
├─────────────────────────────────────────────────┤
│              Display Stack Adapter               │
│  renderers[] · addAndForget() · addAndWait()     │
├────────┬────────┬─────────┬──────────┬──────────┤
│ Agent  │ Context│Executor │ Observer │ Prompt   │
│ (loop) │ (msgs) │ (tools) │(compact) │ Machine  │
├────────┴────────┴─────────┴──────────┴──────────┤
│                 Store Adapter                    │
│  getMessages · appendMessages · replaceMessages  │
│  getTokenCount · addTokens · getTurnCount · ...  │
├─────────────────────────────────────────────────┤
│                 Model Adapter                    │
│  prompt(messages, tools) → ModelPromptResult     │
├──────────┬──────────┬───────────────────────────┤
│Anthropic │  OpenAI  │  (future adapters)        │
└──────────┴──────────┴───────────────────────────┘
```

The stack has four layers:

1. **Adapters** (bottom) — normalize external APIs (model providers, storage backends)
2. **Core** — the five components that implement the agent loop
3. **Display** — pluggable UI renderers for human interaction
4. **Glove** — the builder-pattern API developers actually use

---

## 4. Core Components

### 4.1 StoreAdapter

Typed storage contract. No generic `get`/`set` — every operation is explicit.

```typescript
interface StoreAdapter {
  identifier: string;

  // Messages
  getMessages(): Promise<Array<Message>>;
  appendMessages(msgs: Array<Message>): Promise<void>;
  replaceMessages(msgs: Array<Message>): Promise<void>;

  // Counters
  getTokenCount(): Promise<number>;
  addTokens(count: number): Promise<void>;
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;

  // Lifecycle
  resetCounters(): Promise<void>;
}
```

**Design decisions:**
- Messages are append-only at the store level. Only `replaceMessages` (used by compaction) can overwrite.
- Token count tracks cumulative input + output tokens across all turns.
- `resetCounters()` zeroes tokens and turns after compaction but preserves messages.

**Reference implementation:** `MemoryStore` (in-memory, three fields: `messages[]`, `tokenCount`, `turnCount`).

**Future implementations:** SQLite (for persistence), Redis (for distributed agents), IndexedDB (for browser).

### 4.2 Message Types

```typescript
interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  tool_results?: Array<ToolResult>;
  tool_calls?: Array<ToolCall>;
}

interface ToolCall {
  tool_name: string;
  input_args: unknown;
  id?: string;  // Provider-specific call ID (e.g. toolu_xxx for Anthropic)
}

interface ToolResult {
  tool_name: string;
  call_id?: string;  // Matches ToolCall.id
  result: {
    data: unknown;
    status: "error" | "success";
    message?: string;
  };
}
```

**Invariants:**
- Messages strictly alternate between user and agent roles.
- A user message may carry `tool_results` (results flowing back to the model).
- An agent message may carry `tool_calls` (requests for tool execution).
- The `text` field on tool-result messages is a placeholder (`"tool results"`).

### 4.3 Context

Single owner of message history. Enforces role-alternation at the boundary.

```typescript
class Context {
  constructor(store: StoreAdapter);

  /** Append with automatic same-role merging at boundary */
  append(msgs: Array<Message>): Promise<void>;

  /** Read-only snapshot of full history */
  getMessages(): Promise<Array<Message>>;

  /** Replace history (compaction only) */
  replaceWithSummary(summaryMessages: Array<Message>): Promise<void>;
}
```

**Merge behavior:** If the last stored message and the first new message share a `sender`, Context merges them into one message (concatenating text, combining tool_calls/tool_results arrays). This prevents the Anthropic API's "strictly alternating roles" requirement from being violated by the agent loop.

### 4.4 PromptMachine

Thin wrapper around model calls. No state, no side effects.

```typescript
class PromptMachine {
  constructor(model: ModelAdapter, systemPrompt: string);

  addSubscriber(subscriber: SubscriberAdapter): void;

  /** Call the model. Subscribers are notified of streaming events. */
  run(messages: Array<Message>, tools?: Array<Tool<unknown>>): Promise<ModelPromptResult>;
}
```

**Events emitted to subscribers:**
- `text_delta` — streaming text chunk: `{ text: string }`
- `tool_use` — model wants to call a tool: `{ id, name, input }`
- `model_response` — complete response metadata: `{ text, tool_calls, stop_reason, tokens_in, tokens_out }`
- `model_response_complete` — streaming finished (cleanup signal)

### 4.5 Executor

Tool registry and execution engine.

```typescript
class Executor {
  registerTool(tool: Tool<any>): void;     // Throws on duplicate names
  addSubscriber(subscriber: SubscriberAdapter): void;
  addToolCallToStack(call: ToolCall): void;
  executeToolStack(askHuman?: HandOverToAddContext): Promise<Array<ToolResult>>;
}
```

**Execution flow per tool call:**
1. Find tool by name (case-insensitive). If missing → error result with available tool names.
2. Validate input against `tool.input_schema` via Zod `safeParse`. If invalid → error result with structured validation errors.
3. Call `tool.run(parsedInput, askHuman)`. If throws → error result with exception message.
4. Wrap return value in success result.
5. Notify subscribers with `tool_use_result` event after each tool.

**The `HandOverToAddContext` callback:**
```typescript
type HandOverToAddContext = (input: unknown) => Promise<unknown>;
```

Passed through from `Agent.ask()` → `Executor.executeToolStack()` → `tool.run()`. Allows tools to pause execution and request human input mid-run. In Glove, this bridges to `DisplayStackAdapter.addAndWait()`.

### 4.6 Observer

Owns compaction decisions and execution. Nothing else.

```typescript
interface CompactionConfig {
  tokenLimit: number;       // Threshold that triggers compaction
  instructions: string;     // Prompt sent to model for summarization
}

class Observer {
  constructor(store, context, promptMachine, config: CompactionConfig);

  setConfig(update: Partial<CompactionConfig>): void;

  /** Check token count, run compaction if needed. Returns true if compacted. */
  tryCompaction(): Promise<boolean>;
}
```

**Compaction procedure:**
1. Read `store.getTokenCount()`. If below `tokenLimit`, return false.
2. Get full message history from Context.
3. Append a user message with compaction instructions.
4. Call `promptMachine.run()` to get a summary.
5. Wrap the summary in a user message: `[Conversation summary from compaction]\n\n{summary}\n\n[End of summary]`
6. Call `context.replaceWithSummary([summaryMessage])`.
7. Call `store.resetCounters()`.
8. Track the compaction call's own token usage via `store.addTokens()`.

The summary is stored as a user message to maintain the role-alternation invariant.

### 4.7 Agent

The canonical while-loop orchestrator.

```typescript
interface AgentConfig {
  maxTurns?: number;              // Default: 50
  maxConsecutiveErrors?: number;  // Default: 3
}

class Agent {
  constructor(store, executor, context, observer, promptMachine, config?: AgentConfig);

  ask(message: Message, delegateToCaller?: HandOverToAddContext): Promise<ModelPromptResult | Message>;
}
```

**The agent loop:**

```
ask(userMessage, delegateToCaller):
  _message = userMessage
  consecutiveErrors = 0

  while true:
    1. context.append([_message])           // Store incoming message
    2. history = context.getMessages()       // Get full history
    3. Check turn limit → return if exceeded
    4. result = promptMachine.run(history, tools)  // Call model
    5. context.append(result.messages)       // Store model response
    6. store.addTokens(result.tokens)        // Track usage
    7. store.incrementTurn()                 // Track turns

    8. If no tool_calls in result → return result (done)

    9. Queue tool calls → executor.addToolCallToStack()
   10. toolResults = executor.executeToolStack(delegateToCaller)

   11. Circuit breaker: if all results are errors:
         consecutiveErrors++
         if >= maxConsecutiveErrors:
           inject "stop calling tools" message
       else:
         consecutiveErrors = 0

   12. observer.tryCompaction()

   13. _message = { sender: "user", text: "tool results", tool_results }
       continue loop
```

**Key invariant:** Context is the single writer. The agent loop never calls `store.appendMessages` directly — all message writes go through Context which enforces role alternation.

**Circuit breaker:** If every tool result in N consecutive rounds is an error, the agent injects a message telling the model to stop calling tools and explain the failure. Prevents infinite loops when the model repeatedly calls a broken tool.

---

## 5. Model Adapters

### 5.1 Interface

```typescript
interface ModelAdapter {
  name: string;
  prompt(request: PromptRequest, notify: NotifySubscribersFunction): Promise<ModelPromptResult>;
}

interface PromptRequest {
  messages: Array<Message>;
  tools?: Array<Tool<unknown>>;
}

interface ModelPromptResult {
  messages: Array<Message>;
  tokens_in: number;
  tokens_out: number;
}
```

### 5.2 Anthropic Adapter

**Conversion pipeline:**

```
Ozone Messages → formatMessages() → Anthropic MessageParams
Anthropic Response → parseResponse() → Ozone Message
Ozone Tools → formatTools() → Anthropic Tool definitions (via z.toJSONSchema)
```

**Message sanitization (three passes in `formatMessages`):**
1. Convert & merge consecutive same-role messages (Anthropic requires strict alternation).
2. Deduplicate `tool_result` blocks by `tool_use_id` (prevents "multiple tool_result blocks" API error).
3. Ensure every `tool_use` has a matching `tool_result`. Inject synthetic "No result available" blocks for orphans.

**Streaming mode:** Uses `client.messages.stream()`. Emits `text_delta` on text chunks, `tool_use` on content blocks, `model_response_complete` on final message.

**Sync mode:** Uses `client.messages.create()`. Emits `model_response` with complete text and tool calls.

### 5.3 Future Adapters

| Adapter | Notes |
|---------|-------|
| **OpenAI** | Tool calls use `function` type, different role names (`system`/`user`/`assistant`), parallel tool calls bundled differently |
| **Google Gemini** | Different tool format, function declarations |
| **Ollama/Local** | No streaming tool use in most models, may need ReAct-style text parsing |

---

## 6. Tool System

### 6.1 Tool Interface

```typescript
interface Tool<I> {
  name: string;
  description: string;
  input_schema: z.ZodType<I>;
  run(input: I, handOver?: HandOverToAddContext): Promise<unknown>;
}
```

- `input_schema` is a Zod schema. Adapters convert to provider-specific JSON Schema via `z.toJSONSchema()`.
- `run` receives validated, typed input. The raw `input_args` from the model are validated before reaching `run`.
- `handOver` is optional. Tools that don't need human input can ignore it.

### 6.2 Tool Categories

**Closed tools** — self-contained, no human input needed:
```typescript
// Example: read_file, write_file, bash, search
const readFile: Tool<{ path: string }> = {
  name: "read_file",
  input_schema: z.object({ path: z.string() }),
  async run(input) {
    return await fs.readFile(input.path, "utf-8");
  }
}
```

**Open tools** — require human input via handOver:
```typescript
// Example: deploy (confirmation), inject_secret (secure input)
const deploy: Tool<{ service: string; env: string }> = {
  name: "deploy",
  input_schema: z.object({ service: z.string(), env: z.string() }),
  async run(input, handOver) {
    const answer = await handOver?.({ type: "confirm", message: `Deploy ${input.service}?` });
    if (answer === "no") return "Cancelled.";
    return `Deployed ${input.service}.`;
  }
}
```

### 6.3 Reference Tool Sets

**Coding tools** (6 tools):
| Tool | Description | Key feature |
|------|-------------|-------------|
| `read_file` | Read with line numbers | Optional line range for large files |
| `write_file` | Create/overwrite | `create_dirs` flag for mkdir -p |
| `edit_file` | String replacement | Uniqueness constraint (old_string must appear exactly once) |
| `list_dir` | Recursive tree | Depth control, ignores node_modules/.git |
| `search` | Regex grep | Tries ripgrep first, falls back to grep |
| `bash` | Shell execution | Timeout (default 30s), working_dir, 5MB output buffer |

**Interactive tools** (5 tools):
| Tool | handOver calls | Pattern |
|------|---------------|---------|
| `deploy` | 1 (confirm with 3 options) | Pre-flight → confirm → execute |
| `scaffold_project` | 4 (3 inputs + confirm) | Collect details → confirm → create |
| `db_migrate` | 1-2 (confirm + typed match) | Show pending → confirm → double-confirm for rollback |
| `inject_secret` | 1 (secure input) | Prompt for value → inject (masked in output) |
| `collect_form` | N (one per field) | Sequential field collection with retry on required |

---

## 7. Subscriber System

### 7.1 Interface

```typescript
interface SubscriberAdapter {
  record: (event_type: string, data: any) => Promise<void>;
}
```

Subscribers are notified by both PromptMachine (model events) and Executor (tool events).

### 7.2 Event Catalog

| Event | Source | Data | When |
|-------|--------|------|------|
| `text_delta` | PromptMachine | `{ text: string }` | Each streaming text chunk |
| `tool_use` | PromptMachine | `{ id, name, input }` | Model requests a tool call |
| `model_response` | PromptMachine | `{ text, tool_calls, stop_reason, tokens_in, tokens_out }` | Model response complete (sync) |
| `model_response_complete` | PromptMachine | `{ text, tool_calls, stop_reason }` | Streaming finished |
| `tool_use_result` | Executor | `{ tool_name, call_id, result: { status, data, message } }` | Tool execution complete |

### 7.3 Subscriber Uses

- **Terminal UI:** Render spinners, tool output boxes, streaming text, token stats
- **Logging:** Persist events for debugging or replay
- **Metrics:** Track tool latency, error rates, token usage per tool
- **Web transport:** Bridge events to WebSocket/SSE for browser rendering

---

## 8. Glove (Developer API)

### 8.1 Overview

Glove is a builder-pattern class that composes core components + display stack into a ready-to-use agent. It provides the public API that developers interact with.

```typescript
const agent = new Glove({
  store: new MemoryStore("my-agent"),
  model: new AnthropicAdapter({ model: "claude-sonnet-4-5-20250929" }),
  displayStack: new CLIDisplayStack(),
  systemPrompt: "You are a helpful assistant.",
})
  .fold({ name: "deploy", inputSchema: ..., do: async (input, display) => { ... } })
  .fold({ name: "config",  inputSchema: ..., do: async (input, display) => { ... } })
  .addSubscriber(myLogger)
  .build();

const result = await agent.processRequest("deploy auth to production");
```

### 8.2 Interfaces

```typescript
// Builder phase — registering folds and subscribers
interface IGloveBuilder {
  fold<I>(args: GloveFoldArgs<I>): IGloveBuilder;
  addSubscriber(subscriber: SubscriberAdapter): IGloveBuilder;
  build(): IGloveRunnable;
}

// Runnable phase — processing requests
interface IGloveRunnable {
  processRequest(request: string): Promise<ModelPromptResult | Message>;
  undo(steps?: number): Promise<number>;
  readonly displayStack: DisplayStackAdapter;
}
```

After `build()`, no more folds can be added. This prevents tool registration while the agent is running.

### 8.3 Folds

A fold is a tool definition where `do` receives the display stack instead of a raw handOver callback.

```typescript
interface GloveFoldArgs<I> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  do: (input: I, display: DisplayStackAdapter) => Promise<unknown>;
  undo?: (input: I, display: DisplayStackAdapter) => Promise<void>;
}
```

**How folds bridge to the core:**

```
Glove.fold(args) creates a Tool where:
  tool.run(input, _handOver) = args.do(input, this.displayStack)
```

The Tool's `run` function ignores the raw `handOver` callback and passes `displayStack` via closure instead. The core agent/executor don't know about display stacks — they see a normal tool.

Additionally, `Glove.processRequest()` creates a fallback `handOver` that routes through `displayStack.addAndWait()`, so raw `Tool` objects mixed in with folds still work.

### 8.4 Undo System

If a fold provides an `undo` function, successful executions are pushed to an undo stack:

```typescript
interface UndoEntry {
  foldName: string;
  input: unknown;           // The original input
  undo: (input, display) => Promise<void>;
  timestamp: number;
}
```

When `build()` detects any folds with undo functions, it auto-registers an `undo_last_action` tool so the model can trigger undos when the user asks.

Programmatic undo is also available: `agent.undo(steps)`.

---

## 9. Display Stack

### 9.1 Concept

The display stack decouples agent logic from UI rendering. Tools interact with users through the display stack, not directly through stdout or DOM.

```
Tool execution → display.addAndWait(slot)
                      ↓
              DisplayStackAdapter picks a renderer
                      ↓
              Renderer shows UI + collects input
                      ↓
              Promise resolves with user's response
                      ↓
              Tool continues execution
```

### 9.2 Interfaces

```typescript
interface DisplayRenderer<I = unknown, O = unknown> {
  name: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  render: (data: I, onComplete?: (output: O) => void) => void;
}

interface DisplaySlot {
  renderer_name: string;   // References a registered renderer
  data: unknown;            // Passed to renderer.render()
}

interface DisplayStackAdapter {
  renderers: Array<DisplayRenderer>;
  stack: Array<DisplaySlot>;
  registerRenderer(renderer: DisplayRenderer): void;
  addAndForget(slot: DisplaySlot): void;    // Fire-and-forget (info, status)
  addAndWait(slot: DisplaySlot): Promise<unknown>;  // Collect input
}
```

### 9.3 Built-in Renderers (CLI)

| Renderer | Input | Output | Use case |
|----------|-------|--------|----------|
| `info` | `{ title?, message, type? }` | `void` | Status messages, warnings, errors |
| `confirm` | `{ message, options? }` | `string` | Yes/no/custom confirmations |
| `input` | `{ message, default?, field_name? }` | `string` | Free text input |
| `select` | `{ message, options, default? }` | `string` | Pick from a list |
| `secret` | `{ message, key_name? }` | `string` | Sensitive input (no echo) |

### 9.4 Platform Implementations

| Platform | Adapter | Rendering | Input collection |
|----------|---------|-----------|-----------------|
| **CLI** | `CLIDisplayStack` | chalk boxes, ora spinners | Fresh `readline.createInterface()` per prompt |
| **React/Web** | `ReactDisplayStack` (planned) | React components via state dispatch | Form elements, onSubmit handlers |
| **Mobile** | `NativeDisplayStack` (planned) | Native views via bridge | Native input elements |

**CLI readline caveat:** Each `addAndWait` call creates a **fresh** readline interface, uses it for one prompt, then closes it and calls `process.stdin.resume()`. This avoids deadlocking with the main REPL's readline instance (nested `rl.question()` calls queue behind the outer call).

---

## 10. Bugs & Lessons Learned

### 10.1 Duplicate Message Storage (Critical)

**Symptom:** Anthropic API error: "each tool_use must have a single result. Found multiple tool_result blocks with id: toolu_xxx"

**Root cause:** Two code paths both stored messages:
1. `agent.ask()` called `context.addMessages([_message])` (stores the message)
2. `context.prepare(_message)` read the store AND appended `_message` again

**Fix:** Replace `prepare(_message)` with `getMessages()`. Context is now append-only — the agent appends first, then reads.

### 10.2 Non-Awaited addMessages (Race Condition)

**Symptom:** Same API error as above, intermittent.

**Root cause:** `PromptMachine.run()` called `this.context.addMessages(result.messages)` without `await`. Two concurrent `addMessages` calls could interleave, corrupting the message array.

**Fix:** Removed message storage from PromptMachine entirely. Only the Agent loop writes to Context. One writer, no races.

### 10.3 Readline Deadlock

**Symptom:** `handOver` prompts never appeared. Agent hung silently.

**Root cause:** Main REPL used `rl.question()`, which blocks the readline instance. `handOver` called `rl.question()` on the same instance — Node queues the second question until the first callback returns, but the first callback is `await`ing handOver. Deadlock.

**Fix:** Each `handOver` prompt creates a throwaway `createInterface()`, closes it after one answer. Same pattern Inquirer.js uses.

### 10.4 Readline Stdin Pause

**Symptom:** Agent exited immediately after first handOver prompt.

**Root cause:** `promptRl.close()` calls `process.stdin.pause()`. Since all readline instances share `process.stdin`, this starved the main REPL.

**Fix:** Call `process.stdin.resume()` after `promptRl.close()`.

### 10.5 Streaming Double-Print

**Symptom:** Agent text appeared twice in terminal.

**Root cause:** Text streamed via `text_delta` subscriber events (character by character), then the REPL printed `last.text` from the final result.

**Fix:** Track `wasStreaming` flag on the subscriber. Skip the final print in the REPL if text was already streamed.

---

## 11. Pending Work

### 11.1 High Priority

| Item | Description | Status |
|------|-------------|--------|
| **ReactDisplayStack** | Web implementation of display stack. Same folds render as React components. | Not started |
| **AbortController** | Cancel mid-tool-chain via ctrl+C. Clean up running tools, return partial results. | Not started |
| **Repetition detection** | Detect when model keeps calling the same tool with the same args. Break the loop. | Partially done (circuit breaker catches all-error case) |

### 11.2 Medium Priority

| Item | Description |
|------|-------------|
| **OpenAI adapter** | Normalize function calling, different role names, parallel tool call bundling |
| **Persistent store** | SQLite adapter for conversation persistence across sessions |
| **Streaming in Glove** | Wire streaming events through display stack for real-time text rendering |
| **Tool sandboxing** | Run bash/code tools in isolated environments (containers, WASM) |

### 11.3 Low Priority

| Item | Description |
|------|-------------|
| **Ollama adapter** | Local model support, ReAct-style text parsing for models without tool use |
| **Multi-agent** | Agent-to-agent delegation via tool calls |
| **Replay/debugging** | Record all events for deterministic replay and debugging |
| **Rate limiting** | Token budget per session, cost tracking per model |

---

## 12. API Reference (Quick)

### Creating an agent with core components:

```typescript
import { MemoryStore, Context, PromptMachine, Executor, Observer, Agent } from "ozone/core";
import { AnthropicAdapter } from "ozone/adapters/anthropic";

const store = new MemoryStore("my-agent");
const model = new AnthropicAdapter({ model: "claude-sonnet-4-5-20250929", systemPrompt: "..." });
const context = new Context(store);
const prompt = new PromptMachine(model, "system prompt");
const executor = new Executor();
const observer = new Observer(store, context, prompt, { tokenLimit: 100_000, instructions: "Summarize..." });
const agent = new Agent(store, executor, context, observer, prompt, { maxTurns: 50 });

// Register tools
executor.registerTool(myTool);

// Run
const result = await agent.ask({ sender: "user", text: "Hello" });
```

### Creating an agent with Glove:

```typescript
import { Glove, MemoryStore } from "ozone";
import { AnthropicAdapter } from "ozone/adapters/anthropic";
import { CLIDisplayStack } from "ozone/display/cli";

const agent = new Glove({
  store: new MemoryStore("my-agent"),
  model: new AnthropicAdapter({ model: "claude-sonnet-4-5-20250929" }),
  displayStack: new CLIDisplayStack(),
  systemPrompt: "You are a helpful assistant.",
})
  .fold({
    name: "greet",
    description: "Greet someone by name",
    inputSchema: z.object({ name: z.string() }),
    async do(input, display) {
      const style = await display.addAndWait({
        renderer_name: "select",
        data: { message: "Greeting style:", options: ["formal", "casual"] }
      });
      return `${style === "formal" ? "Good day" : "Hey"}, ${input.name}!`;
    }
  })
  .build();

await agent.processRequest("greet Don");
```


