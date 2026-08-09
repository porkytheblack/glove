import type { ReactNode } from "react";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "All Packages",
  description:
    "Every package Glove ships — what each one solves, how to install it, and the smallest snippet that uses it.",
};

function Pkg({
  name,
  tag,
  children,
}: {
  name: string;
  tag?: string;
  children?: ReactNode;
}) {
  return (
    <>
      {/* The tag sits outside the <h3> so the on-this-page rail reads the
          package name alone. */}
      <div className="pkg-head">
        <h3 id={name} className="pkg-name">
          {name}
        </h3>
        {tag && <span className="pkg-tag">{tag}</span>}
      </div>
      {children}
    </>
  );
}

export default function PackagesPage() {
  return (
    <div className="docs-content">
      <h1>All Packages</h1>

      <p>
        Glove is a monorepo of small, independently versioned packages. Nothing
        here is required except the runtime — you install the pieces the app
        actually needs, and each one has a single job. This page is the tour:
        what each package solves, how to install it, and the smallest snippet
        that puts it to work.
      </p>

      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          Everything below assumes you already have an agent — either a{" "}
          <code>Glove</code> builder or a built runnable. If not, start with the{" "}
          <a href="/docs/getting-started">Quickstart</a>. Deployment (
          <code>glovebox-*</code>) has its own guide and is only summarised
          here.
        </p>
      </div>

      <h2 id="the-map">The map</h2>

      <table>
        <thead>
          <tr>
            <th>Family</th>
            <th>Packages</th>
            <th>Use it when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Runtime</td>
            <td>
              <code>glove-core</code>, <code>glove-react</code>,{" "}
              <code>glove-next</code>
            </td>
            <td>Always — this is the framework.</td>
          </tr>
          <tr>
            <td>Voice</td>
            <td>
              <code>glove-voice</code>, <code>-native</code>, <code>-s2s</code>,{" "}
              <code>-avatar</code>, <code>-livekit</code>
            </td>
            <td>The interface is speech, not typing.</td>
          </tr>
          <tr>
            <td>Memory &amp; data</td>
            <td>
              <code>glove-memory</code>, <code>glove-scratchpad</code>,{" "}
              <code>glove-sql</code>
            </td>
            <td>
              The agent must remember, or must reason over more data than fits
              in context.
            </td>
          </tr>
          <tr>
            <td>Sandboxes</td>
            <td>
              <code>glove-working-environment</code>, <code>glove-env-*</code>
            </td>
            <td>
              The agent produces artifacts — documents, spreadsheets, decks,
              media.
            </td>
          </tr>
          <tr>
            <td>Code execution</td>
            <td>
              <code>glove-js</code>, <code>glove-python</code>,{" "}
              <code>glove-lisp</code>, <code>glove-egress</code>
            </td>
            <td>
              Dozens of tools would blow the context window, or data must not
              leak.
            </td>
          </tr>
          <tr>
            <td>Generative media</td>
            <td>
              <code>glove-image</code>
            </td>
            <td>
              The agent generates and refines images — recurring characters,
              scenes, references.
            </td>
          </tr>
          <tr>
            <td>Coordination</td>
            <td>
              <code>glove-mesh</code>, <code>glove-continuum-signal</code>
            </td>
            <td>More than one agent, or agents that run on a schedule.</td>
          </tr>
          <tr>
            <td>Integration</td>
            <td>
              <code>glove-mcp</code>
            </td>
            <td>You want tools you did not write.</td>
          </tr>
          <tr>
            <td>Deployment</td>
            <td>
              <code>glovebox-core</code>, <code>-kit</code>, <code>-client</code>
            </td>
            <td>Ship the agent as an isolated, addressable service.</td>
          </tr>
        </tbody>
      </table>

      {/* ============================================================ */}
      <h2 id="runtime">Runtime</h2>

      <Pkg name="glove-core" tag="the runtime">
        <p>
          The agent loop, tool execution, model adapters, the display manager,
          stores, subscribers, hooks, skills and subagents. Everything else in
          this list plugs into it. Works in Node and in the browser.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-core zod`}
        />
        <CodeBlock
          filename="agent.ts"
          language="typescript"
          code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

export const agent = new Glove({
  store: new MemoryStore("session-1"),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
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

await agent.processRequest("What's the weather in Tokyo?");`}
        />
        <p>
          → <a href="/docs/core">Core API reference</a> ·{" "}
          <a href="/docs/server-side">Server-side agents</a>
        </p>
      </Pkg>

      <Pkg name="glove-react" tag="React bindings">
        <p>
          Hooks and components for the client: <code>GloveClient</code>,{" "}
          <code>GloveProvider</code>, <code>useGlove</code>,{" "}
          <code>&lt;Render&gt;</code>, <code>defineTool</code> for typed tools
          and display props, plus <code>createRemoteStore</code>. Bundles{" "}
          <code>glove-core</code>.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-react zod`}
        />
        <CodeBlock
          filename="app/chat.tsx"
          language="tsx"
          code={`"use client";
import { useGlove, Render } from "glove-react";

export function Chat() {
  const glove = useGlove();
  return <Render glove={glove} renderMessage={({ entry }) => <p>{entry.text}</p>} />;
}`}
        />
        <p>
          → <a href="/docs/react">React reference</a> ·{" "}
          <a href="/docs/display-stack">Display stack</a>
        </p>
      </Pkg>

      <Pkg name="glove-next" tag="Next.js route handlers">
        <p>
          One function that turns a route into a streaming (SSE) chat endpoint,
          holding your provider key server-side. Supports every provider the
          core adapter factory does, plus prompt caching and reasoning options.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-next`}
        />
        <CodeBlock
          filename="app/api/chat/route.ts"
          language="typescript"
          code={`import { createChatHandler } from "glove-next";

export const POST = createChatHandler({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  cache: true,
});`}
        />
        <p>
          → <a href="/docs/next">Next.js reference</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="voice">Voice</h2>

      <Pkg name="glove-voice" tag="cascade pipeline">
        <p>
          The classic pipeline — VAD → STT → agent → TTS — with barge-in,
          push-to-talk, narration control and speech-gated noise robustness (mic
          audio only reaches the STT provider once the VAD confirms speech).
          ElevenLabs adapters ship in the box; the contracts are open.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-voice`}
        />
        <CodeBlock
          filename="app/voice.tsx"
          language="tsx"
          code={`import { createElevenLabsAdapters } from "glove-voice";
