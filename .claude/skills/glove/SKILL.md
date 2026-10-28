---
name: glove
description: Build agent harnesses with Glove's TypeScript primitives instead of hand-rolling them — the agent loop, tools, model adapters, stores, the display stack, runtime context, skills/hooks/subagents, inbox, memory, forms, goals, facts, MCP, JS/Python/Lisp REPLs, scratchpad, VFS, working environments, browsers and sandboxes, classifiers, voice, realtime speech and realtime multimodal sessions, image/video workflows, mesh and continuum. Use whenever code imports glove-* packages, or when building a coding agent, personal assistant, support agent, voice agent, research agent or any other harness in TypeScript. For Foundry systems (instances, schedules, transmissions, approvals, APIs) also use glove-foundry; to deploy, use kuiper.
---

# Glove

Glove is a family of TypeScript packages that give you a **primitive for every part of an agent harness**. A harness is everything around a model that turns it into something that does work: the loop, the tools, what it sees, what it remembers, where it works, how people reach it, and who it works with. Coding agents, personal assistants, support desks and voice agents are all the same parts in different proportions.

Three layers, three skills:

| Layer | Product | Adds | Skill |
| --- | --- | --- | --- |
| **Harness** | Glove (`glove-core` + capability packages) | Loop, Tools, Context, State, Workspace, Surface, Team | this one |
| **System** | Glove Foundry (`glove-foundry`) | Identity, Time, Arrival, Oversight, Access | `glove-foundry` |
| **Production** | Kuiper (kuiper.sh) | Run, Keep, Reach, Watch | `kuiper` |

**The rule that matters most: before writing infrastructure for an agent, find the primitive.** Almost every "I'll just write a quick…" (a job queue, an approval flow, a summariser, a todo tool, a tool router, a webhook dispatcher, a conversation table) already exists. The table below is the check.

Docs: https://glove.dterminal.net/docs · First principles: https://glove.dterminal.net/docs/first-principles · Primitives map: https://glove.dterminal.net/docs/primitives · Condensed reference: https://glove.dterminal.net/llms-full.txt · Source: https://github.com/porkytheblack/glove (MIT)

## The seven parts of a harness

| Part | The question | How Glove answers it |
| --- | --- | --- |
| **Loop** | How does it act? | `glove-core` runs model → tool calls → results → model until it answers, with retries, turn limits, aborts, streaming events and token accounting. |
| **Tools** | What can it do? | A tool is a name, a description, a Zod schema and `do()`. MCP servers, REPLs, classifiers and media pipelines all arrive as tools. |
| **Context** | What does it see? | A stable system prompt, saved history, and live state appended at the tail of every model call. Skills load guidance on demand; compaction keeps long sessions in the window. |
| **State** | What does it remember? | A `StoreAdapter` holds messages, tasks, permissions and an inbox. `glove-memory`, `glove-facts`, forms and goals hold what it learns and what it must finish. |
| **Workspace** | Where does it work? | A virtual filesystem with scripts, checkpoints and format adapters, sandboxed interpreters, and mounted browsers and sandboxes. Work happens in files and code, not in the context window. |
| **Surface** | How do people reach it? | Tools push UI onto a display stack and can wait for the answer. React, Next.js, voice pipelines, realtime speech and avatars read the same agent. |
| **Team** | Who does it work with? | A subagent is a harness used as a tool. Mesh lets agents message each other through their inboxes; Continuum supervises them as processes. |

How one request moves through them:

```text
message ──▶ State (store) ──history──▶ Context (prompt · history · live state) ──prompt──▶ Model
               ▲                                                                            │ tool calls
               └──────────── results ◀── Tools (validated · permission-gated) ◀──────────────┘
Tools can also: render on the Surface (pushAndForget / pushAndWait), act on a Workspace, hand work to a Team (subagent).
Loop ends when the model answers with text.
```

## Before you build it, use this

