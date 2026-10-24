# Hooks, skills and subagents

> Read when adding `/command` hooks, `/skill` injections or content skills the agent reads on demand, or subagents the agent routes work to through `glove_invoke_subagent`.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Extensions: Hooks, Skills & Subagents

`processRequest` parses two kinds of inline directive out of the user text and dispatches them before the model is called. Subagents are a third extension surface, but they are NOT parsed from user text — they are routed by the model through a dispatch tool. Builders register handlers via three builder methods (chainable, callable post-`build()` like `fold`):

| Token / mechanism | Purpose | Builder method |
|-------|---------|----------------|
| `/hookname` | Mutate agent state, force compaction, swap model, short-circuit a turn | `defineHook(name, handler)` |
| `/skillname` | Inject context as a synthetic user message marked `is_skill_injection: true` | `defineSkill({ name, handler, description?, exposeToAgent? })` |
| `glove_invoke_subagent({ name, prompt })` (model-side tool) | Register a child Glove the main agent can route a self-contained task to. The user's `@name` text reaches the model verbatim — it's a routing signal, not a parsed directive. Mirrors Claude Code's subagent convention. | `defineSubAgent({ name, factory, description? })` |

`/` tokens only bind when the name matches a registered hook or skill — `/usr/local/bin` survives untouched. Bound `/` tokens are **replaced**, not stripped, with a non-triggerable placeholder of the form `[invoked_extension__hook_<name>]` or `[invoked_extension__skill_<name>]`. The placeholder doesn't re-bind on a future parse, but it keeps the persisted user message structurally honest — the model can see that an extension fired. `@` tokens are never parsed by glove at all, so emails like `a@b.com` reach the model unchanged.

### Quick example

```typescript
import { Glove, MemoryStore } from "glove-core";

const agent = new Glove({ /* ... */ })
  .defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  })
  .defineHook("stop", async () => ({
    shortCircuit: { message: { sender: "agent", text: "Cancelled." } },
  }))
  .defineSkill({
    name: "concise",
    description: "Tighter, snappier responses",
    exposeToAgent: true,
    handler: async ({ source, args }) =>
      `Be terse. (source=${source}, hint=${args ?? "none"})`,
  })
  .defineSubAgent({
    name: "weather",
    description: "Run the weather subagent. Use for weather questions.",
    factory: async ({ parentStore, parentControls, prompt }) => {
      const subStore = await parentStore.createSubAgentStore?.("weather", false)
        ?? new MemoryStore(`weather_${Date.now()}`);
      return new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        systemPrompt: "You are a weather assistant. Answer the prompt and return.",
        compaction_config: { compaction_instructions: "Summarise weather lookups." },
      })
        .fold(weatherTool)
        .build();
    },
  })
  .build();

await agent.processRequest("/concise tell me about Rust");      // user-invoked skill
await agent.processRequest("/compact what's next?");           // hook → forceCompaction
// "@weather" reaches the model verbatim. The agent calls
// glove_invoke_subagent({ name: "weather", prompt: "NYC" }).
await agent.processRequest("@weather NYC");
```

### Hooks

```typescript
type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookContext {
  name: string;
  rawText: string;
  parsedText: string;        // text with bound tokens replaced by [invoked_extension__<type>_<name>] placeholders
  controls: AgentControls;
  signal?: AbortSignal;
}

interface HookResult {
  rewriteText?: string;      // override parsedText for downstream skills + the user message
  shortCircuit?:
    | { message: Message }
    | { result: ModelPromptResult };
}

interface AgentControls {
  context: Context;
  observer: Observer;
  promptMachine: PromptMachine;
  executor: Executor;
  glove: IGloveRunnable;
  store: StoreAdapter;             // direct access to the agent's StoreAdapter
  displayManager: DisplayManagerAdapter;  // direct access to the agent's display stack
  forceCompaction: () => Promise<void>;
}
```

`forceCompaction` calls `Observer.runCompactionNow()` — same body as `tryCompaction` minus the token-threshold guard. Subscribers still see `compaction_start` / `compaction_end`.

Hooks run in document order. `rewriteText` overrides the working text passed to subsequent hooks, skills, and the final user message. `shortCircuit` persists the user message and returns immediately — the model is not called. Glove emits `hook_invoked` (`{ name }`) on subscribers just before each hook handler runs.

### Skills

```typescript
type SkillHandler = (ctx: SkillContext) => Promise<string | ContentPart[]>;

interface SkillContext {
  name: string;
  parsedText: string;        // when source = "user": user text with bound directives replaced by their placeholders. when source = "agent": same as args ?? "".
  args?: string;             // model-supplied free-form args (only when source = "agent")
  source: "user" | "agent";
  controls: AgentControls;
}

interface SkillOptions {
  description?: string;       // shown to the agent in the invoke-skill tool listing
  exposeToAgent?: boolean;    // default false
}

interface DefineSkillArgs extends SkillOptions {
  name: string;
  handler: SkillHandler;
}

interface RegisteredSkill {
  handler: SkillHandler;
  description?: string;
  exposeToAgent: boolean;
}
```

