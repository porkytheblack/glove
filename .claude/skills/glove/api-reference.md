# Glove API Reference

## glove-core

### Glove Class (Builder)

```typescript
import { Glove } from "glove-core";

const agent = new Glove({
  store: StoreAdapter,                    // Required — persistence
  model: ModelAdapter,                    // Required — LLM provider
  displayManager: DisplayManagerAdapter,  // Required — UI slot management
  systemPrompt: string,                   // Required — system instructions
  maxRetries?: number,                    // Tool retry limit (default: 3)
  compaction_config: {                    // Required
    compaction_instructions: string,      // Summarization prompt
    max_turns?: number,                   // Turn limit (default: 120)
    compaction_context_limit?: number,    // Token threshold (default: 100k)
  },
})
  .fold<I>(toolArgs)          // Register tool (chainable)
  .addSubscriber(subscriber)  // Add event subscriber (chainable)
  .build();                   // Returns IGloveRunnable

await agent.processRequest("Hello", abortSignal?);  // Also accepts ContentPart[]
agent.setModel(newModelAdapter);  // Hot-swap model at runtime
```

### GloveFoldArgs<I>

```typescript
{
  name: string,
  description: string,
  inputSchema: z.ZodType<I>,
  requiresPermission?: boolean,
  unAbortable?: boolean,          // When true, tool runs to completion even if abort signal fires (e.g. voice barge-in)
  do: (input: I, display: DisplayManagerAdapter) => Promise<ToolResultData>,
}
```

### DisplayManager

```typescript
import { Displaymanager } from "glove-core";

const dm = new Displaymanager();
dm.subscribe((stack) => { /* stack changed */ });  // Returns unsubscribe fn

// Non-blocking — returns slot ID
const slotId = await dm.pushAndForget({ renderer?: string, input: data });

// Blocking — returns resolved value
const result = await dm.pushAndWait({ renderer?: string, input: data });

dm.resolve(slotId, value);     // Unblock pushAndWait
dm.reject(slotId, error);      // Reject pushAndWait
dm.removeSlot(slotId);         // Remove from stack
await dm.clearStack();         // Clear all slots
```

### StoreAdapter Interface

```typescript
interface StoreAdapter {
  identifier: string;
  getMessages(): Promise<Message[]>;
  appendMessages(msgs: Message[]): Promise<void>;
  getTokenCount(): Promise<number>;
  addTokens(count: number): Promise<void>;
  getTurnCount(): Promise<number>;
  incrementTurn(): Promise<void>;
  resetCounters(): Promise<void>;  // Reset token/turn counts without deleting messages
  // Optional — enables built-in task tool when present:
  getTasks?(): Promise<Task[]>;
  addTasks?(tasks: Task[]): Promise<void>;
  updateTask?(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>): Promise<void>;
  // Optional — enables permission system:
  getPermission?(toolName: string): Promise<PermissionStatus>;
  setPermission?(toolName: string, status: PermissionStatus): Promise<void>;
}
```

**Implementations**: `SqliteStore` (glove-core), `MemoryStore` (glove-react), `createRemoteStore` (glove-react)

### SqliteStore

```typescript
import { SqliteStore } from "glove-core";

const store = new SqliteStore({ dbPath: ":memory:", sessionId: "abc123" });
// Additional methods: getName(), setName(), getWorkingDir(), setWorkingDir(), close()
// Static: SqliteStore.listSessions(dbPath)
```

### ModelAdapter Interface

```typescript
interface ModelAdapter {
  name: string;
  prompt(request: PromptRequest, notify: NotifySubscribersFunction, signal?: AbortSignal): Promise<ModelPromptResult>;
  setSystemPrompt(systemPrompt: string): void;
}
```

**Built-in adapters**: `AnthropicAdapter`, `OpenAICompatAdapter`, `OpenRouterAdapter`

### createAdapter (Provider Factory)

```typescript
import { createAdapter, getAvailableProviders } from "glove-core/models/providers";

const model = createAdapter({
  provider: "anthropic",         // openai | anthropic | openrouter | gemini | minimax | kimi | glm
  model?: "claude-sonnet-4-20250514",
  apiKey?: string,               // Defaults to env var
  maxTokens?: number,
  stream?: boolean,              // Default: true
});

const available = getAvailableProviders();
// [{ id, name, available, models, defaultModel }]
```

### SubscriberAdapter

```typescript
interface SubscriberAdapter {
  record(event_type: string, data: any): Promise<void>;
}
```

**Events emitted:**