import { useGloveVoice } from "glove-react/voice";

const { stt, createTTS } = createElevenLabsAdapters({
  // Tokens are minted server-side — the API key never reaches the browser.
  getSTTToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token),
  getTTSToken: () => fetch("/api/voice/tts-token").then(r => r.json()).then(d => d.token),
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
});

const { runnable } = useGlove({ tools, sessionId });
const voice = useGloveVoice({ runnable, voice: { stt, createTTS } });
// voice.mode: "idle" | "listening" | "thinking" | "speaking"`}
        />
        <p>
          → <a href="/docs/voice">Voice guide</a>
        </p>
      </Pkg>

      <Pkg name="glove-voice-native" tag="React Native / Expo">
        <p>
          The pipeline is platform-neutral; only mic capture and playback are
          platform edges. This package supplies them for iOS and Android, backed
          by <code>react-native-audio-api</code> and{" "}
          <code>onnxruntime-react-native</code> (Silero VAD on-device).
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-voice-native`}
        />
        <CodeBlock
          filename="VoiceScreen.tsx"
          language="tsx"
          code={`import { withNativeAudio } from "glove-voice-native";
import { SileroVADNativeAdapter } from "glove-voice-native/silero-vad";

const vad = new SileroVADNativeAdapter();
await vad.init();