Skill-injected messages set `is_skill_injection: true` on `Message`, alongside the existing `is_compaction` and `is_compaction_request` flags. Use it in transcript renderers to render injected context differently from real user turns. Glove emits `skill_invoked` (`{ name, source: "user" | "agent", args? }`) on subscribers — for user-side directives, the dispatch fires from `Glove.processRequest`; for agent-side calls, it fires from inside the `glove_invoke_skill` tool.

#### Exposing skills to the agent

Set `exposeToAgent: true` and Glove auto-registers a single `glove_invoke_skill` tool on the executor. Its description lists every exposed skill (`- name — description`) and is rebuilt in place each time a new exposed skill is defined, so post-`build()` registrations are picked up immediately.

```typescript
agent.defineSkill({
  name: "research-mode",
  description: "Switch to long-form research mode with citations",
  exposeToAgent: true,
  handler: async ({ source, args, parsedText }) => {
    if (source === "agent") {
      // Agent invoked via glove_invoke_skill — `args` is the model-supplied string.
      return `Switch into research mode. Focus: ${args ?? "general"}.`;
    }
    // source === "user" — `parsedText` is the user message after directive substitution
    // (e.g. "[invoked_extension__skill_research-mode] tell me about ribosomes").
    return `Switch into research mode. User said: ${parsedText}`;
  },
});

// User: "/research-mode tell me about ribosomes"
//   → source = "user", parsedText = "[invoked_extension__skill_research-mode] tell me about ribosomes"
// Agent: glove_invoke_skill({ name: "research-mode", args: "ribosome assembly" })
//   → source = "agent", args = "ribosome assembly"
```

The tool returns `{ status: "success", data: { skill, content } }` on success and `{ status: "error", message: 'Skill "..." is not available', data: null }` for unknown or unexposed names. When the skill returns `ContentPart[]`, text parts are joined into `data.content` (visible to the model) and the full part list is preserved on `renderData` (visible to client renderers, mirroring the MCP-bridge convention).

| Aspect | User `/skill` | Agent `glove_invoke_skill` |
|--------|--------------|----------------------------|
| Where it lands | Synthetic user message before the real turn (`is_skill_injection: true`) | Tool result on the agent's tool_use |
| `SkillContext.source` | `"user"` | `"agent"` |
| `SkillContext.args` | undefined | free-form string the model supplied |
| Gated by `exposeToAgent` | No — user-invoked always works | Yes — only exposed skills are callable |

### Subagents

Modelled on Claude Code's subagent convention. Defining one auto-registers a `glove_invoke_subagent` tool (constant `SUBAGENT_DISPATCH_TOOL_NAME` exported from core) the main agent calls with `{ name, prompt }`. The user's `@name` text in the original message is **not** parsed by glove — it reaches the model verbatim and acts as a routing signal. The factory builds a fresh child `Glove` for each invocation and the dispatcher runs it.

```typescript
interface SubAgentFactoryContext {
  /** Subagent name as registered with `defineSubAgent`. */
  name: string;
  /** The task prompt the parent agent supplied when calling `glove_invoke_subagent`. */
  prompt: string;
  /** The parent agent's store. Use `createSubAgentStore(name, durable)` to derive a child store. */
  parentStore: StoreAdapter;
  /** Full parent agent controls (context, observer, promptMachine, executor, glove, store, displayManager, forceCompaction). */
  parentControls: AgentControls;
}

type SubAgentFactory = (
  ctx: SubAgentFactoryContext,
) => Promise<IGloveRunnable> | IGloveRunnable;

interface SubAgentOptions {
  /** Short description shown to the agent in the invoke-subagent tool listing. */
  description?: string;
}

interface DefineSubAgentArgs extends SubAgentOptions {
  name: string;
  factory: SubAgentFactory;
}

interface RegisteredSubAgent {
  factory: SubAgentFactory;
  description?: string;
}
```

#### Canonical factory

```typescript
import { Glove, MemoryStore } from "glove-core";

glove.defineSubAgent({
  name: "researcher",
  description: "Deep research subagent",
  factory: async ({ parentStore, parentControls }) => {
    // Sub-store: durable false → fresh per-call; durable true → cached for the namespace.
    const subStore = await parentStore.createSubAgentStore?.("researcher", false)
      ?? new MemoryStore(`researcher_${Date.now()}`);

    return new Glove({
      store: subStore,
      model: parentControls.glove.model,           // inherit the parent's model
      displayManager: parentControls.displayManager, // share the parent's display stack
      systemPrompt: "You are a researcher.",
      compaction_config: { compaction_instructions: "Summarize research progress." },
    })
      .fold(searchTool)
      .fold(fetchTool)
      .build();   // build() can take a store too; passing it here is equivalent to constructor `store`
  },
});
```