| Event | Data | When |
|-------|------|------|
| `text_delta` | `{ text: string }` | Streaming text chunk |
| `tool_use` | `{ id, name, input }` | Tool call started |
| `tool_use_result` | `{ tool_name, call_id?, result }` | Tool finished |
| `model_response` | `{ text, tool_calls }` | Non-streaming turn complete |
| `model_response_complete` | `{ text, tool_calls }` | Streaming turn complete |

### Message

```typescript
interface Message {
  sender: "user" | "agent";
  id?: string;
  text: string;
  content?: ContentPart[];
  tool_results?: ToolResult[];
  tool_calls?: ToolCall[];
  is_compaction?: boolean;  // true for compaction summary messages
}
```

### Core Types

```typescript
interface ToolCall { tool_name: string; input_args: unknown; id?: string; }
interface ToolResult { tool_name: string; call_id?: string; result: ToolResultData; }
interface Task { id: string; content: string; activeForm: string; status: "pending" | "in_progress" | "completed"; }
type PermissionStatus = "granted" | "denied" | "unset";
```

### ToolResultData

```typescript
interface ToolResultData {
  status: "success" | "error";
  data: unknown;          // Sent to the AI model
  message?: string;       // Error message (for status: "error")
  renderData?: unknown;   // Client-only — NOT sent to model, used by renderResult
}
```

**Note:** Model adapters (Anthropic, OpenAI-compat) explicitly destructure and only send `data`, `status`, and `message` to the API. `renderData` is preserved in the store for client-side rendering but never reaches the AI.

### Built-in Task Tool

Auto-registered when store has `getTasks` and `addTasks`:

```typescript
import { createTaskTool } from "glove-core";
const taskTool = createTaskTool(context); // name: "glove_update_tasks"
```

### AbortError

```typescript
import { AbortError } from "glove-core";
try { await agent.processRequest("Hello", signal); }
catch (err) { if (err instanceof AbortError) { /* cancelled */ } }
```

---

## glove-react

### GloveClient

```typescript
import { GloveClient } from "glove-react";

const client = new GloveClient({
  endpoint?: string,                       // Chat endpoint URL
  createModel?: () => ModelAdapter,        // Custom model factory (overrides endpoint)
  createStore?: (sessionId: string) => StoreAdapter,  // Custom store factory
  systemPrompt?: string,
  tools?: ToolConfig[],
  compaction?: CompactionConfig,
  subscribers?: SubscriberAdapter[],
});
```

### GloveProvider

```tsx
import { GloveProvider } from "glove-react";
<GloveProvider client={gloveClient}>{children}</GloveProvider>
```

### useGlove

```typescript
const {
  busy, timeline, streamingText, tasks, slots, stats,
  sendMessage, abort, renderSlot, renderToolResult, resolveSlot, rejectSlot,
} = useGlove(config?: UseGloveConfig);
```

`UseGloveConfig` fields (all optional overrides): `endpoint`, `sessionId`, `store`, `model`, `systemPrompt`, `tools`, `compaction`, `subscribers`

### GloveHandle

The interface consumed by `<Render>`, returned by `useGlove()`:

```typescript
interface GloveHandle {
  timeline: TimelineEntry[];
  streamingText: string;
  busy: boolean;
  slots: EnhancedSlot[];
  sendMessage: (text: string, images?: { data: string; media_type: string }[]) => void;
  abort: () => void;
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  renderToolResult: (entry: ToolEntry) => ReactNode;
  resolveSlot: (slotId: string, value: unknown) => void;
  rejectSlot: (slotId: string, reason?: string) => void;
}
```

### ToolConfig

```typescript
interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  do: (input: I, display: ToolDisplay) => Promise<ToolResultData>;
  render?: (props: SlotRenderProps) => ReactNode;
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean;
}
```

### defineTool

Type-safe tool definition helper with colocated renderers. Preferred over raw `ToolConfig` for tools with display UI.

```typescript
import { defineTool } from "glove-react";

const tool = defineTool<I, D, R>({
  name: string,
  description: string,
  inputSchema: I,                          // z.ZodType — tool input schema
  displayPropsSchema?: D,                  // z.ZodType — display props schema (recommended for tools with UI)
  resolveSchema?: R,                       // z.ZodType — resolve value schema (default: z.ZodVoid)
  displayStrategy?: SlotDisplayStrategy,
  requiresPermission?: boolean,
  unAbortable?: boolean,                   // Tool runs to completion even if abort signal fires
  do(input: z.infer<I>, display: TypedDisplay<z.infer<D>, z.infer<R>>): Promise<ToolResultData>,
  render?({ props, resolve, reject }): ReactNode,
  renderResult?({ data, output, status }): ReactNode,
});
```