const voice = useGloveVoice({
  runnable,
  voice: withNativeAudio({ stt, createTTS, vad }),
});`}
        />
        <p>
          → <a href="/docs/voice#react-native">React Native &amp; Expo</a>
        </p>
      </Pkg>

      <Pkg name="glove-voice-s2s" tag="speech-to-speech">
        <p>
          Run a built Glove agent directly on a realtime speech-to-speech model
          (OpenAI Realtime, Gemini Live). The cascade&apos;s ~1.3–1.6s
          voice-to-voice collapses to ~500–800ms, turn-taking is decided by the
          model listening, and your tools run unchanged through the same{" "}
          <code>Tool.run</code>.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-voice-s2s`}
        />
        <CodeBlock
          filename="realtime.ts"
          language="typescript"
          code={`import { RealtimeAgent, createS2SAdapter } from "glove-voice-s2s";

// Provider/model/credentials from args, falling back to S2S_* env vars.
const adapter = createS2SAdapter({ provider: "openai" });

const rt = new RealtimeAgent({ agent, adapter });
await rt.start();

// Push a result in from elsewhere and have the agent speak about it.
rt.inject("The order shipped.", { respond: true });`}
        />
        <p>
          → <a href="/docs/realtime-voice">Realtime voice &amp; avatars</a>
        </p>
      </Pkg>

      <Pkg name="glove-voice-avatar" tag="a face over the voice">
        <p>
          An avatar provider is a lip-sync renderer over an audio stream — the
          same shape as the PCM a transport-mode S2S adapter already emits.{" "}
          <code>attachAvatar</code> is the one-call bridge; Tavus (echo mode)
          and Anam (audio passthrough) adapters ship, both passing the
          conformance suite.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-voice-avatar`}
        />
        <CodeBlock
          filename="avatar.ts"
          language="typescript"
          code={`import { TavusEchoAdapter, attachAvatar } from "glove-voice-avatar";

const avatar = new TavusEchoAdapter({
  apiKey: process.env.TAVUS_API_KEY!,   // server-side only
  faceId: process.env.TAVUS_FACE_ID!,
  // palId omitted → a minimal echo PAL is ensured, so the ONLY voice is the agent's.
  sendInteraction: (event) => duct.send({ t: "avatar_interaction", event }),
});

const detach = await attachAvatar(rt, avatar);
avatar.view; // { kind: "webrtc-room", url: … } — hand this to the client`}
        />
        <p>
          → <a href="/docs/realtime-voice#avatars">Avatars</a>
        </p>
      </Pkg>

      <Pkg name="glove-voice-livekit" tag="LiveKit transport + avatars">
        <p>
          LiveKit as an adapter rather than a rewrite. <code>LiveKitTransport</code>{" "}
          is the room leg — join, publish the agent&apos;s voice as a paced
          track, feed remote mics back as PCM, carry JSON on the data channel,
          with server-authoritative barge-in. The LiveKit Tavus/Anam avatars
          join your room as a second participant.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-voice-livekit`}
        />
        <CodeBlock
          filename="room.ts"
          language="typescript"
          code={`import { LiveKitTransport, attachRealtime, mintParticipantToken } from "glove-voice-livekit";

const transport = new LiveKitTransport({
  url: process.env.LIVEKIT_URL!,
  token: await mintParticipantToken(
    { apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET! },
    { roomName: "call-42", identity: "agent" },
  ),
});