The dispatcher attaches the parent's subscribers to the child for the run, calls `child.processRequest(prompt, signal)` (forwarding the parent's abort signal), then detaches them. The child's final agent text is returned as the tool result.

#### Tool result shape

Symmetric with `glove_invoke_skill`:

```typescript
// Tool input
{ name: string, prompt: string }

// Success
{ status: "success", data: { subagent: string, content: string } }

// Unknown name
{ status: "error", message: 'Subagent "..." is not registered. Use one of: ...', data: null }

// Factory threw
{ status: "error", message: 'Subagent "..." factory threw: ...', data: null }

// Child run threw
{ status: "error", message: 'Subagent "..." failed: ...', data: null }
```

#### Bracket events — guaranteed 1:1 symmetry

The `Executor` (not the dispatcher) brackets every `glove_invoke_subagent` call with `subagent_invoked` (`{ name, prompt }`) before the run and `subagent_completed` (`{ name, status: "success" | "error", message? }`) after. The bracket is symmetric even when a parent abort short-circuits the dispatcher's promise chain: the executor's abort handler still fires the close bracket. Events emitted by the child Glove between them belong to that subagent — parent subscribers are attached to the child for the duration of the run.

#### Common patterns

- **Fresh child per call**: factory builds a new `Glove` each invocation, with its own `MemoryStore` (or a non-durable sub-store). Default and recommended.
- **Durable child**: `parentStore.createSubAgentStore("name", true)` returns the same store for the namespace, so the subagent carries message history across invocations. The factory still builds a fresh `Glove`; only the store is reused.
- **Multiple in one message** (`"@reviewer @architect please discuss this design"`): both names reach the model, which can call `glove_invoke_subagent` once per subagent (sequentially or in parallel via separate tool calls — its choice).

### Sub-stores: `createSubAgentStore`

`StoreAdapter` exposes an optional `createSubAgentStore(namespace: string, durable?: boolean): Promise<StoreAdapter>` factory:

- `durable: false` (default) → a fresh, isolated store per call. The subagent starts from zero context every invocation.
- `durable: true` → the same instance is returned for the same namespace, so the subagent retains messages, tasks, tokens, and counters across invocations within the parent's lifetime.

`MemoryStore` from `glove-core` implements both modes. If your store doesn't implement `createSubAgentStore`, fall back to `new MemoryStore(...)` inside the factory — that preserves the "fresh per call" behavior.

### `setDisplayManager` (chainable)

`Glove` (both builder and runnable forms) exposes `setDisplayManager(displayManager)`. Subagent factories typically pass `parentControls.displayManager` into the child's constructor, but they can also opt in mid-flight by calling `child.setDisplayManager(parentControls.displayManager)` after build. Returns `this` for chaining.

### Dispatch order in `processRequest`

1. Parse `/` directives from the raw text (regex `(^|\s)\/([A-Za-z][\w-]*)(?=\s|$)`). Bound tokens are **replaced** with `[invoked_extension__<type>_<name>]` placeholders; unbound tokens stay in place. `@` tokens are not parsed at all.
2. Run hooks in document order. Glove emits `hook_invoked` per hook. Apply any `rewriteText`; honour the first `shortCircuit` and return.
3. Materialise skills (`source: "user"`) — each becomes a synthetic user message persisted via `context.appendMessages` before the real one. Glove emits `skill_invoked` per skill.
4. Build the real user `Message` from the placeholder-substituted text (still contains any `@mention`s untouched) + any non-text `ContentPart`s the caller passed.
5. Hand off to `Agent.ask`. Subagent invocations happen inside the agent loop via `glove_invoke_subagent` tool calls; the executor brackets each one with `subagent_invoked` / `subagent_completed`.

### `is_skill_injection` flag

Skill-materialised user messages set `is_skill_injection: true` on `Message`. Pair it with `is_compaction` for transcript rendering — collapse, mute, or filter injected messages so they're visually distinct from real user turns.

### `pre_modified_text` on Message

When a hook rewrites the user message via `rewriteText`, the original raw text is preserved on `Message.pre_modified_text` so frontends can render what the user actually typed alongside the rewritten version the model received.

### Public API surface

```typescript
import {
  // Builder
  Glove, // .defineHook(), .defineSkill(), .defineSubAgent()
  // Types
  HookHandler, HookContext, HookResult,
  SkillHandler, SkillContext, SkillOptions, DefineSkillArgs, RegisteredSkill,
  SubAgentFactory, SubAgentFactoryContext, SubAgentOptions, DefineSubAgentArgs, RegisteredSubAgent,
  AgentControls,
  // Constants
  SUBAGENT_DISPATCH_TOOL_NAME, // "glove_invoke_subagent"
  // Helpers
  parseTokens, formatSkillMessage,
  createSkillInvokeTool, renderSkillToolDescription,
  createSubAgentInvokeTool, renderSubAgentToolDescription,
} from "glove-core";
```

Available at the main entry and the `glove-core/extensions` subpath.
