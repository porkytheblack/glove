// The machine-readable surface of the docs.
//
// `/llms.txt` is the index — generated from the same nav tree the sidebar
// renders, so a new page appears here the moment it is added to docs-nav.ts.
// `/llms-full.txt` is the hand-written condensed reference: enough for a model
// to write correct Glove code without fetching anything else.

import { docsSections } from "./docs-nav";
import { FOUNDRY_LLMS_FULL } from "./foundry-llms";

export const SITE_URL = "https://glove.dterminal.net";

/** llms.txt — the index, per the llmstxt.org convention. */
export function buildLlmsTxt(): string {
  const out: string[] = [];

  out.push("# Glove");
  out.push("");
  out.push(
    "> Glove is an open-source TypeScript framework for AI-powered applications. " +
      "You define capabilities as tools; an agent decides when to call them. " +
      "Beyond the agent loop it ships a display stack (tools render UI mid-conversation), " +
      "a persistent inbox, a memory layer, sandboxes the model can compute in, " +
      "a mesh for agents to coordinate over, voice (cascade and realtime speech-to-speech), " +
      "MCP integration, container packaging, and Glove Foundry: a file-routed application " +
      "framework for complete, observable agent systems.",
  );
  out.push("");
  out.push(
    "Packages are independent: install the runtime plus only what you need. " +
      "Everything is TypeScript + ESM, tool inputs are Zod schemas, and every layer " +
      "(model, store, display, subscriber, voice) is an adapter interface you can replace.",
  );
  out.push("");
  out.push("- Repository: https://github.com/porkytheblack/glove");
  out.push(`- Full condensed reference: ${SITE_URL}/llms-full.txt`);
  out.push(`- Foundry agent-system reference: ${SITE_URL}/foundry/llms-full.txt`);
  out.push("");

  for (const section of docsSections) {
    out.push(`## ${section.title}`);
    if (section.blurb) {
      out.push("");
      out.push(section.blurb);
    }
    out.push("");
    for (const item of section.items) {
      const pkgs = item.packages?.length ? ` [${item.packages.join(", ")}]` : "";
      const summary = item.summary ? `: ${item.summary}` : "";
      out.push(`- [${item.label}](${SITE_URL}${item.href})${summary}${pkgs}`);
    }
    out.push("");
  }

  return out.join("\n");
}