| If you're about to write… | Use | API | Package |
| --- | --- | --- | --- |
| a while-loop that calls the model, parses tool calls, runs them and appends results | Agent loop | `new Glove({ model, store, displayManager, systemPrompt, compaction_config }).fold(...).build()` then `processRequest(text, signal?)` | `glove-core` |
| provider SDK glue, a streaming parser, tool-call translation per provider | Model adapters | `createAdapter({ provider, model, cache: true, reasoning? })` from `glove-core/models/providers` | `glove-core` |
| teardown/rebuild to switch models or prompts | Hot-swap | `glove.setModel(adapter)` · `glove.setSystemPrompt(text)` (between requests) | `glove-core` |
| cancellation flags threaded through tools | Abort + un-abortable tools | `processRequest(text, signal)` · `fold({ …, unAbortable: true })` | `glove-core` |
| wrappers to stream text, log tool calls, count tokens | Subscribers | `glove.addSubscriber({ async record(type, data) {…} })` | `glove-core` |
| JSON schemas, input validation and a dispatch switch | Tools | `glove.fold({ name, description, inputSchema, do })` | `glove-core` |
| confirm-before-delete logic inside tools | Permission gates | `fold({ …, requiresPermission: true \| (input) => boolean })` | `glove-core` |
| rebuilding the agent when tools change | Runtime tools | `glove.fold(tool)` after build · `glove.replaceTools(previousNames, nextTools)` | `glove-core` |
| truncating big tool results by hand | Tool result summaries | `enableToolResultSummary: true` + `generateToolSummary` + `do()` returning `generateSummaryArgs` | `glove-core` |
| an MCP client and schema bridge | MCP | `await mountMcp(glove, { adapter, entries })` | `glove-mcp` |
| fifty tool definitions and a round-trip per step | Code as the tool surface | `mountJs(glove, { session: JsSession.create() })` (also `mountPy`, `mountLisp`) | `glove-js` · `glove-python` · `glove-lisp` |
| a list/get/search tool per resource | Capabilities as tables | `mountDatabase(glove, { db })` (one `execute_sql` tool) | `glove-scratchpad` |
| a chat-model call per routing/triage decision | Classifiers | `mountClassifier(glove, { classifier: jev() })` · `classifierTool(...)` | `glove-classifier` |
| a one-shot `generate_image` tool | Image/video workflows | `mountImage(glove, { adapter, assets, library })` · `mountVideo(...)` | `glove-image` · `glove-video` |
| rebuilding the system prompt every turn with live state | Runtime context providers | `glove.addContextProvider(() => renderState(), { delivery? })` (`"iteration"` default · `"request"` · `"history"` + `key`) | `glove-core` ≥4 (delivery ≥4.4) |
| webhook handlers or agent replies pushed in as fake user messages | Spontaneous events | `await glove.emitEvent({ id, source, content, whenIdle? })` · `glove.notifyUserActivity()` | `glove-core` ≥4.4 |
| wrapping `processRequest` to prepare state before each turn | Turn preparers | `glove.addTurnPreparer(async () => prepare())` (requests, event wakes and realtime sessions all run them) | `glove-core` ≥4.4 |
| a summariser and history trimming | Compaction | `compaction_config: { compaction_instructions, compaction_context_limit?, max_turns? }` | `glove-core` |
| pasting every playbook into the prompt | Content skills | `useReadSkill(glove, skills)` · `loadContentSkillsFromFs(dir)` (`glove_read_skill`) | `glove-core` |
| parsing `/commands` in your request handler | Hooks and slash skills | `glove.defineHook(name, handler)` · `glove.defineSkill({ name, description, handler, exposeToAgent? })` | `glove-core` |
| a todo/planning tool | Task list | a store with `getTasks`/`addTasks` → built-in `glove_update_tasks` | `glove-core` |
| a preferences block in the system prompt | Pinned context | `useContext(glove, contextAdapter)` | `glove-memory` |
| a conversations table and token accounting | Store | `StoreAdapter` (`MemoryStore` built in; implement your own for durability) | `glove-core` |
| polling/callbacks for work that finishes later | Inbox | built-in `glove_post_to_inbox`; resolve items externally, injected next turn | `glove-core` |
| a vector store and an ad hoc remember tool | Memory | `useMemoryReader` · `useEpisodicReader` · `useResourcesReader` (+ curators) | `glove-memory` |
| a slot-filling state machine | Forms | `defineForm(...)` · `useFormRunner(glove, adapter, { registry })` | `glove-memory/forms` |
| tracking objectives inside the prompt | Goals | `defineGoalProgram(...)` · `useGoalRunner(glove, adapter, config)` | `glove-memory/goals` |
| re-asking things the user already said | Facts | `useFacts(glove, factStore, source)` → `record_fact` | `glove-facts` |
| tools that touch the host filesystem | Virtual filesystem | `mountFs([...])` · `withAccess(fs, policy)` · `inMemoryFs()` · `hostDirectory(dir)` · `cachedRemote(store)` | `glove-vfs` |
| a read/write/run tool set and a code runner | Working environment | `mountWorkingEnvironment(glove, { env: await createWorkingEnvironment({ stdlib, limits }) })` | `glove-working-environment` |
| pdf/docx/xlsx/pptx/media libraries wired into tools | Format adapters | `stdlib: [documents(), spreadsheets(), slides(), images(), media(), render(), fetchFiles(), secret()]` | `glove-env-*` |
| Playwright wrapped in click/type tools | Browsers | `mountBrowser(glove, { adapter })` → `execute_browser` | `glove-execution` |
| docker exec wrappers and container bookkeeping | Sandboxes | `mountSandbox(glove, { adapter })` → `execute_sandbox` | `glove-execution` |
| a side channel from tools to the UI and a pause/resume protocol | Display stack | `display.pushAndForget({ renderer, input })` · `await display.pushAndWait({ renderer, input })` | `glove-core` |
| a chat UI state machine | React bindings | `defineTool({ …, render, renderResult })` · `useGlove()` · `<Render />` | `glove-react` |
| an SSE protocol between server and client | Streaming route | `export const POST = createChatHandler({...})` | `glove-next` |
| STT + agent + TTS glue | Voice pipeline | `new GloveVoice(glove, { stt, createTTS, vad })` · `useGloveVoice` · `useGlovePTT` | `glove-voice` |
| a second tool implementation for a realtime model | Realtime speech, avatars | `new RealtimeAgent({ agent })` with `model: s2sDrivenModel({ provider })` | `glove-voice-s2s` · `-avatar` · `-livekit` |
| permissions, persistence, context and reconnects re-built for a realtime provider | Realtime agents | `new RealtimeSession({ agent })` with `model: realtimeModel({ provider })` | `glove-realtime` |
| a router that calls other agents by hand | Subagents | `glove.defineSubAgent({ name, description, factory })` → `glove_invoke_subagent` | `glove-core` |
| a message bus between agents | Mesh | `await mountMesh(glove, { adapter, identity })` | `glove-mesh` |
| process supervision for long-lived agents | Continuum | `agent("name").input(schema).triggered()` · `new ContinuumRunner({ agentsDir })` | `glove-continuum-signal` |

