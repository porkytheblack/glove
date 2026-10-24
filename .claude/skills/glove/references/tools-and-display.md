# Tools and the display stack

> Read when defining tools (`fold`, `ToolConfig`, `defineTool`), returning `ToolResultData`/`renderData`, adding tool result summaries, or rendering UI from tools with `pushAndForget` / `pushAndWait` and display strategies.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Display Stack Patterns

### pushAndForget — Show results (non-blocking)

```tsx
async do(input, display) {
  const data = await fetchData(input);
  await display.pushAndForget({ input: data }); // Shows UI, tool continues
  return { status: "success", data: "Displayed results", renderData: data };
},
render({ data }) {
  return <Card>{data.title}</Card>;
},
renderResult({ data }) {
  return <Card>{(data as any).title}</Card>;  // Same card from history
},
```

### pushAndWait — Collect user input (blocking)

```tsx
async do(input, display) {
  const confirmed = await display.pushAndWait({ input }); // Pauses until user responds
  return {
    status: "success",
    data: confirmed ? "Confirmed" : "Cancelled",
    renderData: { confirmed },
  };
},
render({ data, resolve }) {
  return (
    <div>
      <p>{data.message}</p>
      <button onClick={() => resolve(true)}>Yes</button>
      <button onClick={() => resolve(false)}>No</button>
    </div>
  );
},
renderResult({ data }) {
  const { confirmed } = data as { confirmed: boolean };
  return <div>{confirmed ? "Confirmed" : "Cancelled"}</div>;
},
```

### Display Strategies

| Strategy | Behavior | Use for |
|----------|----------|---------|
| `"stay"` (default) | Slot always visible | Info cards, results |
| `"hide-on-complete"` | Hidden when slot is resolved | Forms, confirmations, pickers |
| `"hide-on-new"` | Hidden when newer slot from same tool appears | Cart summaries, status panels |

### SlotRenderProps

| Prop | Type | Description |
|------|------|-------------|
| `data` | `T` | Input passed to pushAndWait/pushAndForget |
| `resolve` | `(value: unknown) => void` | Resolves the slot. For pushAndWait, the value returns to `do`. For pushAndForget, use `resolve()` or `removeSlot(id)` to dismiss. |
| `reject` | `(reason?: string) => void` | Rejects the slot. For pushAndWait, this causes the promise to reject. Use for cancellation flows. |

## Tool Definition

### `defineTool` (recommended for tools with UI)

```typescript
import { defineTool } from "glove-react";

const tool = defineTool({
  name: string,
  description: string,
  inputSchema: z.ZodType,              // Zod schema for tool input
  displayPropsSchema?: z.ZodType,      // Zod schema for display props (recommended for tools with UI)
  resolveSchema?: z.ZodType,           // Zod schema for resolve value (omit for pushAndForget-only)
  displayStrategy?: SlotDisplayStrategy,
  requiresPermission?: boolean | ((input: z.infer<I>) => boolean),  // function form gates per-input (e.g. only writes, not reads)
  unAbortable?: boolean,                 // Tool runs to completion even if abort signal fires (e.g. voice barge-in)
  do(input, display): Promise<ToolResultData>,  // display is TypedDisplay<D, R>
  render?({ props, resolve, reject }): ReactNode,
  renderResult?({ data, output, status }): ReactNode,
});
```

**Key points:**
- `do()` should return `{ status, data, renderData }` — `data` goes to model, `renderData` stays client-only
- `render()` gets typed `props` (matching displayPropsSchema) and typed `resolve` (matching resolveSchema)
- `renderResult()` receives `renderData` for showing read-only views from history
- `displayPropsSchema` is optional but recommended — tools without display should use raw `ToolConfig`

### `ToolConfig` (for tools without UI or manual control)

```typescript
interface ToolConfig<I = any> {
  name: string;
  description: string;
  inputSchema?: z.ZodType<I>;          // Optional now — tools may use jsonSchema instead
  jsonSchema?: Record<string, unknown>; // Raw JSON Schema alternative (used by MCP-bridged tools)
  do: (input: I, display: ToolDisplay) => Promise<ToolResultData>;
  render?: (props: SlotRenderProps) => ReactNode;
  renderResult?: (props: ToolResultRenderProps) => ReactNode;
  displayStrategy?: SlotDisplayStrategy;
  requiresPermission?: boolean | ((input: I) => boolean);  // function form gates per-input
  unAbortable?: boolean;
}
```