/** llms-full.txt — the condensed reference a coding model can work from. */
const CORE_LLMS_FULL = `# Glove — condensed reference for language models

Glove is an open-source TypeScript framework for building applications driven by
an AI agent. You define capabilities as **tools**; the agent decides which to
call and in what order. Docs: ${SITE_URL}. Source:
https://github.com/porkytheblack/glove.

This file is the whole framework in one place. Everything is TypeScript + ESM.
Tool input schemas are Zod schemas.

## 1. Mental model

- **Tool** — a name, a description (this is what the model reads), a Zod
  \`inputSchema\`, and an async \`do(input, display)\`. Registered with \`.fold()\`.
- **Agent loop** — prompt the model, run the tools it asks for, feed results
  back, repeat until it answers with text.
- **Display stack** — tools push UI mid-run. \`display.pushAndForget()\` renders
  and keeps going; \`display.pushAndWait()\` renders and suspends the tool until
  the user responds, then resumes with their value.
- **Store** — where conversation state lives (\`StoreAdapter\`).
- **Adapters** — the seam at every layer: model, store, display, subscriber,
  voice. Swap the implementation, keep the app.

## 2. Install

\`\`\`bash
# Full-stack (Next.js App Router)
pnpm add glove-react glove-next zod

# Server-only (Node / CLI / worker)
pnpm add glove-core zod
\`\`\`

\`glove-core\` is a dependency of \`glove-react\`.

## 3. Server-side agent (glove-core)

\`\`\`ts
import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  store: new MemoryStore("session-1"),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-5", stream: true }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant.",
  compaction_config: { compaction_instructions: "Summarize the conversation so far." },
})
  .fold({
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: z.object({ city: z.string() }),
    async do(input) {
      return { status: "success", data: await weather.lookup(input.city) };
    },
  })
  .build();

const result = await agent.processRequest("What's the weather in Tokyo?");
\`\`\`

Observe it with a subscriber:

\`\`\`ts
agent.addSubscriber({
  async record(event, data) {
    if (event === "text_delta") process.stdout.write(data.text);
    if (event === "tool_use") console.log("→", data.name);
    if (event === "tool_use_result") console.log("←", data.result.status);
  },
});
\`\`\`

## 4. Full-stack (glove-next + glove-react)

\`\`\`ts
// app/api/chat/route.ts
import { createChatHandler } from "glove-next";
export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-5",
  cache: true,
});
\`\`\`

\`\`\`tsx
// lib/glove.ts
import { GloveClient } from "glove-react";
import { z } from "zod";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt: "You are a helpful weather assistant.",
  tools: [{
    name: "get_weather",
    description: "Get the current weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    async do(input) { return await lookup(input.city); },
  }],
});

// app/providers.tsx  ("use client")
import { GloveProvider } from "glove-react";
export function Providers({ children }) {
  return <GloveProvider client={gloveClient}>{children}</GloveProvider>;
}

// app/page.tsx  ("use client")
import { useGlove, Render } from "glove-react";
export default function Chat() {
  const glove = useGlove();   // { timeline, streamingText, busy, sendMessage, stats, runnable }
  return <Render glove={glove} renderMessage={({ entry }) => <p>{entry.text}</p>} />;
}
\`\`\`

Timeline entries have \`kind\`: \`"user"\` | \`"agent_text"\` | \`"tool"\`.

## 5. Display stack

\`\`\`ts
async do(input, display) {
  // Show UI, keep running.
  await display.pushAndForget({ renderer: "product_grid", input: results });

  // Show UI and SUSPEND until the user submits.
  const payment = await display.pushAndWait({ renderer: "payment_form", input: cart });
  return await orders.create(cart, payment);
}
\`\`\`

## 6. Model providers

\`createAdapter({ provider, model, stream })\` from \`glove-core/models/providers\`.

| provider | env var | default model |
| --- | --- | --- |
| openai | OPENAI_API_KEY | gpt-4.1 |
| anthropic | ANTHROPIC_API_KEY | claude-sonnet-5 |
| openrouter | OPENROUTER_API_KEY | anthropic/claude-sonnet-4 |
| gemini | GEMINI_API_KEY | gemini-2.5-flash |
| minimax | MINIMAX_API_KEY | MiniMax-M2.5 |
| kimi | MOONSHOT_API_KEY | kimi-k2.5 |
| glm | ZHIPUAI_API_KEY | glm-4-plus |
| mimo | MIMO_API_KEY | mimo-v2.5 |
| bedrock | AWS_ACCESS_KEY_ID | anthropic.claude-3-5-sonnet-20241022-v2:0 |
| ollama | (none) | user-specified |
| lmstudio | (none) | user-specified |

Options: \`reasoning: true | { effort, reasoningObject, extraBody, includeInText }\`
captures provider reasoning traces; \`cache: true | { ttl: "5m" | "1h" }\` enables
provider prompt caching. Cache usage is reported on every response as
\`cache_creation_input_tokens\` / \`cache_read_input_tokens\`.

## 7. Package map

| package | purpose |
| --- | --- |
| glove-core | runtime: agent loop, tools, models, display manager, stores, hooks/skills/subagents |
| glove-foundry | file-routed application framework: definitions, instances, apps, transmissions, playbooks, schedules, conversations, runtime and inspector |
| glove-react | GloveClient, GloveProvider, useGlove, <Render>, defineTool, createRemoteStore |
| glove-next | createChatHandler — SSE streaming route handler |
| glove-voice | cascade voice: VAD → STT → agent → TTS, barge-in, push-to-talk |
| glove-voice-native | React Native / Expo mic capture, PCM playback, Silero VAD |
| glove-voice-s2s | run an agent on realtime speech-to-speech models (OpenAI Realtime, Gemini Live) |
| glove-voice-avatar | live avatars over the S2S audio (Tavus echo, Anam passthrough) |
| glove-voice-livekit | LiveKit room transport + LiveKit-native avatars |
| glove-memory | entity graph, episodic timeline, resource filesystem, standing context, forms |
| glove-scratchpad | expose tools as a relational database driven by one execute_sql tool |
| glove-sql | zero-dependency Postgres-subset SQL engine (scratchpad's default backend) |
| glove-working-environment | persistent sandboxed VFS: scripts, runs, artifacts |
| glove-env-documents/-spreadsheets/-images/-slides/-archives/-media/-render/-motion | stdlib adapters for the working environment |
| glove-js / glove-python / glove-lisp | one eval tool over a shared ToolFn catalog |
| glove-egress | measured, enforced egress boundary over that catalog |
| glove-image | agentic image generation: prompt pipeline, characters/scenes, refs, edit, assemble, cost |
| glove-mesh | direct/broadcast/ack messaging between agents |
| glove-continuum-signal | subprocess runtime: triggered (cold) and concurrent (warm) agents |
| glove-mcp | bridge Model Context Protocol servers in as tools |
| glovebox-core / -kit / -client | DEPRECATED legacy container service; use glove-foundry for new runtimes |
| glove-sqlite | DEPRECATED SQLite store; bring your own StoreAdapter instead |

## 8. Capability packages — minimal correct usage

### glove-memory

\`\`\`ts
import {
  useMemoryReader, useEpisodicReader, useContext,
  InMemoryEntityAdapter, InMemoryEpisodicAdapter, InMemoryContextAdapter,
} from "glove-memory";

useMemoryReader(agent, new InMemoryEntityAdapter({ schema: ontology }));
useEpisodicReader(agent, new InMemoryEpisodicAdapter());
useContext(agent, new InMemoryContextAdapter());  // injected into the prompt each turn
// Writes go to a SEPARATE curator instance: useMemoryCurator(curator, entities)
\`\`\`

Recommended shape: do not attach every memory tool to the main agent. Build one
subagent per retrieval task with \`defineSubAgent\`, attaching only the adapter
slice it needs, so token cost scales with role rather than ontology size. The
exception is \`useContext\` — keep that on the agent the user actually talks to.

Memory arrives in strata: a shared corpus the agent reads but must never change
(authored elsewhere, one copy for everyone) plus its own private store. They are
different adapters; \`layerEntity\` / \`layerEpisodic\` / \`layerResources\` /
\`layerContext\` merge a stack into one adapter of the ordinary contract, so the
usual \`use*\` helpers fold the usual tools over it and the agent never learns
there are two stores. Exactly one \`access: "write"\` stratum per stack; reads
merge in layer order; writes route to the owning stratum and are refused when it
is read-only. Entity is the lossy one — edges cannot straddle strata, so model
cross-stratum associations as episode participants or resource links.

Narrow what the agent may do two independent ways, meant to be combined.
\`{ tools: { allow, deny } }\` on any \`use*\` helper picks which tools are folded,
so the affordance never reaches the model. \`withResourceAccess(adapter, policy)\`
gates the resource filesystem by path — \`"write"\`, \`"read"\` (mutations refused),
\`"none"\` (invisible, filtered out of listings and search) over prefix or glob
rules that cascade last-match-wins — so a write into a read-only folder is
refused whichever tool asks.

### glove-memory forms — structured collection over a conversation

The fifth subsystem. Definitions are CODE (zod schemas, gate closures and
executors in one builder chain); the agent never reads them, only a projection
of evaluated state.

\`\`\`ts
import { z } from "zod";
import { defineForm } from "glove-memory/forms";

export const travelClaim = defineForm({
  id: "travel-claim", version: 1,
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  conduct: "Conversational — one or two questions at a time.",
})
  .step("claimant", { title: "Claimant", preview: "name, staff id, email" }, (s) =>
    s.field("fullName", { schema: z.string().min(2), label: "Full name" })
     .field("email", { schema: z.string().email(), label: "Work email" }),
  )
  .step("travel", { title: "Travel", preview: "mileage or ticket",
                    when: (v, s) => s.stepComplete("claimant") }, (s) =>
    s.field("mode", { schema: z.enum(["car", "rail", "air"]), label: "Mode" })
     .field("mileage", { schema: z.number().int().min(1).optional(),
                         label: "Miles driven",
                         when: (v) => v.mode === "car" }),
  )
  .checkpoint("policy-cap", {
    when: (v) => typeof v.total === "number" && v.total > 750,
    blocking: true,
    run: () => ({ fail: "Over the limit — needs Finance pre-approval." }),
  })
  .onComplete(async (ctx) => { await ctx.memory.upsertNode("Person", { name: ctx.values.fullName }); })
  .build();
\`\`\`

Wiring:

\`\`\`ts
import { FormRegistry } from "glove-memory/forms";
import { useFormRunner, useFormReader, InMemoryFormAdapter } from "glove-memory";

const registry = new FormRegistry().register("travel-claim", {
  name: "…", description: "…",
  load: () => import("./forms/travel-claim").then((m) => m.travelClaim),  // lazy
});

const { runner } = useFormRunner(glove, new InMemoryFormAdapter({ schema }), {
  registry, subject: conversationId,
  memory: { entity, episodic, resources, context },   // optional bridge
});
useFormReader(auditor, adapter, { registry });        // read-only history
\`\`\`

Rules that decide whether generated code is correct:

- **There is no \`required\` flag.** A field is optional iff its zod schema
  accepts \`undefined\`. The agent-readable \`type\` string is derived via
  \`z.toJSONSchema\`. Do not invent a field-type vocabulary.
- **Writes are never gated.** \`glove_form_fill\` accepts a patch of ANY field
  ids at any time; only zod can reject. Ids resolve case/punctuation-insensitively
  (\`full_name\` = \`Full name\` = \`fullName\`), with \`did_you_mean\` on a miss.
- **\`when\` is applicability, steps are ask order.** An inapplicable field is
  not asked and does not count toward completion, but a value given for it is
  kept as \`held\` and goes live again if the branch flips back. \`values\` =
  live entries; \`held\` = the rest; \`onComplete\` only ever sees \`values\`.
- **\`entries\` is an append-only log per field plus a cursor.** Corrections
  append. \`retract\` / \`undo\` / \`redo\` are cursor moves, reached by the model
  through \`glove_form_revise\`'s \`action\` param, not separate tools.
- **Executors** — \`field.onFill\`, \`step.onComplete\`, \`checkpoint.run\`,
  \`form.onComplete\` — fire on RISING EDGES only, in that order, commit-then-run,
  at-least-once with a per-occurrence \`idempotencyKey\`. They return
  \`{ patch } | { fail } | { jump } | { complete } | { terminate }\`, or an array.
  A throwing executor does NOT roll back the write; a recorded failure is not
  retried.
- **Tiers.** Tier 0 is one system-prompt line per turn (open step + pending
  labels + later-step previews). Tier 1 = \`glove_form_status\` (open step in
  full). Tier 2 = \`glove_form_inspect\` (any step / field / outline).
- **Tools:** \`glove_form_list\` / \`_start\` / \`_status\` / \`_inspect\` / \`_fill\` /
  \`_revise\` / \`_abandon\` from the runner, \`glove_form_history\` from the reader.
- **A blocking checkpoint** leaves the instance \`awaiting\` with writes refused
  (\`form_blocked\`) until the host calls \`runner.resolveCheckpoint\`. No timeout.
- **\`FormAdapter\`** is storage only. Invariants: entries append never replace
  (\`applyEntryCommit\` is exported), \`version\` is compare-and-set (throw
  \`FormConflictError\`), a commit is all-or-nothing, reads return snapshots.
- Instances pin \`defVersion\`; drift defaults to \`status: "stale"\` unless the
  def supplies \`migrate(old, fromVersion)\`.

### glove-scratchpad (+ glove-sql)

\`\`\`ts
import { Database, defineResource, mountDatabase } from "glove-scratchpad";
import { z } from "zod";

const db = await Database.create({ policy: { writes: true } });
db.register(defineResource({
  name: "github_pull_requests",
  volatility: "volatile",
  schema: z.object({ number: z.number().int(), title: z.string(), state: z.string() }),
  keys: ["number"],
  select: (b) => github.listPRs({ state: b.one("state") }),   // WHERE pushes down
}));
mountDatabase(agent, { db });   // folds execute_sql + explain_sql and primes the prompt
\`\`\`

The model then discovers via \`information_schema\`, invokes by querying a table,
composes with JOINs, acts with INSERT/UPDATE/DELETE, and can stage several
writes inside BEGIN … COMMIT/ROLLBACK as a real dry run.

\`glove-sql\` standalone:

\`\`\`ts
import { MemoryBackend } from "glove-sql";
const be = await MemoryBackend.create();
await be.exec("CREATE TABLE orders (id int, total numeric, region text)");
const { rows } = await be.query("SELECT region, sum(total) FROM orders GROUP BY region");
\`\`\`

### glove-js / glove-python / glove-lisp

\`\`\`ts
import { JsSession, mountJs } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = JsSession.create();
session.registerAll(await fnsFromMcp(githubConn));   // github__list_pull_requests, …
mountJs(agent, { session });                          // execute_js + discovery tools
// mountJs(agent, { session, frame: "workflow" })  → execute_js_workflow framing
\`\`\`

Same for \`PySession\`/\`mountPy\` (\`execute_python\`) and the Lisp surface
(\`execute_lisp\`). Author functions with \`defineFn\` / \`fnFromTool\` / \`fnsFromMcp\`
from \`glove-scratchpad\`. A \`__\` in a name is a namespace:
\`github__list_pull_requests\` also binds as \`github.list_pull_requests\`. Calling an
effectful function fires it immediately — there is no staging on the JS/Python
surfaces.

### glove-working-environment

\`\`\`ts
import { createWorkingEnvironment, mountWorkingEnvironment, hostDirectory } from "glove-working-environment";
import { documents } from "glove-env-documents";

const env = await createWorkingEnvironment({ stdlib: [documents()], limits: { runTimeoutMs: 30_000 } });
await env.mount("./q3.xlsx", "/inbox/q3.xlsx");
mountWorkingEnvironment(agent, { env });
const out = await env.export("/out/**");    // [{ path, bytes }]
const snap = await env.snapshot();          // checkpoint; restore with fromSnapshot(snap)
\`\`\`

Tree: \`/inbox\` inputs, \`/scripts\` the agent's script library (+ generated .d.ts),
\`/skills\` worked recipes, \`/std\` adapter types and docs, \`/tmp\` intermediates,
\`/out\` deliverables, \`/.env\` history. Every script under \`/scripts\` MUST
default-export a function; validation happens at write time. Scripts may import
relative VFS paths and \`env:*\` modules only — no network, no host fs, no process.

Backing the tree: \`inMemoryFs()\` (default), \`hostDirectory(dir)\` (copy-on-write
over a real directory; \`commit()\` / \`discard()\`), \`fromSnapshot(snap)\`, or
\`cachedRemote(store)\` for object storage.

Exposing a library to the model — the shape picks the route, and the wrong route
fails quietly:

| library shape | route | call style |
| --- | --- | --- |
| does I/O — reads/writes files, calls out | \`defineAdapter\` | async |
| stateful builder — \`new X()\`, chaining, terminal save | \`defineBuilder\` / \`defineBuilders\` | async |
| pure computation — no I/O, no state | \`definePureModule\` | synchronous |
| a capability, not a library — MCP server, model, HTTP API | \`defineTools\` | async |

\`definePureModule({ name, from, description, pick })\` imports the package inside
the worker and binds it directly, so calls stay synchronous. \`pick\` is the
sandbox boundary, not a convenience — never pick a string-to-code member (e.g.
\`_.template\`, which compiles with \`Function(source)\`).

\`defineTools({ name, description, fns })\` takes the same \`ToolFn\` catalog as
\`glove-scratchpad/fns\`, so \`fnsFromMcp(conn)\` mounts an MCP server as an
\`env:\` module with no adapter written. A verb puts every answer in the context
window; the same capability as a function lets a script loop and return one line.

Host options gate verbs: \`vision\` adds \`view_image\`, \`onPresent\` adds
\`present\` (deliver one file from \`/out\`, with a caption and a media type),
\`readOnlyPaths: ["/corpus"]\` fences subtrees the agent may read but never edit —
enforced at the single core mutation gateway, so verbs, \`env:fs\` and adapter
handles are all covered, while \`env.mount()\` deliberately still writes there.

\`glove-env-motion\` renders a React scene to video — \`render(scene, '/out/x.mp4',
{ durationSeconds })\` or \`still(scene, '/out/x.png', { frame })\`. Mount it WITH
\`limits: MOTION_LIMITS\`; a frame is a browser screenshot, and a render that
cannot fit \`runTimeoutMs\` is refused up front rather than timing out. Time is
replaced rather than measured, so two runs of a scene are byte-identical, and
React Native Reanimated scenes render unchanged. \`glove-motion-doctor\` reports
what a host is missing, with the fix per row.

### glove-egress

\`\`\`ts
import { egressFns, guardEffectFns, DEFAULT_EGRESS_POLICY, BoundaryMeter } from "glove-egress";
session.registerAll(egressFns(DEFAULT_EGRESS_POLICY));   // assert/count/choose/bucket/report
const guarded = guardEffectFns(catalog, DEFAULT_EGRESS_POLICY, onBlock);
\`\`\`

Programs must end in a bounded decision; a per-session min-entropy bit budget
caps cumulative disclosure.

### glove-image

\`\`\`ts
import {
  mountImage, InMemoryImageAssetStore, InMemoryImageLibrary,
  expandCharacters, expandScenes, styleDirective, llmEnhance,
  openrouterImages, UsageMeter,
} from "glove-image";

const meter = new UsageMeter();

await mountImage(glove, {
  adapter: openrouterImages(),            // OPENROUTER_API_KEY; google/gemini-2.5-flash-image
  assets: new InMemoryImageAssetStore(),  // BYO ImageAssetStore in production
  library: new InMemoryImageLibrary(),    // BYO ImageLibraryAdapter in production
  model: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),
  pipeline: [expandCharacters(), expandScenes(), styleDirective("gouache"), llmEnhance()],
  review: { vision: visionAdapter, rounds: 1 },   // optional: describe + self-critique
  usage: meter,                                    // optional: read spend host-side
});
\`\`\`

Folds \`glove_image_generate\`, \`_edit\`, \`_regenerate\`, \`_import\`, \`_describe\`,
\`_asset_list\`, \`_assemble\`, \`_usage\`, plus \`_character_*\` / \`_scene_*\` CRUD
(writes only when \`curate\` is true, the default).

Key facts:
- A generation NEVER sends raw text to the image model. It builds a \`PromptDraft\`
  and runs it through the \`PromptEnhancer[]\` pipeline; \`fitToModel()\` is always
  appended last and clamps the request to the adapter's declared capabilities,
  writing each degradation into the trace (surfaced as \`data.degradations\`).
- Characters/scenes are referenced by NAME in tool ARGS (\`characters: ["mira"]\`),
  never inline syntax. \`CharacterDef.appearance\` and \`SceneDef.setting\` are
  spliced VERBATIM — \`llmEnhance\` is instructed not to reword them.
- The model works in asset ids. Bytes never enter tool \`data\`; thumbnails ride
  \`renderData\`.
- Every derived asset carries a \`Recipe\` (intent, final prompt, trace, parent,
  usage) — \`glove_image_regenerate({ asset, tweak })\` replays it.
- \`glove_image_assemble\` needs the OPTIONAL \`sharp\` peer; it refuses with an
  install hint when absent.
- Cost: \`ImageUsage { requests, tokens_in, tokens_out, cost_usd? }\` per call
  (\`data.usage\`), per asset (\`Recipe.usage\`), per session (\`UsageMeter\` +
  \`glove_image_usage\`), plus an \`onUsage(source, usage)\` callback. OpenRouter
  reports real USD.
- Vision is OPT-IN via \`review\` — without it \`describe\` returns metadata only
  and generations are not critiqued.

### glove-mesh

\`\`\`ts
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

await mountMesh(planner, {
  adapter: new InMemoryMeshAdapter(new MeshNetwork()),
  identity: { id: "planner", name: "Planner", description: "Delegates to specialists." },
});
\`\`\`

Folds \`glove_mesh_send_message\`, \`_broadcast\`, \`_list_agents\`, \`_acknowledge\`.
The store must support the inbox methods; inbound messages land in the inbox and
surface on the agent's next turn.

### glove-continuum-signal

\`\`\`ts
import { agent, z, ContinuumRunner, MemoryAdapter } from "glove-continuum-signal";

export const baker = agent("pizza-baker")
  .input(z.object({ orderId: z.string() }))
  .triggered()            // or .concurrent() for a warm, long-lived subprocess
  .timeout(60_000)
  .retries(2)
  .every("5m").withInput({ orderId: "tick" })
  .factory(async (ctx) => buildGlove(ctx));

const runner = new ContinuumRunner({ adapter: new MemoryAdapter() });
runner.registerAgent(baker, import.meta.url);
await runner.start();
\`\`\`

### glove-mcp

\`\`\`ts
import { mountMcp } from "glove-mcp";

await mountMcp(runnable, {
  adapter: myAdapter,   // getActive / activate / deactivate / getAccessToken
  entries: [{ id: "notion", name: "Notion", description: "…", url: "https://mcp.notion.com/mcp", tags: ["docs"] }],
  clientInfo: { name: "my-app", version: "1.0.0" },
});
\`\`\`

The only auth seam is \`McpAdapter.getAccessToken(id)\`. For the spec OAuth flow,
\`glove-mcp/oauth\` ships an opt-in \`runMcpOAuth\` runner and reference stores. A
\`discovermcp\` subagent lets the model activate servers mid-conversation.

## 9. Voice

Cascade (\`glove-voice\`):

\`\`\`ts
import { createElevenLabsAdapters } from "glove-voice";
import { useGloveVoice } from "glove-react/voice";

const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token),
  getTTSToken: () => fetch("/api/voice/tts-token").then(r => r.json()).then(d => d.token),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});

const voice = useGloveVoice({ runnable, voice: { stt, createTTS } });
// voice.mode: "idle" | "listening" | "thinking" | "speaking"
\`\`\`

Two turn modes: VAD (hands-free with barge-in) and Manual (push-to-talk). In VAD
mode mic audio is speech-gated — it only reaches the STT provider once the VAD
confirms speech, so background noise is never transcribed. Tokens are minted
server-side; API keys never reach the browser.

React Native / Expo: \`withNativeAudio({ stt, createTTS, vad })\` from
\`glove-voice-native\`, with \`SileroVADNativeAdapter\` for on-device VAD.

Realtime speech-to-speech (\`glove-voice-s2s\`):

\`\`\`ts
import { RealtimeAgent, createS2SAdapter, s2sDrivenModel } from "glove-voice-s2s";

const rt = new RealtimeAgent({ agent, adapter: createS2SAdapter({ provider: "openai" }) });
await rt.start();
rt.inject("the lookup finished", { respond: true });   // push an async result into the call
\`\`\`

Adapters declare \`mode: "device" | "transport"\`. Device owns the mic and plays
the reply (browser only); transport moves PCM only (the mode a server room
needs). On the voice path the provider owns the loop, so: \`requiresPermission\`
is NOT enforced, \`pushAndWait\` tools throw (exclude both via \`excludeTools\`), and
tool calls/transcripts are not persisted — use \`RealtimeAgent\` events
(\`user_said\`, \`agent_said\`, \`tool_started\`, \`tool_finished\`).

Avatars: \`attachAvatar(rt, avatar)\` with \`TavusEchoAdapter\` or
\`AnamPassthroughAdapter\` (\`glove-voice-avatar\`). LiveKit: \`LiveKitTransport\` +
\`attachRealtime(rt, transport)\` (\`glove-voice-livekit\`); with a LiveKit avatar,
set \`publishAgentAudio: false\` and \`{ agentAudio: false }\` so the voice is not
published twice.

## 10. Legacy deployment (Glovebox — deprecated)

Glovebox is retained for existing deployments. Build new agent runtimes,
working environments, and deployment systems with Glove Foundry.

\`\`\`ts
import { glovebox, rule, composite } from "glovebox-core";
import { agent } from "./my-agent";

export default glovebox.wrap(agent, {
  base: "glovebox/media",                  // base | media | docs | python | browser
  packages: { apt: ["ffmpeg"] },
  storage: { outputs: composite([rule.inline({ below: "1MB" }), rule.localServer({ ttl: "1h" })]) },
});
\`\`\`

\`\`\`bash
glovebox build ./glovebox.ts
docker run -p 8080:8080 -e GLOVEBOX_KEY="$(cat dist/glovebox.key)" my-app
\`\`\`

The deployed server exposes one authenticated WebSocket endpoint per session;
\`glovebox-client\` speaks to it. Files cross the wire as \`FileRef\`
(\`inline | url | server | s3 | gcs\`), never raw bytes.

## 11. Gotchas

- Tool \`description\` is the interface the model sees — write it for the model,
  not for a teammate.
- Whatever \`do()\` returns costs context on every later turn. Return small,
  structured data; put bulk in the display payload or a sandbox file.
- \`MemoryStore\` is in-process and disappears on restart. Implement
  \`StoreAdapter\` for durable sessions.
- \`pushAndWait\` suspends the tool. It needs a client that can resolve the slot
  — it throws on the S2S voice path.
- Mesh requires a store with inbox support.
- Prefer one \`execute_sql\` / \`execute_js\` surface over dozens of folded tools
  once a catalog gets large — it measurably improves accuracy and cost.

## 12. Where to read more

- Docs index: ${SITE_URL}/docs/intro
- Quickstart: ${SITE_URL}/docs/getting-started
- All packages: ${SITE_URL}/docs/packages
- Core API: ${SITE_URL}/docs/core
- Machine index: ${SITE_URL}/llms.txt
`;

export const LLMS_FULL = `${CORE_LLMS_FULL}\n\n${FOUNDRY_LLMS_FULL}`;