await transport.connect();
attachRealtime(rt, transport);   // mics → model, model → track, interrupt → flush
await rt.start();`}
        />
        <p>
          → <a href="/docs/realtime-voice#livekit">LiveKit</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="memory-and-data">Memory &amp; data</h2>

      <Pkg name="glove-memory" tag="long-term memory">
        <p>
          Five orthogonal subsystems, each an independent
          bring-your-own-storage adapter with its own tool surface: an{" "}
          <strong>entity</strong> graph (typed nodes with deterministic identity
          keys), <strong>episodic</strong> memory (an append-only, time-indexed,
          semantically searchable timeline), <strong>resources</strong> (a
          POSIX-style virtual filesystem the agent walks with{" "}
          <code>ls</code>/<code>read</code>/<code>grep</code>),{" "}
          <strong>context</strong> (the user&apos;s standing brief, injected into
          the system prompt every turn), and{" "}
          <a href="/docs/forms">
            <strong>forms</strong>
          </a>{" "}
          (structured collection over a conversation — Zod-authored definitions,
          lazily loaded, with colocated executors).
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-memory`}
        />
        <CodeBlock
          filename="memory.ts"
          language="typescript"
          code={`import {
  useMemoryReader, useEpisodicReader, useContext,
  InMemoryEntityAdapter, InMemoryEpisodicAdapter, InMemoryContextAdapter,
} from "glove-memory";

// Reference in-memory adapters ship for dev/test; implement the contracts
// (EntityMemoryAdapter, EpisodicMemoryAdapter, …) against your own storage.
const entities = new InMemoryEntityAdapter({ schema: ontology });

useMemoryReader(agent, entities);                      // read-only entity tools
useEpisodicReader(agent, new InMemoryEpisodicAdapter());
useContext(agent, new InMemoryContextAdapter());       // injected every turn

// Writes belong to a separate curator instance:
// useMemoryCurator(curator, entities);`}
        />
        <CodeBlock
          filename="forms.ts"
          language="typescript"
          code={`import { FormRegistry } from "glove-memory/forms";
import { useFormRunner, InMemoryFormAdapter } from "glove-memory";

const registry = new FormRegistry().register("travel-claim", {
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  load: () => import("./forms/travel-claim").then((m) => m.travelClaim),
});

// Folds seven glove_form_* tools and injects the one-line tier-0 status
// into the system prompt each turn.
const { runner } = useFormRunner(agent, new InMemoryFormAdapter({ schema }), {
  registry,
  subject: conversationId,
});`}
        />
        <p>
          The recommended shape is <em>not</em> to hang every memory tool off
          the main agent: build one subagent per retrieval task with{" "}
          <code>defineSubAgent</code> so each attaches only the adapter slice it
          needs and token cost scales with role, not with ontology size. Writes
          belong to a separate curator instance running over conversation
          history.
        </p>
        <p>
          → <a href="/docs/memory">Memory reference</a> ·{" "}
          <a href="/docs/memory/why">Why Memory</a>
        </p>
      </Pkg>

      <Pkg name="glove-scratchpad" tag="tools as a database">
        <p>
          A database emulator for LLM tool use. Resources become tables and the
          agent drives everything through one <code>execute_sql</code> tool:{" "}
          <code>information_schema</code> is discovery, <code>WHERE</code>{" "}
          clauses push arguments down to your handlers, transactions stage
          outbound effects as a real dry-run, and every statement is parsed
          before any tool runs. Benchmarked at up to 35× less context than
          equivalent tool definitions.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-scratchpad`}
        />
        <CodeBlock
          filename="scratchpad.ts"
          language="typescript"
          code={`import { Database, defineResource, mountDatabase } from "glove-scratchpad";
import { z } from "zod";

const db = await Database.create({ policy: { writes: true } });

db.register(defineResource({
  name: "github_pull_requests",
  volatility: "volatile",
  schema: z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string().describe("open | merged | closed"),
  }),
  keys: ["number"],
  // WHERE state = 'open' arrives as a binding — an argument, not a post-filter.
  select: (b) => github.listPRs({ state: b.one("state") }),
}));

mountDatabase(agent, { db });   // folds execute_sql + explain_sql, primes the prompt`}
        />
        <p>
          → <a href="/docs/scratchpad">Scratchpad guide</a>
        </p>
      </Pkg>

      <Pkg name="glove-sql" tag="the SQL engine">
        <p>
          A zero-dependency, pure-JS Postgres-subset engine: runtime-built
          tables, joins, CTEs, set operations, subqueries and window functions,
          serialisable to bytes. It is the default backend for the scratchpad,
          and usable on its own wherever you want SQL without a database.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-sql`}
        />
        <CodeBlock
          filename="sql.ts"
          language="typescript"
          code={`import { MemoryBackend } from "glove-sql";

const be = await MemoryBackend.create();
await be.exec(\`CREATE TABLE orders (id int, total numeric, region text)\`);
await be.exec(\`INSERT INTO orders VALUES (1, 42.00, 'emea')\`);

const { rows } = await be.query(
  \`SELECT region, sum(total) AS revenue FROM orders GROUP BY region\`,
);

const bytes = await be.dump();   // serialise the whole database`}
        />
        <p>
          → <a href="/docs/sql">SQL engine reference</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="sandboxes">Sandboxes</h2>

      <Pkg name="glove-working-environment" tag="persistent VFS">
        <p>
          A small, fast, in-memory sandboxed working environment: a virtual
          filesystem where state accumulates across tool calls. The agent writes
          scripts, runs them, inspects intermediates and iterates — with no
          networking, no host filesystem and no process spawning, because
          scripts only see the capabilities you inject. Zero-dependency core.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-working-environment`}
        />
        <CodeBlock
          filename="env.ts"
          language="typescript"
          code={`import { createWorkingEnvironment, mountWorkingEnvironment } from "glove-working-environment";
import { spreadsheets } from "glove-env-spreadsheets";

