// The primitive catalogue: every building block Glove, Foundry and Kuiper give
// you, grouped by the part of a harness it serves.
//
// One list feeds the primitives map (/docs/primitives), the first-principles
// page, /llms.txt and /llms-full.txt, so a primitive added here shows up
// everywhere a person or a model looks for it. Keep `insteadOf` phrased as the
// thing someone is about to hand-build: it is what readers scan for.

export type LayerId = "harness" | "system" | "production";

export interface Layer {
  id: LayerId;
  name: string;
  /** Which product owns the layer. */
  owner: string;
  /** One sentence: what the layer adds on top of the one below. */
  claim: string;
  href: string;
}

export const layers: Layer[] = [
  {
    id: "harness",
    name: "Harness",
    owner: "Glove",
    claim:
      "A model becomes an agent when something runs its loop, hands it tools, decides what it sees, remembers for it, gives it somewhere to work and lets people reach it. That something is the harness.",
    href: "/docs/first-principles#harness",
  },
  {
    id: "system",
    name: "System",
    owner: "Glove Foundry",
    claim:
      "A harness becomes a system when there are many of it, it acts on its own time, the outside world can wake it, people can oversee it and other software can call it.",
    href: "/docs/first-principles#system",
  },
  {
    id: "production",
    name: "Production",
    owner: "Kuiper",
    claim:
      "A system is in production when it has somewhere to run, somewhere to keep state, a way to reach models, browsers, sandboxes and mail, and a way to watch it.",
    href: "/docs/first-principles#production",
  },
];

export type PartId =
  | "loop"
  | "tools"
  | "context"
  | "state"
  | "workspace"
  | "surface"
  | "team"
  | "identity"
  | "time"
  | "arrival"
  | "oversight"
  | "access"
  | "run"
  | "keep"
  | "reach"
  | "watch";

export interface Part {
  id: PartId;
  layer: LayerId;
  name: string;
  /** The question every harness has to answer. */
  question: string;
  /** How Glove answers it, in a sentence. */
  answer: string;
}

export const parts: Part[] = [
  // ── Harness (Glove) ──────────────────────────────────────────────────────
  {
    id: "loop",
    layer: "harness",
    name: "Loop",
    question: "How does it act?",
    answer:
      "glove-core runs the loop: prompt the model, run the tools it asks for, feed the results back, repeat until it answers. Retries, turn limits, aborts, streaming and token accounting come with it.",
  },
  {
    id: "tools",
    layer: "harness",
    name: "Tools",
    question: "What can it do?",
    answer:
      "A tool is a name, a description, a Zod schema and a function. Everything an agent can do arrives as tools, including MCP servers, code interpreters, classifiers and media pipelines.",
  },
  {
    id: "context",
    layer: "harness",
    name: "Context",
    question: "What does it see?",
    answer:
      "A stable system prompt, the saved history, and live state appended at the tail of every model call. Skills load guidance on demand and compaction keeps long sessions inside the window.",
  },
  {
    id: "state",
    layer: "harness",
    name: "State",
    question: "What does it remember?",
    answer:
      "A store holds the conversation, tasks, permissions and inbox. glove-memory, glove-facts, forms and goals hold what the agent learns and what it is trying to get done.",
  },
  {
    id: "workspace",
    layer: "harness",
    name: "Workspace",
    question: "Where does it work?",
    answer:
      "A virtual filesystem with scripts, checkpoints and format adapters, sandboxed interpreters, and mounted browsers and sandboxes. Work happens in files and code, not in the context window.",
  },
  {
    id: "surface",
    layer: "harness",
    name: "Surface",
    question: "How do people reach it?",
    answer:
      "Tools push UI onto a display stack and can wait for the user's answer. React, Next.js, voice pipelines, realtime speech and avatars all read the same stack and the same agent.",
  },
  {
    id: "team",
    layer: "harness",
    name: "Team",
    question: "Who does it work with?",
    answer:
      "A subagent is a harness used as a tool. Mesh lets agents message each other through their inboxes, and Continuum supervises them as processes.",
  },

  // ── System (Foundry) ─────────────────────────────────────────────────────
  {
    id: "identity",
    layer: "system",
    name: "Identity",
    question: "Whose agent is this?",
    answer:
      "One definition in code, many persisted instances in data. Each instance has its own conversations, context, installed capabilities and workspace.",
  },
  {
    id: "time",
    layer: "system",
    name: "Time",
    question: "When does it act?",
    answer:
      "Schedules, sleep, spawn and background work are built-in agent tools backed by durable activations, so an agent can act later without a job queue of your own.",
  },
  {
    id: "arrival",
    layer: "system",
    name: "Arrival",
    question: "What wakes it up?",
    answer:
      "Transmissions turn Slack, email, tickets or webhooks into typed events. Playbooks route them to instances, and subscriptions create the instance if none exists yet.",
  },
  {
    id: "oversight",
    layer: "system",
    name: "Oversight",
    question: "Who keeps it in check?",
    answer:
      "Permission-gated tools become expiring approval records, running work can be steered, and the inspector shows every run, model call and tool call.",
  },
  {
    id: "access",
    layer: "system",
    name: "Access",
    question: "How does other software call it?",
    answer:
      "A typed client, a REST API, an async run API and OpenAI-compatible endpoints, all writing into the same durable conversations.",
  },

  // ── Production (Kuiper) ──────────────────────────────────────────────────
  {
    id: "run",
    layer: "production",
    name: "Run",
    question: "Where does it run?",
    answer:
      "Kuiper detects a Foundry app, builds it, runs it and keeps it alive. No Dockerfile. Pushes deploy, deployments are numbered and any of them can come back.",
  },
  {
    id: "keep",
    layer: "production",
    name: "Keep",
    question: "Where does state live?",
    answer:
      "A persistent disk at /data for Foundry's data, transcripts and memory, plus managed Postgres, Redis and buckets, and sealed secrets bound into variables.",
  },
  {
    id: "reach",
    layer: "production",
    name: "Reach",
    question: "What does it reach?",
    answer:
      "One model gateway in front of your own provider keys, real Chrome browsers, sandboxes from ready-made images, and email addresses for agents.",
  },
  {
    id: "watch",
    layer: "production",
    name: "Watch",
    question: "How do you see it?",
    answer:
      "Logs that survive restarts, the agent's runs read straight into the dashboard, every model call recorded, network logs, usage and budgets.",
  },
];