**`jsonSchema` vs `inputSchema`:** Pass exactly one. `inputSchema` (Zod) gets local validation before `do()` runs. `jsonSchema` (raw JSON Schema) is forwarded verbatim to the model and the executor skips Zod validation — the source of truth lives elsewhere. Used by `bridgeMcpTool` where the MCP server defines the schema, but you can use it directly when wrapping any external tool catalogue.

### `glove.fold` after `build()`

`fold()` is legal at any time on an `IGloveRunnable`, including after `build()`. The discovery subagent's `activate` tool relies on this — it folds in newly bridged MCP tools mid-conversation so they're available on the next turn. Useful for any "register tools dynamically" pattern.

```typescript
const agent = new Glove({...}).build();
// ...later, mid-conversation:
agent.fold({ name: "new_tool", description: "...", inputSchema: z.object({}), async do() { ... } });
```

### `do(input, display, glove, signal?)` — third and fourth arguments

A tool's `do` function receives the running `IGloveRunnable` as a third argument and the active request's `AbortSignal` as an optional fourth. The `glove` argument is how the `discovermcp` subagent's `activate` tool reaches back to fold bridged MCP tools onto the main agent and inherit its model/displayManager. The `signal` argument should be forwarded into long-running internal work (nested agent runs, fetches) so abort propagates; tools that ignore it still get the executor's abortable-promise unwind for free, and tools marked `unAbortable: true` should ignore `signal` entirely. Most tools ignore both.

### ToolResultData

```typescript
interface ToolResultData {
  status: "success" | "error";
  data: unknown;                 // Sent to the AI model
  message?: string;              // Error message (for status: "error")
  renderData?: unknown;          // Client-only — NOT sent to model, used by renderResult
  summary?: string;              // Populated by the Executor from tool.generateSummary; swapped in for data in older context when enableToolResultSummary is on
  generateSummaryArgs?: unknown; // Opaque payload do() returns to drive the tool's generateSummary handler
}
```

**Important:** Model adapters explicitly strip `renderData` before sending to the AI. This makes it safe to store sensitive client-only data (e.g., email addresses, UI state) in `renderData`.

### Tool result summaries (opt-in)

Token-efficiency optimization for tools whose payloads bloat context (file reads, web fetches, large query results). Off by default; opt in with `enableToolResultSummary: true` on `GloveConfig`, and add `generateToolSummary` to each tool you want to compress.

```typescript
const agent = new Glove({
  store,
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "...",
  compaction_config: { compaction_instructions: "Summarize so far." },
  enableToolResultSummary: true,            // turn on the pruner
})
  .fold({
    name: "read_file",
    description: "Read a slice of a file.",
    inputSchema: z.object({ path: z.string(), from: z.number().optional(), to: z.number().optional() }),
    async do(input) {
      const slice = await readSlice(input);
      return {
        status: "success",
        data: slice,
        generateSummaryArgs: { path: input.path, from: input.from, to: input.to, lineCount: slice.split("\n").length },
      };
    },
    async generateToolSummary(args) {
      const { path, from, to, lineCount } = args as any;
      const range = from != null || to != null ? ` lines ${from ?? 1}-${to ?? "EOF"}` : "";
      return `Read ${path}${range} (${lineCount} lines).`;
    },
  })
  .build();
```

How it works:

1. **`do()` returns `generateSummaryArgs`** — whatever the summary handler needs (path + line range, URL, query, row count).
2. **Executor calls `generateToolSummary(args)`** after `do()` resolves and stores the result on `ToolResultData.summary`. Both `data` and `summary` live on the result.
3. **`PromptMachine.summarizeOlderToolResults`** runs before every model call (when `enableToolResultSummary: true`): finds the latest non-tool user message and, for every tool result at or before that index, swaps `data` → `summary`. Tool results from the current turn are untouched.

The store always keeps both `data` and `summary`. Only the messages handed to the model adapter are rewritten — transcript renderers, history snapshots, and analytics still see the full record.

Tools without `generateToolSummary`, or calls that omit `generateSummaryArgs`, leave `summary` unset and the pruner leaves them alone. Partially instrumented tool catalogues work fine.

Composes with compaction: tool summaries delay the point at which the Observer needs to compact, and compaction still fires when the instrumented context grows past `CONTEXT_COMPACTION_LIMIT`.