const env = await createWorkingEnvironment({
  stdlib: [spreadsheets()],
  limits: { runTimeoutMs: 30_000 },
});

await env.mount("./q3.xlsx", "/inbox/q3.xlsx");   // host-side door
mountWorkingEnvironment(agent, { env });          // model-facing verbs + preamble

const deliverables = await env.export("/out/**"); // → [{ path, bytes }]`}
        />
        <p>
          Back the tree with memory, a real directory (<code>hostDirectory</code>,
          copy-on-write), a snapshot, or object storage (<code>cachedRemote</code>
          ). Expose your own libraries to the model with{" "}
          <code>defineAdapter</code> (I/O), <code>defineBuilder</code> (stateful
          builder APIs), or <code>definePureModule</code> (pure, synchronous
          computation) — and your own <em>capabilities</em>, an MCP server or a
          plain async function, with <code>defineTools</code>.
        </p>
        <p>
          → <a href="/docs/working-environment">Working environment guide</a>
        </p>
      </Pkg>

      <Pkg name="glove-env-*" tag="stdlib adapters">
        <p>
          An adapter bridges a real host library into the tree; the model
          experiences it as a typed importable module plus docs at{" "}
          <code>/std/&lt;name&gt;/</code>. Install only the formats your agent
          handles.
        </p>
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Module</th>
              <th>Gives the model</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>glove-env-documents</code>
              </td>
              <td>
                <code>env:documents</code>
              </td>
              <td>
                One document spec → PDF <em>and</em> DOCX; describe / merge /
                split / stamp; text extraction
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-spreadsheets</code>
              </td>
              <td>
                <code>env:spreadsheets</code>
              </td>
              <td>
                <code>.xlsx</code> as plain-JSON records; write, append, CSV
                bridging, plus exceljs&apos;s own <code>Workbook</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-images</code>
              </td>
              <td>
                <code>env:images</code>
              </td>
              <td>
                Describe without decoding; resize / convert / crop / rotate /
                composite / contact sheets
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-slides</code>
              </td>
              <td>
                <code>env:slides</code>
              </td>
              <td>
                PowerPoint decks from a spec, read back independently — outline,
                slide text, notes
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-archives</code>
              </td>
              <td>
                <code>env:archives</code>
              </td>
              <td>
                zip / tar / tar.gz in and out, traversal- and bomb-safe. No
                dependencies
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-media</code>
              </td>
              <td>
                <code>env:media</code>
              </td>
              <td>
                Video and audio via ffmpeg: describe, thumbnail, frames, clip,
                concat, transcode
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-render</code>
              </td>
              <td>
                <code>env:render</code>
              </td>
              <td>
                Rasterize a PDF, deck or Word file to page PNGs — so the agent
                can look at what it made
              </td>
            </tr>
            <tr>
              <td>
                <code>glove-env-motion</code>
              </td>
              <td>
                <code>env:motion</code>
              </td>
              <td>
                A React scene → mp4, GIF, PNG frames or a still, rendered
                deterministically. Reanimated scenes work unchanged
              </td>
            </tr>
          </tbody>
        </table>
        <CodeBlock
          filename="env.ts"
          language="typescript"
          code={`import { documents } from "glove-env-documents";
import { images } from "glove-env-images";

const env = await createWorkingEnvironment({ stdlib: [documents(), images()] });`}
        />
        <p>
          → <a href="/docs/working-environment#adapters">Stdlib adapters</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="code-execution-pkgs">Code execution</h2>

      <p>
        Three surfaces over the <em>same</em> <code>ToolFn</code> catalog — one
        set of functions mounts on any of them unchanged. Pick the language your
        models are most fluent in.
      </p>

      <Pkg name="glove-js" tag="one execute_js tool">
        <p>
          A sandboxed JavaScript interpreter (acorn parse → whitelist validation
          → fuel-budgeted evaluation). The model discovers capabilities in-band,
          keeps big intermediates in the REPL instead of its context, and can
          branch — decide-and-act — inside a single call.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-js glove-scratchpad`}
        />
        <CodeBlock
          filename="js.ts"
          language="typescript"
          code={`import { JsSession, mountJs } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = JsSession.create();
session.registerAll(await fnsFromMcp(githubConn));  // github__list_pull_requests, …