**Notes:**
- Returns a `ToolConfig` — compatible with `GloveClient.tools` and `useGlove` config
- `do()` receives a `TypedDisplay` with typed `pushAndWait`/`pushAndForget`
- `render()` receives typed `props` (from displayPropsSchema) and typed `resolve` (from resolveSchema)
- `renderResult()` receives `renderData` from the tool result for history rendering
- Raw return values from `do()` are auto-wrapped into `{ status: "success", data: value }`
- `displayPropsSchema` is optional but recommended — use raw `ToolConfig` for tools without display

### unAbortable Tools

When `unAbortable: true` is set on a tool, glove-core guarantees the tool runs to completion even if the abort signal fires (e.g. from voice barge-in or manual `interrupt()`). This is essential for tools that perform mutations the user has already committed to, like checkout forms.

**How it works (two layers):**

1. **Core layer** (`Agent.executeTools`): When the abort signal fires, abortable tools are skipped with `{ status: "aborted" }`. But if `tool.unAbortable` is `true`, the tool executes normally — no `abortablePromise` wrapper, retries still allowed.

2. **Voice layer** (`GloveVoice.interrupt`): Before clearing display slots, checks `displayManager.resolverStore.size > 0`. If a `pushAndWait` resolver is pending (the form is open), barge-in is suppressed entirely — `interrupt()` is never called. This prevents the abort signal from firing in the first place.

**Important distinction:** `pushAndWait` alone does NOT make a tool survive barge-in. It only suppresses the barge-in trigger at the voice layer. If `interrupt()` is called through other means (e.g. programmatically), only `unAbortable: true` guarantees the tool runs to completion. Use both together for full protection.

```typescript
const checkout = defineTool({
  name: "checkout",
  unAbortable: true,           // Survives abort signals
  displayStrategy: "hide-on-complete",
  async do(input, display) {
    const result = await display.pushAndWait({ items });  // Resolver suppresses voice barge-in
    if (!result) return "Cancelled";
    // Mutation happens here — safe because unAbortable guarantees completion
    cartOps.clear();
    return "Order placed!";
  },
});
```

### TypedDisplay

Typed display adapter provided to `defineTool`'s `do()` function:

```typescript
interface TypedDisplay<D, R = void> {
  pushAndWait: (input: D) => Promise<R>;
  pushAndForget: (input: D) => Promise<string>;
}
```

### ToolDisplay

Untyped display adapter provided to raw `ToolConfig`'s `do()` function:

```typescript
interface ToolDisplay {
  pushAndWait: <I, O = unknown>(slot: { renderer?: string; input: I }) => Promise<O>;
  pushAndForget: <I>(slot: { renderer?: string; input: I }) => Promise<string>;
}
```

### SlotRenderProps

```typescript
interface SlotRenderProps<T = any> {
  data: T;
  resolve: (value: unknown) => void;
  reject: (reason?: string) => void;
}
```

### ToolResultRenderProps

```typescript
interface ToolResultRenderProps<T = any> {
  data: T;            // The renderData from ToolResultData
  output?: string;    // The string output of the tool
  status: "success" | "error";
}
```

### SlotDisplayStrategy

```typescript
type SlotDisplayStrategy = "stay" | "hide-on-complete" | "hide-on-new";
```

| Strategy | Behavior |
|----------|----------|
| `"stay"` | Slot always visible (default) |
| `"hide-on-complete"` | Hidden when slot is resolved/rejected |
| `"hide-on-new"` | Hidden when a newer slot from the same tool appears |

### EnhancedSlot

```typescript
interface EnhancedSlot extends Slot<unknown> {
  toolName: string;
  toolCallId: string;
  createdAt: number;
  displayStrategy: SlotDisplayStrategy;
  status: "pending" | "resolved" | "rejected";
}
```

### TimelineEntry / ToolEntry

```typescript
type TimelineEntry =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "agent_text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "success" | "error"; output?: string; renderData?: unknown };

type ToolEntry = Extract<TimelineEntry, { kind: "tool" }>;
```

### Render Component

Headless render component for chat UIs:

```tsx
import { Render } from "glove-react";

interface RenderProps {
  glove: GloveHandle;                                              // Required
  strategy?: RenderStrategy;                                       // Default: "interleaved"
  renderMessage?: (props: MessageRenderProps) => ReactNode;
  renderToolStatus?: (props: ToolStatusRenderProps) => ReactNode;  // Default: hidden
  renderStreaming?: (props: StreamingRenderProps) => ReactNode;
  renderInput?: (props: InputRenderProps) => ReactNode;
  renderSlotContainer?: (props: SlotContainerRenderProps) => ReactNode;
  as?: keyof JSX.IntrinsicElements;                                // Default: "div"
  className?: string;
  style?: CSSProperties;
}
```

**Render prop interfaces:**

```typescript
interface MessageRenderProps {
  entry: Extract<TimelineEntry, { kind: "user" | "agent_text" }>;
  index: number;
  isLast: boolean;
}

interface ToolStatusRenderProps {
  entry: ToolEntry;
  index: number;
  hasSlot: boolean;   // true if this tool has an active or result slot
}

interface StreamingRenderProps { text: string; }

interface InputRenderProps {
  send: (text: string, images?: { data: string; media_type: string }[]) => void;
  busy: boolean;
  abort: () => void;
}

interface SlotContainerRenderProps {
  slots: EnhancedSlot[];
  renderSlot: (slot: EnhancedSlot) => ReactNode;
}

type RenderStrategy = "interleaved" | "slots-before" | "slots-after" | "slots-only";
```

**Features:**
- Automatic slot visibility filtering based on `displayStrategy`
- Automatic `renderResult` rendering for completed tools with `renderData`
- Interleaving: slots appear inline next to their tool call entry
- Sensible defaults for all render props (messages as divs, hidden tool status, basic input form)

### MemoryStore

```typescript
import { MemoryStore } from "glove-react";
const store = new MemoryStore("session-id");
```

### createRemoteStore

```typescript
import { createRemoteStore } from "glove-react";
const store = createRemoteStore("session-id", {
  getMessages: async (sid) => fetch(`/api/${sid}/messages`).then(r => r.json()),
  appendMessages: async (sid, msgs) => fetch(`/api/${sid}/messages`, { method: "POST", body: JSON.stringify(msgs) }),
  // Optional: getTokenCount, addTokens, getTurnCount, incrementTurn, resetCounters, getTasks, addTasks, updateTask, getPermission, setPermission
});
```

### createRemoteModel

```typescript
import { createRemoteModel } from "glove-react";
const model = createRemoteModel("custom", {
  prompt: async (request, signal?) => { /* return { message, tokens_in, tokens_out } */ },
  promptStream?: async function*(request, signal?) { /* yield RemoteStreamEvent */ },
});
```

### createEndpointModel

```typescript
import { createEndpointModel } from "glove-react";
const model = createEndpointModel("/api/chat"); // SSE-based, compatible with glove-next
```

### parseSSEStream

```typescript
import { parseSSEStream } from "glove-react";
for await (const event of parseSSEStream(response)) { /* RemoteStreamEvent */ }
```

---

## glove-next

### createChatHandler

```typescript
import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: string,    // "openai" | "anthropic" | "openrouter" | "gemini" | "minimax" | "kimi" | "glm"
  model?: string,      // Defaults to provider default
  apiKey?: string,     // Defaults to env var
  maxTokens?: number,
});
```

Returns `(req: Request) => Promise<Response>` — compatible with Next.js App Router route handlers.

**SSE Protocol**: Streams `RemoteStreamEvent` objects as `data:` lines:

```typescript
type RemoteStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "done"; message: Message; tokens_in: number; tokens_out: number };
```

---

## glove-voice

### GloveVoice Class

```typescript
import { GloveVoice } from "glove-voice";

const voice = new GloveVoice(gloveRunnable, {
  stt: STTAdapter,                    // Required — streaming STT adapter
  createTTS: () => TTSAdapter,        // Required — factory, called per turn
  turnMode?: "vad" | "manual",       // Default: "vad"
  vad?: VADAdapter,                   // Override default VAD (only used in "vad" mode)
  vadConfig?: VADConfig,              // Built-in VAD config (only used if no custom vad)
  sampleRate?: number,                // Default: 16000
});

// Events
voice.on("mode", (mode: VoiceMode) => { });
voice.on("transcript", (text: string, partial: boolean) => { });
voice.on("response", (text: string) => { });
voice.on("error", (err: Error) => { });
voice.on("audio_chunk", (pcm: Int16Array) => { });  // Raw mic PCM — emitted even when muted

// Lifecycle
await voice.start();       // Request mic, connect STT, begin listening
await voice.stop();        // Stop everything, release resources
voice.interrupt();         // Barge-in: abort request, stop TTS, return to listening
voice.commitTurn();        // Manual turn commit: flush utterance to STT

// Narration — speak text through TTS without involving the model
await voice.narrate("Here is your order summary.");  // Resolves when audio finishes

// Mic control — gate audio forwarding to STT/VAD
voice.mute();              // Stop forwarding audio to STT/VAD (audio_chunk still emitted)
voice.unmute();            // Resume forwarding audio to STT/VAD

// Properties
voice.currentMode;         // VoiceMode
voice.isActive;            // boolean
voice.isMuted;             // boolean
```