export interface Primitive {
  name: string;
  part: PartId;
  /** The smallest call that uses it. */
  api: string;
  pkg: string;
  /** What you get. */
  gives: string;
  /** What people hand-build when they don't know it exists. */
  insteadOf: string;
  href: string;
}

export const primitives: Primitive[] = [
  // ── Loop ─────────────────────────────────────────────────────────────────
  {
    name: "Agent loop",
    part: "loop",
    api: "new Glove({ model, store, displayManager, systemPrompt, compaction_config }).build().processRequest(text)",
    pkg: "glove-core",
    gives: "Model → tool calls → results → model, until it answers. Matched tool call/result pairs, retries, a per-request turn limit.",
    insteadOf: "a while-loop that calls the model, parses tool calls, runs them and appends results",
    href: "/docs/build/loop",
  },
  {
    name: "Model adapters",
    part: "loop",
    api: 'createAdapter({ provider: "anthropic", model, cache: true })',
    pkg: "glove-core",
    gives: "Anthropic, OpenAI, Gemini, OpenRouter, Bedrock, Vercel AI Gateway, Kimi, GLM, MiniMax, MiMo, Ollama and LM Studio behind one interface, with streaming, reasoning and prompt caching.",
    insteadOf: "provider SDK glue, a streaming parser and tool-call format translation per provider",
    href: "/docs/core#providers",
  },
  {
    name: "Hot-swap model and prompt",
    part: "loop",
    api: "glove.setModel(adapter) · glove.setSystemPrompt(text)",
    pkg: "glove-core",
    gives: "Change the model or prompt between requests without rebuilding the agent or losing history.",
    insteadOf: "tearing the agent down to switch models",
    href: "/docs/server-side#hot-swap",
  },
  {
    name: "Abort and un-abortable tools",
    part: "loop",
    api: "processRequest(text, signal) · fold({ ..., unAbortable: true })",
    pkg: "glove-core",
    gives: "Cancel a request mid-loop; tools that must finish (a payment, a write) run to completion first.",
    insteadOf: "custom cancellation flags threaded through every tool",
    href: "/docs/server-side#abort",
  },
  {
    name: "Subscribers",
    part: "loop",
    api: "glove.addSubscriber({ record(type, data) { … } })",
    pkg: "glove-core",
    gives: "Typed events for text deltas, tool calls and results, compaction, tokens and subagents: stream them, log them, meter them.",
    insteadOf: "wrapping the loop to stream text, log tool calls or count tokens",
    href: "/docs/core#subscriber-events",
  },

  // ── Tools ────────────────────────────────────────────────────────────────
  {
    name: "Tools",
    part: "tools",
    api: "glove.fold({ name, description, inputSchema, do })",
    pkg: "glove-core",
    gives: "Zod-validated input, results the model reads, optional renderData the model never sees.",
    insteadOf: "hand-written JSON schemas, input validation and a dispatch switch",
    href: "/docs/core#tool",
  },
  {
    name: "Permission gates",
    part: "tools",
    api: "fold({ ..., requiresPermission: (input) => input.destructive })",
    pkg: "glove-core",
    gives: "Ask before a tool runs, per call or always; decisions are stored per tool and input. In Foundry it becomes an approval record.",
    insteadOf: "confirm-before-delete logic inside each tool",
    href: "/docs/display-stack",
  },
  {
    name: "Tools that change at runtime",
    part: "tools",
    api: "glove.fold(tool) after build · glove.replaceTools(previousNames, nextTools)",
    pkg: "glove-core",
    gives: "Add tools mid-session or swap a whole set atomically.",
    insteadOf: "rebuilding the agent when the available tools change",
    href: "/docs/core#glove",
  },
  {
    name: "Tool result summaries",
    part: "tools",
    api: "fold({ ..., generateToolSummary }) · enableToolResultSummary: true",
    pkg: "glove-core",
    gives: "Large results replaced by a short summary in later turns.",
    insteadOf: "truncating big tool results by hand",
    href: "/docs/core#tool-result-summaries",
  },
  {
    name: "MCP servers",
    part: "tools",
    api: "mountMcp(glove, { adapter, entries })",
    pkg: "glove-mcp",
    gives: "Any MCP server's tools as Glove tools, a discovery subagent that activates servers mid-conversation, OAuth helpers.",
    insteadOf: "an MCP client and a schema bridge",
    href: "/docs/mcp",
  },
  {
    name: "Code as the tool surface",
    part: "tools",
    api: "mountJs(glove, { session: JsSession.create() })",
    pkg: "glove-js · glove-python · glove-lisp",
    gives: "One execute tool over a catalogue of functions: the model writes a program that loops, filters and branches, and only the answer returns to context.",
    insteadOf: "fifty tool definitions and a round-trip per step",
    href: "/docs/code-execution",
  },
  {
    name: "Capabilities as tables",
    part: "tools",
    api: "mountDatabase(glove, { db })",
    pkg: "glove-scratchpad",
    gives: "Resources become SQL tables behind one execute_sql tool, with discovery, joins and staged writes.",
    insteadOf: "a list/get/search tool for every resource",
    href: "/docs/scratchpad",
  },
  {
    name: "Classifiers",
    part: "tools",
    api: "mountClassifier(glove, { classifier: jev() })",
    pkg: "glove-classifier",
    gives: "Fast, calibrated yes/no, choice and score answers from classifier models, with an LLM fallback and confidence gates.",
    insteadOf: "a chat model call for every routing or triage decision",
    href: "/docs/classifier",
  },
  {
    name: "Image and video workflows",
    part: "tools",
    api: "mountImage(glove, { adapter, assets, library }) · mountVideo(…)",
    pkg: "glove-image · glove-video",
    gives: "Prompt pipelines, durable characters and scenes, references, review, lineage and cost tracking.",
    insteadOf: "a one-shot generate_image tool with no consistency between images",
    href: "/docs/image",
  },

  // ── Context ──────────────────────────────────────────────────────────────
  {
    name: "Runtime context providers",
    part: "context",
    api: "glove.addContextProvider(() => renderCurrentState())",
    pkg: "glove-core",
    gives: "Live state appended after history before every model call, including between tool steps. Never saved to history, never rewrites the system prompt.",
    insteadOf: "rebuilding the system prompt every turn (and losing the prompt cache)",
    href: "/blog/fresh-context-in-the-agent-loop",
  },
  {
    name: "Compaction",
    part: "context",
    api: "compaction_config: { compaction_instructions, compaction_context_limit }",
    pkg: "glove-core",
    gives: "Long sessions summarised automatically; the store keeps the full history for your UI.",
    insteadOf: "a summariser and history-trimming logic",
    href: "/docs/core#compaction-config",
  },
  {
    name: "Content skills",
    part: "context",
    api: "useReadSkill(glove, skills) · loadContentSkillsFromFs(dir)",
    pkg: "glove-core",
    gives: "A listing of guides the agent can read in full, by section, when it needs them.",
    insteadOf: "pasting every playbook into the system prompt",
    href: "/docs/extensions",
  },
  {
    name: "Hooks and slash skills",
    part: "context",
    api: 'glove.defineHook("compact", handler) · glove.defineSkill({ name, handler })',
    pkg: "glove-core",
    gives: "/commands that change agent state or inject context before the user's message.",
    insteadOf: "parsing slash commands in your request handler",
    href: "/docs/extensions",
  },
  {
    name: "Task list",
    part: "context",
    api: "store with getTasks/addTasks → glove_update_tasks",
    pkg: "glove-core",
    gives: "A built-in plan the agent keeps up to date and your UI can show.",
    insteadOf: "a todo or planning tool",
    href: "/docs/core#task-tool",
  },
  {
    name: "Pinned context",
    part: "context",
    api: "useContext(glove, contextAdapter)",
    pkg: "glove-memory",
    gives: "Standing facts every turn should see, editable by the agent, delivered as runtime context.",
    insteadOf: "a user-preferences block in the system prompt",
    href: "/docs/memory",
  },

  // ── State ────────────────────────────────────────────────────────────────
  {
    name: "Store",
    part: "state",
    api: "StoreAdapter (MemoryStore built in; bring your own)",
    pkg: "glove-core",
    gives: "Messages, token and turn counts, and optional tasks, permissions, inbox and subagent stores behind one interface.",
    insteadOf: "a conversations table and token accounting",
    href: "/docs/core#store-adapter",
  },
  {
    name: "Inbox",
    part: "state",
    api: "glove_post_to_inbox (registered when the store supports it)",
    pkg: "glove-core",
    gives: "Work that can't finish now is posted, resolved later by anything, and injected on the next turn. Blocking items keep the agent from acting on missing results.",
    insteadOf: "polling, callbacks and 'check back later' state",
    href: "/docs/inbox",
  },
  {
    name: "Memory",
    part: "state",
    api: "useMemoryReader · useEpisodicReader · useResourcesReader (+ curators)",
    pkg: "glove-memory",
    gives: "An entity graph, an episodic timeline and a resource filesystem with provenance, behind adapters you own (SQLite included).",
    insteadOf: "a vector store and an ad hoc remember tool",
    href: "/docs/memory",
  },
  {
    name: "Forms",
    part: "state",
    api: "defineForm(…) · useFormRunner(glove, adapter, { registry })",
    pkg: "glove-memory",
    gives: "Validated answers collected over a conversation: steps, branches, skips, undo and executors that act on completion.",
    insteadOf: "a slot-filling state machine",
    href: "/docs/forms",
  },
  {
    name: "Goals",
    part: "state",
    api: "defineGoalProgram(…) · useGoalRunner(glove, adapter, config)",
    pkg: "glove-memory",
    gives: "Objectives that survive interruptions, with versioned progress and deferrals.",
    insteadOf: "tracking what the agent is supposed to finish inside the prompt",
    href: "/docs/goals",
  },
  {
    name: "Facts",
    part: "state",
    api: "useFacts(glove, factStore, source)",
    pkg: "glove-facts",
    gives: "Things people mention early, recorded once and reused by forms and goals.",
    insteadOf: "asking the user for something they already said",
    href: "/docs/facts",
  },

  // ── Workspace ────────────────────────────────────────────────────────────
  {
    name: "Virtual filesystem",
    part: "workspace",
    api: "mountFs([...]) · withAccess(fs, policy) · inMemoryFs() · hostDirectory(dir) · cachedRemote(store)",
    pkg: "glove-vfs",
    gives: "One tree shared by the working environment, memory resources and REPLs, with path-scoped access rules.",
    insteadOf: "letting tools read and write the host filesystem",
    href: "/docs/vfs",
  },
  {
    name: "Working environment",
    part: "workspace",
    api: "mountWorkingEnvironment(glove, { env: await createWorkingEnvironment({ stdlib }) })",
    pkg: "glove-working-environment",
    gives: "Files, named scripts in worker threads, checkpoints, undo, run history and artifact export, with no ambient network or host access.",
    insteadOf: "a read/write/run tool set and a code runner",
    href: "/docs/working-environment",
  },
  {
    name: "Format adapters",
    part: "workspace",
    api: "stdlib: [documents(), spreadsheets(), slides(), images(), media(), render(), fetchFiles()]",
    pkg: "glove-env-*",
    gives: "PDF, DOCX, XLSX, PPTX, images, audio, video, archives, HTTP and secrets as script imports, plus rendering pages so the agent can look at its output.",
    insteadOf: "wiring pdf, docx and spreadsheet libraries into tools",
    href: "/docs/working-environment#adapters",
  },
  {
    name: "Browsers",
    part: "workspace",
    api: "mountBrowser(glove, { adapter })",
    pkg: "glove-execution",
    gives: "execute_browser: the model scripts observe, act and verify in one call, and screenshots arrive as images.",
    insteadOf: "Playwright wrapped in click/type/screenshot tools",
    href: "/docs/execution",
  },
  {
    name: "Sandboxes",
    part: "workspace",
    api: "mountSandbox(glove, { adapter })",
    pkg: "glove-execution",
    gives: "execute_sandbox over persistent containers: files, commands, terminals and long-running services, with ownership and cleanup.",
    insteadOf: "docker exec wrappers and container bookkeeping",
    href: "/docs/execution",
  },

  // ── Surface ──────────────────────────────────────────────────────────────
  {
    name: "Display stack",
    part: "surface",
    api: "display.pushAndForget({ input }) · await display.pushAndWait({ input })",
    pkg: "glove-core",
    gives: "Tools render UI mid-conversation; pushAndWait suspends the tool until the person answers.",
    insteadOf: "a side channel from tools to the UI and a pause/resume protocol",
    href: "/docs/display-stack",
  },
  {
    name: "React bindings",
    part: "surface",
    api: "defineTool({ …, render, renderResult }) · useGlove() · <Render />",
    pkg: "glove-react",
    gives: "Tools with colocated, typed renderers, a hook with the whole timeline, and headless rendering.",
    insteadOf: "a chat UI state machine",
    href: "/docs/react",
  },
  {
    name: "Streaming route",
    part: "surface",
    api: "export const POST = createChatHandler({ … })",
    pkg: "glove-next",
    gives: "An SSE endpoint for Next.js (or any fetch handler) that a GloveClient talks to.",
    insteadOf: "an SSE protocol between your server and client",
    href: "/docs/next",
  },
  {
    name: "Voice pipeline",
    part: "surface",
    api: "new GloveVoice(glove, { stt, createTTS, vad }) · useGloveVoice(…) · useGlovePTT(…)",
    pkg: "glove-voice",
    gives: "VAD → STT → agent → TTS with barge-in, push-to-talk and React Native backends.",
    insteadOf: "stitching speech-to-text, the agent and text-to-speech together",
    href: "/docs/voice",
  },
  {
    name: "Realtime speech and avatars",
    part: "surface",
    api: "new RealtimeAgent({ agent }) with model: s2sDrivenModel({ provider })",
    pkg: "glove-voice-s2s · glove-voice-avatar · glove-voice-livekit",
    gives: "The same tools on OpenAI Realtime, Gemini Live or GPT-Live, with live avatars and LiveKit rooms.",
    insteadOf: "a second tool implementation for the realtime provider",
    href: "/docs/realtime-voice",
  },

  // ── Team ─────────────────────────────────────────────────────────────────
  {
    name: "Subagents",
    part: "team",
    api: "glove.defineSubAgent({ name, description, factory })",
    pkg: "glove-core",
    gives: "glove_invoke_subagent routes work to an isolated child with its own tools and store; events bracket the child's run.",
    insteadOf: "a router that calls other agents by hand",
    href: "/docs/extensions",
  },
  {
    name: "Mesh",
    part: "team",
    api: "mountMesh(glove, { adapter, identity })",
    pkg: "glove-mesh",
    gives: "Direct, broadcast and acknowledged messages between agents, delivered through their inboxes.",
    insteadOf: "a message bus between agents",
    href: "/docs/mesh",
  },
  {
    name: "Continuum",
    part: "team",
    api: 'agent("name").triggered() · new ContinuumRunner({ agentsDir })',
    pkg: "glove-continuum-signal",
    gives: "Agents supervised as subprocesses, cold per wake-up or warm and notified inline.",
    insteadOf: "process supervision for long-lived agents",
    href: "/docs/continuum",
  },

  // ── Identity ─────────────────────────────────────────────────────────────
  {
    name: "Definitions",
    part: "identity",
    api: "agents/<route>/agent.ts → export default defineAgent({ … })",
    pkg: "glove-foundry",
    gives: "The file path is the id. Every field can be a function of the instance, conversation and incoming message.",
    insteadOf: "a factory that rebuilds the agent per request from a switch over tenants",
    href: "/foundry/docs/composition",
  },
  {
    name: "Instances",
    part: "identity",
    api: "client.agent(route).create({ context }) · defineAgentInstance(definition, { … })",
    pkg: "glove-foundry",
    gives: "Persisted agents with their own id, context, workspace, installations and playbooks.",
    insteadOf: "an agents-per-customer table and lookup",
    href: "/foundry/docs/definitions-and-instances",
  },
  {
    name: "Conversations",
    part: "identity",
    api: "client.createConversation(agentId) · client.conversationTranscript(…)",
    pkg: "glove-foundry",
    gives: "Any number of durable threads per instance with exact transcripts.",
    insteadOf: "thread tables and routing messages to the right history",
    href: "/foundry/docs/conversations",
  },
  {
    name: "Installable capabilities",
    part: "identity",
    api: "defineSharedTool · defineApp · defineMcp · install(definition, config)",
    pkg: "glove-foundry",
    gives: "Capabilities mount only on instances that install them, with typed config.",
    insteadOf: "per-customer feature flags around tool lists",
    href: "/foundry/docs/capabilities",
  },
  {
    name: "Shared work",
    part: "identity",
    api: "glove_foundry_workspace · _tasks · _shared_inbox · _environment",
    pkg: "glove-foundry",
    gives: "Workspace entries, tasks, a shared inbox and scoped values that agents coordinate through.",
    insteadOf: "coordination tables between agents",
    href: "/foundry/docs/conversations#workspace",
  },
  {
    name: "Data adapters",
    part: "identity",
    api: "new FileFoundryDataAdapter({ file }) · FoundryDataAdapter",
    pkg: "glove-foundry",
    gives: "Instances, conversations, activations and workspace data persisted atomically; swap in a database for several hosts.",
    insteadOf: "serialising runtime state yourself",
    href: "/foundry/docs/persistence",
  },

  // ── Time ─────────────────────────────────────────────────────────────────
  {
    name: "Schedules",
    part: "time",
    api: 'defineSchedule({ timing: { kind: "cron", expression }, message }) · glove_foundry_schedule',
    pkg: "glove-foundry",
    gives: "Cron, interval and one-shot work, declared in code or created by the agent, rebuilt on restart.",
    insteadOf: "cron jobs and a job queue that call your agent",
    href: "/foundry/docs/automation#schedules",
  },
  {
    name: "Sleep",
    part: "time",
    api: 'glove_foundry_sleep({ kind: "for", duration: "20m", message })',
    pkg: "glove-foundry",
    gives: "Suspend the run and wake the same instance and conversation later.",
    insteadOf: "storing 'check back later' state and a timer",
    href: "/foundry/docs/automation#core-tools",
  },
  {
    name: "Spawn and background",
    part: "time",
    api: "glove_foundry_spawn · glove_foundry_background",
    pkg: "glove-foundry",
    gives: "Start another instance's run, or continue work without blocking the reply.",
    insteadOf: "fire-and-forget promises that die with the request",
    href: "/foundry/docs/automation#core-tools",
  },
  {
    name: "Schedule management",
    part: "time",
    api: 'glove_foundry_schedules({ action: "list" | "update" | "pause" | "resume" | "cancel" })',
    pkg: "glove-foundry",
    gives: "The agent lists and edits its own reminders and recurring work.",
    insteadOf: "a reminders CRUD API for the agent",
    href: "/foundry/docs/automation#core-tools",
  },

  // ── Arrival ──────────────────────────────────────────────────────────────
  {
    name: "Transmissions",
    part: "arrival",
    api: "defineTransmission({ inbound, outbound, account })",
    pkg: "glove-foundry",
    gives: "Typed inbound events and outbound delivery for one channel; outbound becomes a validated tool when installed. Credentials stay in your adapter.",
    insteadOf: "a webhook handler and an API client per channel",
    href: "/foundry/docs/applications",
  },
  {
    name: "Applications and connections",
    part: "arrival",
    api: "defineApp({ inbound, outbound, connections }) · defineConnection(…)",
    pkg: "glove-foundry",
    gives: "Channels bundled into something an instance installs; long-lived listeners started only while something needs them.",
    insteadOf: "polling loops and socket clients you keep alive yourself",
    href: "/foundry/docs/applications#connections",
  },
  {
    name: "Playbooks",
    part: "arrival",
    api: "composePlaybook({ transmission, match, directives })",
    pkg: "glove-foundry",
    gives: "Rules that match events to instances, with idempotent delivery into the right conversation.",
    insteadOf: "a dispatcher that decides which agent handles which event",
    href: "/foundry/docs/automation#playbooks",
  },
  {
    name: "Subscriptions",
    part: "arrival",
    api: "definePlaybookSubscription(…) · runtime.putPlaybookSubscription(…)",
    pkg: "glove-foundry",
    gives: "An event can create the agent that handles it: zero, one or many instances provisioned atomically.",
    insteadOf: "onboarding code that creates an agent before its first message",
    href: "/foundry/docs/automation#subscriptions",
  },
  {
    name: "Inbound triage",
    part: "arrival",
    api: "classifyInbound({ classifier, question }) · classifierPredicate(…)",
    pkg: "glove-classifier/foundry",
    gives: "Classify events before any agent starts, and match playbooks on the answers.",
    insteadOf: "waking an LLM agent to read every event",
    href: "/foundry/docs/applications#classifier",
  },

  // ── Oversight ────────────────────────────────────────────────────────────
  {
    name: "Approvals",
    part: "oversight",
    api: 'requiresPermission → client.resolveApproval(id, "approve")',
    pkg: "glove-foundry",
    gives: "Gated tool calls pause the run on an expiring, fail-closed approval record with the exact input.",
    insteadOf: "an approvals table and a pause/resume flow",
    href: "/foundry/docs/approvals",
  },
  {
    name: "Steering",
    part: "oversight",
    api: "handle.steer(message) · POST /v1/runs/:id/steer",
    pkg: "glove-foundry",
    gives: "Interrupt running work cleanly and restart it in the same conversation with the new instruction.",
    insteadOf: "cancel-and-resend logic that races the old run",
    href: "/foundry/docs/approvals#steering",
  },
  {
    name: "Inspector and WebChat",
    part: "oversight",
    api: "glove foundry dev → http://localhost:4141",
    pkg: "glove-foundry",
    gives: "Every instance, conversation, run, model call, tool call and approval, plus a chat to talk to any instance.",
    insteadOf: "an admin dashboard and a debug chat",
    href: "/foundry/docs/observability",
  },
  {
    name: "Event stream",
    part: "oversight",
    api: "GET /api/events (SSE) · defineSubscriber(…)",
    pkg: "glove-foundry",
    gives: "Correlated events by definition, instance, conversation and run, live or after the fact.",
    insteadOf: "log scraping to reconstruct what an agent did",
    href: "/foundry/docs/observability#events",
  },

  // ── Access ───────────────────────────────────────────────────────────────
  {
    name: "Typed client",
    part: "access",
    api: "createFoundryClient<FoundryRoutes>({ baseUrl }).agent(route)",
    pkg: "glove-foundry/client",
    gives: "Create instances, send messages, and wait on, stream, cancel or steer run handles, with route types generated from your files.",
    insteadOf: "a hand-written HTTP client for your agent service",
    href: "/foundry/docs/runtime#typed-client",
  },
  {
    name: "OpenAI-compatible API",
    part: "access",
    api: "POST /v1/chat/completions · POST /v1/responses",
    pkg: "glove-foundry",
    gives: "Any OpenAI SDK or chat UI talks to a durable instance and conversation.",
    insteadOf: "an adapter so existing chat clients can reach your agent",
    href: "/foundry/docs/openai-compatible",
  },
  {
    name: "Run API and REST",
    part: "access",
    api: "POST /v1/runs · GET /v1/runs/:id/events · /api/*",
    pkg: "glove-foundry",
    gives: "Asynchronous runs with live events, and REST over every runtime record.",
    insteadOf: "a job-status API around your agent",
    href: "/foundry/docs/runtime#runs-api",
  },
  {
    name: "Request authorization",
    part: "access",
    api: "defineApplication({ requestAuthorization: { authorize } })",
    pkg: "glove-foundry",
    gives: "One check in front of the API, the inspector and the event streams. Foundry refuses a public bind without it.",
    insteadOf: "auth middleware in front of each route",
    href: "/foundry/docs/deploy#authorization",
  },

  // ── Run ──────────────────────────────────────────────────────────────────
  {
    name: "Zero-config deploys",
    part: "run",
    api: "kuiper deploy --source . -u UNIT --wait · kuiper link -u UNIT --repo … (push to deploy)",
    pkg: "Kuiper",
    gives: "Foundry and Station apps detected and built with no Dockerfile: Node 22, the right start command, port and health check.",
    insteadOf: "a Dockerfile, a process manager and a deploy script",
    href: "/docs/build/production",
  },
  {
    name: "Deployments and rollbacks",
    part: "run",
    api: "kuiper deployments · kuiper rollback DEPLOYMENT",
    pkg: "Kuiper",
    gives: "Numbered deployments, one live at a time; any earlier one redeploys with its manifest.",
    insteadOf: "image tags and a rollback runbook",
    href: "https://kuiper.sh/docs/operations/",
  },
  {
    name: "Domains and environments",
    part: "run",
    api: "kuiper domains add HOST · kuiper environments create NAME",
    pkg: "Kuiper",
    gives: "HTTPS on every unit, custom domains, and staging environments from their own branches.",
    insteadOf: "certificates, DNS and a second copy of the stack",
    href: "https://kuiper.sh/docs/domains/",
  },

  // ── Keep ─────────────────────────────────────────────────────────────────
  {
    name: "Persistent disk",
    part: "keep",
    api: "/data on every Foundry unit",
    pkg: "Kuiper",
    gives: "Where FileFoundryDataAdapter, transcripts, SQLite memory and VFS snapshots live across restarts and redeploys.",
    insteadOf: "mounting and backing up a volume",
    href: "/foundry/docs/kuiper#state",
  },
  {
    name: "Managed databases and buckets",
    part: "keep",
    api: "kuiper db create postgres main · ${{main.DATABASE_URL}}",
    pkg: "Kuiper",
    gives: "Postgres, Redis and S3-compatible buckets inside the project, wired in by variable templates.",
    insteadOf: "provisioning a database and copying its URL into config",
    href: "https://kuiper.sh/docs/databases/",
  },
  {
    name: "Secrets and variables",
    part: "keep",
    api: "kuiper secrets set NAME=- · kuiper env set 'NAME=${{secrets.NAME}}'",
    pkg: "Kuiper",
    gives: "Sealed values bound into units, never in the image, redacted from logs.",
    insteadOf: "a secrets manager integration",
    href: "https://kuiper.sh/docs/variables/",
  },

  // ── Reach ────────────────────────────────────────────────────────────────
  {
    name: "Model gateway",
    part: "reach",
    api: "createAdapter({ provider, model, ...kuiper.models.glove(provider) })",
    pkg: "Kuiper",
    gives: "Each provider's own API at one address with your keys, limits and every call recorded with tokens and cost.",
    insteadOf: "provider keys in every unit and your own usage tracking",
    href: "https://kuiper.sh/docs/models/",
  },
  {
    name: "Kuiper browsers",
    part: "reach",
    api: "Steel-compatible API at ${{browsers.BASE_URL}}",
    pkg: "Kuiper",
    gives: "Real Chrome with profiles, hibernation and recordings, billed by the second.",
    insteadOf: "running headless Chrome next to your agent",
    href: "https://kuiper.sh/docs/browsers/",
  },
  {
    name: "Kuiper sandboxes",
    part: "reach",
    api: 'kuiper.sandboxes.create({ image: "kuiper/coding" }) · capabilities.sandbox in kuiper.json',
    pkg: "Kuiper",
    gives: "Remote computers from ready-made images with a terminal, files and ports. An app that depends on station-sandbox gets a Docker socket Kuiper polices, for Station's own containers.",
    insteadOf: "a container fleet for untrusted code",
    href: "https://kuiper.sh/docs/sandboxes/",
  },
  {
    name: "Kuiper inbox",
    part: "reach",
    api: "inboxTools(inbox, { mailbox }) from @kuiper-sh/inbox/glove",
    pkg: "Kuiper",
    gives: "An email address per agent that receives, sends, threads and calls your unit's webhook.",
    insteadOf: "an email provider, inbound parsing and webhook verification",
    href: "https://kuiper.sh/docs/inbox/",
  },

  // ── Watch ────────────────────────────────────────────────────────────────
  {
    name: "Agent inspection",
    part: "watch",
    api: "the unit's Inspect card · the project's Agents page",
    pkg: "Kuiper",
    gives: "Foundry runs, conversations, events and approvals read into the dashboard through the node, once requestAuthorization accepts Bearer $FOUNDRY_TOKEN. The app's token never reaches a browser.",
    insteadOf: "exposing your inspector publicly to see production",
    href: "https://kuiper.sh/docs/foundry/",
  },
  {
    name: "Logs and network logs",
    part: "watch",
    api: "kuiper logs -u UNIT -f · kuiper network summary",
    pkg: "Kuiper",
    gives: "Logs kept across crashes and redeploys with secrets redacted, plus requests, DNS and connections per unit.",
    insteadOf: "a log shipper and a proxy to see outbound calls",
    href: "https://kuiper.sh/docs/operations/",
  },
  {
    name: "Usage and budgets",
    part: "watch",
    api: "kuiper usage · kuiper budgets create --scope project --limit 50",
    pkg: "Kuiper",
    gives: "Spend by resource and project, with limits that notify or block.",
    insteadOf: "spreadsheets reconciling provider bills",
    href: "https://kuiper.sh/docs/budgets/",
  },
  {
    name: "Kuiper over MCP",
    part: "watch",
    api: "claude mcp add --transport http kuiper https://app.kuiper.sh/mcp",
    pkg: "Kuiper",
    gives: "Your coding agent reads projects, logs and usage and, if you allow it, deploys.",
    insteadOf: "copy-pasting logs into your coding agent",
    href: "https://kuiper.sh/docs/mcp/",
  },
];

export function partsOf(layer: LayerId): Part[] {
  return parts.filter((part) => part.layer === layer);
}

export function primitivesOf(part: PartId): Primitive[] {
  return primitives.filter((primitive) => primitive.part === part);
}

export function partById(id: PartId): Part {
  const part = parts.find((entry) => entry.id === id);
  if (!part) throw new Error(`unknown part ${id}`);
  return part;
}

/** Absolute URL for a primitive or part link, for llms.txt. */
export function absolute(href: string, site: string): string {
  return href.startsWith("http") ? href : `${site}${href}`;
}