mountJs(agent, { session });`}
        />
        <p>
          → <a href="/docs/code-execution">Code execution guide</a>
        </p>
      </Pkg>

      <Pkg name="glove-python" tag="one execute_python tool">
        <p>
          The same surface in Python — the language most models reach for when
          the task is “manipulate this data”. Keyword arguments, list
          comprehensions, f-strings; the same discovery tiers and the same
          off-context data flow.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-python glove-scratchpad`}
        />
        <CodeBlock
          filename="py.ts"
          language="typescript"
          code={`import { PySession, mountPy } from "glove-python";

const session = PySession.create();
session.registerAll(await fnsFromMcp(githubConn));

mountPy(agent, { session });`}
        />
      </Pkg>

      <Pkg name="glove-lisp" tag="one execute_lisp tool">
        <p>
          A tiny Clojure-flavored Lisp over the same catalog, plus the
          scratchpad&apos;s <code>ResourceTable</code> contract — so it can also
          stage several outbound effects, preview them, and{" "}
          <code>commit!</code> or <code>rollback!</code> as a real dry run.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-lisp glove-scratchpad`}
        />
        <CodeBlock
          filename="agent-program.clj"
          language="clojure"
          code={`;; What the model writes inside execute_lisp
(def prs (github_pull_requests {:state "open"}))   ; 320 rows stay in the REPL
(if (empty? (pagerduty_incidents {:urgency "high"}))
  (insert! :slack_messages {:channel "ops" :text "All clear."})
  (insert! :emails {:to_addr "oncall@acme.io" :subject "Incidents live"}))`}
        />
      </Pkg>

      <Pkg name="glove-egress" tag="measured privacy boundary">
        <p>
          The one-eval-tool boundary already makes an agent context-efficient.
          This package makes it a <em>privacy</em> boundary and gives you the
          instruments to measure it: quantitative-information-flow metering,
          an enforced egress gate where programs must end in a bounded decision,
          and red-team extraction simulation.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-egress`}
        />
        <CodeBlock
          filename="egress.ts"
          language="typescript"
          code={`import { egressFns, guardEffectFns, DEFAULT_EGRESS_POLICY, BoundaryMeter } from "glove-egress";

session.registerAll(egressFns(DEFAULT_EGRESS_POLICY));  // assert/count/choose/bucket/report
const guarded = guardEffectFns(catalog, DEFAULT_EGRESS_POLICY, onBlock);

const meter = new BoundaryMeter();
meter.cross("assertion", true, { decisionSpace: 2 });
meter.report(canaries);  // what actually crossed`}
        />
        <p>
          → <a href="/docs/egress">Egress control</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="generative-media">Generative media</h2>

      <Pkg name="glove-image" tag="agentic image generation">
        <p>
          Image generation as a workflow rather than a single call: a prompt
          pipeline of <em>enhancer inbetweens</em>, durable characters and
          scenes spliced verbatim into every prompt, reference images with
          roles, editing, deterministic assembly, an optional vision model to
          review its own output, and per-call cost tracking. The image model is
          an adapter you bring.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-image`}
        />
        <CodeBlock
          filename="image.ts"
          language="typescript"
          code={`import {
  mountImage,
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  expandCharacters,
  expandScenes,
  styleDirective,
  openrouterImages,
} from "glove-image";

await mountImage(glove, {
  adapter: openrouterImages(),               // OPENROUTER_API_KEY
  assets: new InMemoryImageAssetStore(),
  library: new InMemoryImageLibrary(),
  pipeline: [expandCharacters(), expandScenes(), styleDirective("gouache, muted palette")],
});

// The agent then works in asset ids:
//   glove_image_character_save({ name: "mira", appearance: "..." })
//   glove_image_generate({ intent: "Mira at the harbor", characters: ["mira"] })
//   glove_image_regenerate({ asset: "img_...", tweak: "at dusk" })`}
        />
        <p>
          → <a href="/docs/image">Image workflows guide</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="coordination">Coordination</h2>

      <Pkg name="glove-mesh" tag="agents talking">
        <p>
          Direct, broadcast and acknowledged messaging between agents, riding
          the same inbox primitive the core already has, over a transport you
          bring (in-process, Redis, a queue, HTTP).
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-mesh`}
        />
        <CodeBlock
          filename="mesh.ts"
          language="typescript"
          code={`import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

const network = new MeshNetwork();