### Types

```typescript
type VoiceMode = "idle" | "listening" | "thinking" | "speaking";
type TurnMode = "vad" | "manual";
type TTSFactory = () => TTSAdapter;
type GetTokenFn = () => Promise<string>;
```

### Adapter Contracts

```typescript
// STT — Streaming speech-to-text
interface STTAdapter extends EventEmitter<STTAdapterEvents> {
  connect(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  flushUtterance(): void;
  disconnect(): void;
  readonly isConnected: boolean;
  readonly currentPartial: string;
}
// Events: partial(text), final(text), error(Error), close()

// TTS — Streaming text-to-speech
interface TTSAdapter extends EventEmitter<TTSAdapterEvents> {
  open(): Promise<void>;
  sendText(text: string): void;
  flush(): void;
  destroy(): void;
  readonly isReady: boolean;
}
// Events: audio_chunk(Uint8Array), done(), error(Error)

// VAD — Voice activity detection
interface VADAdapter extends EventEmitter<VADAdapterEvents> {
  process(pcm: Int16Array): void;
  reset(): void;
  readonly isSpeaking: boolean;
}
// Events: speech_start(), speech_end()
```

### ElevenLabs Adapters

```typescript
import { createElevenLabsAdapters } from "glove-voice";

const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: GetTokenFn,           // Fetches token from your server
  getTTSToken: GetTokenFn,           // Fetches token from your server
  voiceId: string,                   // ElevenLabs voice ID
  stt?: {                            // Override STT options
    model?: string,                  // Default: "scribe_v2_realtime"
    language?: string,               // Default: "en"
    vadSilenceThreshold?: number,    // Default: 0 (we manage VAD ourselves)
    maxReconnects?: number,          // Default: 3
  },
  tts?: {                            // Override TTS options
    model?: string,                  // Default: "eleven_turbo_v2_5"
    outputFormat?: string,           // Default: "pcm_16000"
    voiceSettings?: { stability?: number; similarityBoost?: number; speed?: number },
  },
});
```

### SileroVADAdapter

```typescript
// MUST use dynamic import — separate entry point to avoid WASM in SSR bundle
const { SileroVADAdapter } = await import("glove-voice/silero-vad");

const vad = new SileroVADAdapter({
  positiveSpeechThreshold?: number,  // Default: 0.3 (higher = less sensitive)
  negativeSpeechThreshold?: number,  // Default: 0.25 (lower = needs more silence)
  wasm?: { type: "cdn" } | { type: "local"; path: string },
});
await vad.init();
```

### Built-in VAD (energy-based)

```typescript
import { VAD } from "glove-voice";
const vad = new VAD({ silentFrames?: number }); // Default: 15 (~600ms). GloveVoice overrides to 40 (~1600ms).
```

### createVoiceTokenHandler (glove-next)

```typescript
import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({
  provider: "elevenlabs" | "deepgram" | "cartesia",
  type?: "stt" | "tts",       // Required for elevenlabs
  apiKey?: string,             // Defaults to env var
});
```

### useGloveVoice (glove-react/voice)

```typescript
import { useGloveVoice } from "glove-react/voice";

const voice = useGloveVoice({
  runnable: IGloveRunnable | null,   // From useGlove().runnable
  voice: GloveVoiceConfig,           // STT, TTS factory, turn mode, VAD
});

// Returns:
voice.mode;          // VoiceMode
voice.transcript;    // string — partial transcript while speaking
voice.isActive;      // boolean
voice.isMuted;       // boolean — whether mic audio is muted
voice.error;         // Error | null
voice.start();       // () => Promise<void>
voice.stop();        // () => Promise<void>
voice.interrupt();   // () => void
voice.commitTurn();  // () => void
voice.mute();        // () => void — stop forwarding mic to STT/VAD
voice.unmute();      // () => void — resume forwarding mic to STT/VAD
voice.narrate(text); // (text: string) => Promise<void> — speak without model
```

---

## Browser-Safe Import Paths

The main `glove-core` barrel includes native deps (better-sqlite3). For browser code, use subpath imports:

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