Needs beyond one harness — many users each with their own agent, threads per user, schedules, sleep, webhooks/Slack/email arriving, approvals, an HTTP or OpenAI-compatible API, an inspector — are **Foundry primitives**: read the `glove-foundry` skill before writing any of them. Somewhere to run it, a persistent disk, a model gateway, browsers, sandboxes, email for agents and a dashboard over runs are **Kuiper**: read the `kuiper` skill.

## The rules the primitives follow

Knowing these lets you predict the API instead of inventing one.

1. **Everything the model does is a tool.** Subagents (`glove_invoke_subagent`), skills (`glove_read_skill`, `glove_invoke_skill`), MCP servers, REPLs (`execute_js`), browsers (`execute_browser`), the inbox (`glove_post_to_inbox`), Foundry's outbound channels and schedules. Add capability by folding a tool or mounting a package, not by special-casing the loop.
2. **Adapters at every boundary.** Model, store, display, subscriber, memory, mesh transport, VFS backend, sandbox backend, MCP access: interfaces you implement; Glove ships reference ones (`MemoryStore`, `InMemory*`, `inMemoryFs`).
3. **Mount, don't wrap.** Capability packages attach to an existing agent with `mountX(glove, …)` / `useX(glove, …)` and never replace its model or loop. Mount after choosing the model.
4. **Live state goes at the tail, not in the prompt.** The system prompt and saved history are a stable, cacheable prefix. Current state (goals, forms, pinned memory, screenshots, your own data) arrives through `addContextProvider` before every model call, including between tool steps, and is never saved to history. A provider can instead be read once per request (`delivery: "request"`, frozen before the request's message) or saved to history once per change (`delivery: "history"`, wrapped in `<context key>`, text only). Third-party happenings go through `emitEvent`: they join a running loop at the next tool-step boundary, or wake/wait for an idle agent, and are saved once.
5. **Work in files and code, not in context.** Big data lives in the VFS, the working environment and REPL bindings; only what the model needs comes back.
6. **The person stays in the loop through primitives.** `pushAndWait` and `requiresPermission` in an app; expiring approval records in Foundry.
7. **Credentials never enter the model.** Tokens come from adapters (`getAccessToken`, account sessions, host secret stores), never from prompts, tool inputs or VFS files.

## Decision guide

**glove-core alone or Foundry?** If the agent is one feature inside an app you already run (one user's chat, a CLI, a script), use `glove-core` (+ `glove-react`/`glove-next` for web). If the agent *is* the backend — many users or tenants with their own agents, several threads each, work that happens later, inbound events, approvals, an API other software calls — use Foundry. The tools, memory and mounts move over unchanged.

**Which tool surface?**
- A handful of well-defined actions → plain tools (`fold`).
- Many capabilities, multi-step reads, loops, filters → a REPL (`glove-js` is the default; `glove-python`, `glove-lisp`), one `execute_*` tool over a function catalogue.
- Data that is naturally relational, joins, previewable writes → `glove-scratchpad` (`execute_sql`).
- Persistent files, scripts that build on each other, documents/spreadsheets/slides/media as outputs → `glove-working-environment` (+ `glove-env-*`), backed by `glove-vfs`.
- Third-party services → `glove-mcp` (or `fnsFromMcp` into a REPL).
- Real websites or a real shell → `glove-execution`.
- Cheap typed decisions → `glove-classifier`.

**How to collect information** (pick the smallest that works):
- A plain tool when the model can supply every argument now.
- `useContext` for standing information every turn should see.
- `useFacts` → `record_fact` for details people mention early or several workflows reuse. Facts are unverified; they never complete a goal or fill a field on their own.
- Forms (`useFormRunner`) for a specific set of validated answers, possibly over several steps or followed by an action.
- A display-stack form (`pushAndWait`) for exact input or a final Confirm that must not pass through the model (not available in voice).
- Goals (`useGoalRunner`) for obligations across the conversation, with versioned progress and deferrals.

**Which surface?** Web chat → `glove-react` + `glove-next` (or any SSE handler). CLI, backend, WebSocket → server-side `glove-core` with subscribers. Voice → `glove-voice` (pipeline), `glove-voice-s2s` (realtime voice, avatars, LiveKit, Foundry `voiceCall`) or `glove-realtime` (the whole agent on a realtime model: enforced permissions, the call in the store, runtime context and goals, camera/screen input, text output, resumption); a fast front model that talks while a heavier worker uses tools is the layered-voice pattern (https://glove.dterminal.net/docs/voice-architectures).

## The smallest harness

```ts
import { Glove, Displaymanager, MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { z } from "zod";

const agent = new Glove({
  store: new MemoryStore("session-1"),          // implement StoreAdapter for durability
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
  displayManager: new Displaymanager(),         // lowercase "m"
  systemPrompt: "You help a team ship releases. Use tools for facts.",
  compaction_config: { compaction_instructions: "Summarise the work so far." },
})
  .fold({
    name: "list_merged_changes",
    description: "List pull requests merged since a date, newest first.",
    inputSchema: z.object({ since: z.string().describe("ISO date") }),
    async do({ since }) {
      return { status: "success", data: await changes.since(since) }; // `data` goes to the model; `renderData` stays client-side
    },
  })
  .build();

agent.addContextProvider(() => `Release branch: ${currentBranch()}`); // live state, never saved to history
const result = await agent.processRequest("What shipped since Monday?");
```

## Rules that prevent silent bugs

The full list (74 items) is in [references/gotchas.md](references/gotchas.md). These are the ones that cost the most when missed:

- **The class is `Displaymanager`** (lowercase m). `createAdapter` streams by default (`stream: true`).
- **`do()` returns `ToolResultData`**: `{ status: "success" | "error" | "aborted", data, message?, renderData? }`. `data` reaches the model; `renderData` never does. A raw object or string is NOT wrapped (only glove-react's `defineTool` wraps), so the model receives nothing.
- **Event keys differ**: `tool_use` carries `{ id, name, input }`; `tool_use_result` carries `call_id`/`tool_name` (with `id`/`name` aliases on newer cores). Streaming adapters emit `model_response_complete`, not `model_response`; handle both.
- **Permissions are keyed on (tool, input).** `requiresPermission` may be a function of the input. Without a UI, set `serverMode: true` (MCP then auto-picks and skips permission gating) or resolve permissions in your store.
- **Runtime context needs glove-core ≥ 4.** Goals, forms, pinned context and screenshots are transient tail messages by default. Any wrapper that proxies a runnable must forward `addContextProvider` (with its `options` argument), `getRuntimeContext`, `emitEvent` and `notifyUserActivity` (plus `addTurnPreparer`, `prepareTurn` and `notifySubscribers` when used with a realtime session); a proxy that drops `options` silently falls back to per-iteration delivery.
- **Turns run one at a time** (glove-core ≥ 4.4): concurrent `processRequest` calls and event wakes queue in order. Calling `processRequest` on the same Glove from inside one of its own tools waits on itself. Put pre-turn work in `addTurnPreparer`, not a `processRequest` wrapper: event wakes do not go through `processRequest`.
- **Tool result summaries need three things**: `enableToolResultSummary: true`, `generateToolSummary` on the tool, and `generateSummaryArgs` from `do()`. Only older turns are rewritten.
- **Subagents don't see parent context**: the child gets only the `prompt` its parent wrote. Pass `parentControls.glove.model` / `displayManager` in the factory to inherit them.
- **`@name` is not parsed**; only `/hook` and `/skill` directives are. Bound directives become non-triggerable placeholders.
- **Goals live in `glove-memory/goals`** (glove-memory ≥ 1.2); there is no `glove-goals`. Forms do not settle goals: call `goals.update` from a step or checkpoint executor. Put irreversible actions in the executor that obtained confirmation.
- **Fact preparation needs a dedicated, built Glove agent** with its own store, never the conversational agent itself (`new FactPreparation(facts, { agent })`). No agent means automatic preparation is off.
- **Mesh needs an inbox-capable store** (all four inbox methods) or `mountMesh` throws. Mesh sender ids are unverified.
- **Continuum triggered agents need `.store(name => StoreAdapter)`** or every wake-up forgets.
- **MCP `auth_expired` is a contract, not an exception**: refresh the token in your adapter; the framework never refreshes. `mountMcp` fails open on a broken server.
- **Jev (`glove-classifier`) is not a chat model.** Never pass a classifier to `createAdapter`.
- **Working environment packages must stay external to bundlers** (`serverExternalPackages` in Next, plus an explicit webpack external in pnpm monorepos). Synchronous libraries go through `definePureModule`, not `defineAdapter`.
- **Realtime agents** (`glove-realtime`): goals and forms prepare through `addTurnPreparer`, which the session runs at each user turn. Module code that prepares per-turn state should register a turn preparer too, not wrap `processRequest`, which a session never calls. `say()` doesn't parse `/hook` or `/skill` directives.
- **Voice**: `createTTS` is a factory; import `glove-voice/silero-vad` dynamically; `GloveVoice` speaks every `text_delta` (a `<speech>` filter is an example-level parser, not an option); GPT-Live (`provider: "openai-live"`) has continuous transcripts and host-owned playback boundaries, so Realtime VAD/final-turn assumptions don't apply.
- **In Foundry every run is a fresh process**: a store factory that returns `new MemoryStore(...)` forgets earlier turns. Use a durable store (see the `glove-foundry` skill).

## Reference files

Read the one that matches the task; each starts with when to read it.

| File | Read when |
| --- | --- |
| [references/core.md](references/core.md) | The loop, `new Glove`, server-side agents, stores, subscribers, model providers and reasoning options, abort, the inbox |
| [references/tools-and-display.md](references/tools-and-display.md) | Defining tools, `ToolResultData`, summaries, `pushAndForget`/`pushAndWait`, display strategies |
| [references/react-next.md](references/react-next.md) | Next.js quick start, `GloveClient`, `useGlove`, `<Render>`, `GloveHandle`, timeline entries |
| [references/extensions.md](references/extensions.md) | Hooks, `/skill` injection, content skills, subagents and their events |
| [references/memory-and-workflows.md](references/memory-and-workflows.md) | glove-memory (entity, episodic, resources, context), forms, goals, facts and preparation |
| [references/mcp.md](references/mcp.md) | glove-mcp: `mountMcp`, catalogue, adapter, discovery, auth, OAuth |
| [references/execution-and-workspace.md](references/execution-and-workspace.md) | Scratchpad, REPLs, VFS, working environment and `glove-env-*` adapters, browsers and sandboxes |
| [references/classifier.md](references/classifier.md) | glove-classifier models, tools, cascades, REPL/env/browser/Foundry integrations |
| [references/voice.md](references/voice.md) | glove-voice pipeline, push-to-talk, React Native, realtime S2S, GPT-Live, avatars, LiveKit, realtime multimodal sessions (glove-realtime) |
| [references/media.md](references/media.md) | glove-image (and glove-video) pipelines, characters, scenes, lineage, cost |
| [references/multi-agent.md](references/multi-agent.md) | glove-mesh messaging and glove-continuum-signal supervision |
| [references/packages.md](references/packages.md) | Choosing a package: every package with a one-paragraph summary and install line |
| [references/api-reference.md](references/api-reference.md) | Exact type signatures for every public API |
| [references/examples.md](references/examples.md) | Worked patterns from the example apps (SPA + Node backend, WebSocket bridge, permission gating, voice, MCP, memory, mesh, continuum) |
| [references/gotchas.md](references/gotchas.md) | Something behaves unexpectedly — check before writing a workaround |

Runnable examples: https://github.com/porkytheblack/glove/tree/main/examples (start with `nextjs-agent`, `coding-agent`, `weather-agent`, `document-desk`, `scratchpad-agent`).