await mountMesh(planner, {
  adapter: new InMemoryMeshAdapter(network),
  identity: {
    id: "planner",
    name: "Planner",
    description: "Breaks work down and hands it to specialists.",
    capabilities: ["planning"],
  },
});

// Folds glove_mesh_send_message / _broadcast / _list_agents / _acknowledge.
// Inbound messages land in this agent's inbox and surface on its next turn —
// so the store must support the inbox methods.`}
        />
        <p>
          → <a href="/docs/mesh">Mesh guide</a> ·{" "}
          <a href="/docs/inbox">The inbox</a>
        </p>
      </Pkg>

      <Pkg name="glove-continuum-signal" tag="subprocess runtime">
        <p>
          Discovery, supervision, observability and IPC for agents running as
          subprocesses. <strong>Triggered</strong> agents are cold and wake per
          event (a call, a schedule fire, an inbound mesh message), resume their
          persistent store, run a turn and exit. <strong>Concurrent</strong>{" "}
          agents stay warm and are notified inline.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-continuum-signal`}
        />
        <CodeBlock
          filename="agents/baker.ts"
          language="typescript"
          code={`import { agent, z, ContinuumRunner, MemoryAdapter } from "glove-continuum-signal";

export const pizzaBaker = agent("pizza-baker")
  .input(z.object({ orderId: z.string() }))
  .triggered()
  .timeout(60_000)
  .retries(2)
  .every("5m").withInput({ orderId: "tick" })
  .factory(async (ctx) => buildGlove(ctx));

const runner = new ContinuumRunner({ adapter: new MemoryAdapter() });
runner.registerAgent(pizzaBaker, import.meta.url);
await runner.start();`}
        />
        <p>
          → <a href="/docs/continuum">Continuum guide</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="integration">Integration</h2>

      <Pkg name="glove-mcp" tag="Model Context Protocol">
        <p>
          Bridge any MCP server&apos;s tools into an agent as first-class tools.
          A <code>discovermcp</code> subagent lets the model find and activate
          servers from a catalogue mid-conversation. The framework&apos;s only
          auth seam is <code>getAccessToken(id)</code> — for the spec OAuth
          flow, <code>glove-mcp/oauth</code> ships an opt-in runner and
          reference stores.
        </p>
        <CodeBlock
          filename="terminal"
          language="bash"
          code={`pnpm add glove-mcp`}
        />
        <CodeBlock
          filename="mcp.ts"
          language="typescript"
          code={`import { mountMcp } from "glove-mcp";

await mountMcp(runnable, {
  adapter: myAdapter,          // getActive / activate / deactivate / getAccessToken
  entries: [{
    id: "notion",
    name: "Notion",
    description: "Search, read, and edit pages in a Notion workspace.",
    url: "https://mcp.notion.com/mcp",
    tags: ["docs", "notes", "wiki"],
  }],
  clientInfo: { name: "my-app", version: "1.0.0" },
});`}
        />
        <p>
          → <a href="/docs/mcp">MCP guide</a>
        </p>
      </Pkg>

      {/* ============================================================ */}
      <h2 id="deployment">Deployment</h2>

      <p>
        <code>glovebox-core</code> (authoring kit + <code>glovebox build</code>{" "}
        CLI), <code>glovebox-kit</code> (the in-container runtime) and{" "}
        <code>glovebox-client</code> (the client SDK) package an agent as an
        isolated, network-addressable service: one authenticated WebSocket
        endpoint per session, files crossing the wire as <code>FileRef</code>{" "}
        rather than raw bytes, and a storage policy DSL that routes payloads by
        size.
      </p>

      <p>
        It is a bigger surface than the rest of this page and has a guide of its
        own → <a href="/docs/glovebox">Glovebox</a>, with a worked example in
        the <a href="/docs/showcase/glovebox">showcase</a>.
      </p>

      {/* ============================================================ */}
      <h2 id="deprecated">Deprecated</h2>

      <Pkg name="glove-sqlite" tag="deprecated">
        <p>
          The SQLite <code>StoreAdapter</code>. Still published and still works,
          but it receives no new features — implement{" "}
          <code>StoreAdapter</code> against whatever storage your app already
          runs instead. The contract is small and documented in the{" "}
          <a href="/docs/core">Core API reference</a>.
        </p>
      </Pkg>
    </div>
  );
}
