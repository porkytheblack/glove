import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Persistence",
  description:
    "Foundry runtime data, Glove transcripts, structured memory and the VFS persist separately. Configure all four with file, SQLite or custom adapters.",
};

export default function PersistencePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Persistence</span>
      <h1>Persistence</h1>
      <p className="blog-lede">
        A Foundry app keeps state in four separate places, and each one has its own
        adapter. Persisting one does not persist the others: a durable data adapter
        does not make an in-memory transcript store durable, and neither saves an
        agent&apos;s files. The starter templates persist none of the four.
      </p>

      <h2 id="four-boundaries">Four boundaries</h2>
      <table>
        <thead>
          <tr><th>What</th><th>Configured by</th><th>Starter default</th><th>Production options</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1. Foundry runtime data</strong>: agent instances, conversation records, playbook subscriptions, inbound delivery claims, schedule/sleep activations, workspace entries, shared inbox, tasks, environment values, VFS snapshots</td>
            <td><code>defineApplication({"{ data }"})</code>, a <code>FoundryDataAdapter</code></td>
            <td><code>MemoryFoundryDataAdapter</code> (a fresh one is used when <code>data</code> is omitted)</td>
            <td><code>FileFoundryDataAdapter</code> on one host; your own transactional adapter for several hosts</td>
          </tr>
          <tr>
            <td><strong>2. Glove conversation transcripts</strong>: the exact <code>Message</code> history, turn and token counters</td>
            <td><code>defineAgent({"{ store }"})</code> or <code>defineApplication({"{ conversationStore }"})</code>, a Glove <code>StoreAdapter</code></td>
            <td><code>new MemoryStore(...)</code></td>
            <td>A durable <code>StoreAdapter</code> you provide (example below). <code>glove-sqlite</code>’s <code>SqliteStore</code> exists but is deprecated</td>
          </tr>
          <tr>
            <td><strong>3. Structured memory</strong>: entities, episodes, resources, pinned context, goals, facts, forms</td>
            <td>Adapters returned by a <code>defineMemory</code> profile (or <code>goals</code>/<code>facts</code>/<code>forms</code>)</td>
            <td><code>InMemoryContextAdapter</code> (travel concierge)</td>
            <td><code>createSqliteMemoryAdapters</code> from <code>glove-memory/sqlite</code> (Node 22.13+, single host) or your own adapters</td>
          </tr>
          <tr>
            <td><strong>4. Working-environment VFS</strong>: files the agent writes</td>
            <td><code>defineWorkingEnvironment({"{ persistence }"})</code></td>
            <td>None: the VFS is discarded when the run ends</td>
            <td><code>foundryDataEnvironmentPersistence({"{ scope }"})</code>, or a native persistent <code>Vfs</code> such as <code>cachedRemote</code></td>
          </tr>
        </tbody>
      </table>

      <h2 id="process-model">Why in-memory state disappears between runs</h2>
      <p>
        Every run executes in its own job process under the managed execution daemon (see{" "}
        <Link href="/foundry/docs/deploy#execution-daemon">Deploy &amp; security</Link>). That
        process imports <code>foundry.application.ts</code> and the agent module again, so
        anything held in memory exists once per process:
      </p>
      <ul>
        <li>
          A <code>store</code> that returns <code>new MemoryStore(...)</code> starts every run
          with an empty history. The model sees only the current message, and the inspector’s
          Chat page cannot reload the transcript.
        </li>
        <li>
          With <code>MemoryFoundryDataAdapter</code>, writes an agent makes during a run
          (<code>glove_foundry_workspace</code>, inbox items, tasks, VFS snapshots) land in the
          job process’s copy. The control process, the inspector and the next run never see
          them. Instances and conversations created through the API live in the control
          process and survive until it stops.
        </li>
        <li>
          Development memory adapters such as <code>InMemoryContextAdapter</code> are recreated
          in every job process, so they do not carry anything from one run to the next.
        </li>
      </ul>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          The adapters below share state through files on disk, which every Foundry process on
          the host can open. That is what makes multi-turn history, workspace writes and VFS
          restores work, not only restarts.
        </p>
      </div>

      <h2 id="complete-example">A complete single-host setup</h2>
      <p>
        These five files persist all four boundaries under one data directory. They were run
        against a real runtime: history, workspace entries and VFS files carry across turns
        and across a full restart.
      </p>
      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        The <Link href="/foundry/docs/tutorial">tutorial</Link> uses a 25-line{" "}
        <code>FileStore</code> that saves messages only. <code>FileConversationStore</code>{" "}
        below is the fuller drop-in: it also persists turn and token counters, tasks and
        inbox items, so WebChat&apos;s counters and Glove&apos;s task tool survive between runs.
      </p></div>
      <CodeBlock filename="lib/data-dir.ts" language="typescript" code={`import { resolve } from "node:path";

/** Use an absolute path on a persistent volume in production. */
export const dataDir = resolve(process.env.FOUNDRY_DATA_DIR ?? ".data");`} />
      <CodeBlock filename="lib/conversation-store.ts" language="typescript" code={`import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MemoryStore,
  type InboxItem,
  type Message,
  type Task,
  type TokenConsumptionCounter,
} from "glove-core";

interface SavedConversation {
  readonly version: 1;
  readonly messages: Message[];
  readonly turns: number;
  readonly consumption: TokenConsumptionCounter;
  readonly tasks: Task[];
  readonly inbox: InboxItem[];
}

/**
 * One JSON file per conversation, rewritten atomically after every change.
 * Single host, one active run per conversation. Use a database-backed
 * StoreAdapter when several hosts or concurrent writers share transcripts.
 */
export class FileConversationStore extends MemoryStore {
  private constructor(identifier: string, private readonly file: string) {
    super(identifier);
  }

  static async open(directory: string, conversationId: string) {
    const name = createHash("sha256").update(conversationId).digest("hex");
    const store = new FileConversationStore(conversationId, join(directory, \`\${name}.json\`));
    await store.restore();
    return store;
  }

  private async restore(): Promise<void> {
    let saved: SavedConversation;
    try {
      saved = JSON.parse(await readFile(this.file, "utf8")) as SavedConversation;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    await super.appendMessages(saved.messages);
    await super.addTokens(saved.consumption);
    for (let turn = 0; turn < saved.turns; turn++) await super.incrementTurn();
    await super.addTasks(saved.tasks);
    for (const item of saved.inbox) await super.addInboxItem(item);
  }

  private async save(): Promise<void> {
    const saved: SavedConversation = {
      version: 1,
      messages: await this.getMessages(),
      turns: await this.getTurnCount(),
      consumption: await this.getTokenConsumption(),
      tasks: await this.getTasks(),
      inbox: await this.getInboxItems(),
    };
    const directory = join(this.file, "..");
    await mkdir(directory, { recursive: true });
    const temporary = \`\${this.file}.\${randomUUID()}.tmp\`;
    await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
    await rename(temporary, this.file);
  }

  override async appendMessages(messages: Message[]) { await super.appendMessages(messages); await this.save(); }
  override async addTokens(usage: TokenConsumptionCounter) { await super.addTokens(usage); await this.save(); }
  override async incrementTurn() { await super.incrementTurn(); await this.save(); }
  override async resetCounters() { await super.resetCounters(); await this.save(); }
  override async addTasks(tasks: Task[]) { await super.addTasks(tasks); await this.save(); }
  override async updateTask(id: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>) { await super.updateTask(id, updates); await this.save(); }
  override async addInboxItem(item: InboxItem) { await super.addInboxItem(item); await this.save(); }
  override async updateInboxItem(id: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>) { await super.updateInboxItem(id, updates); await this.save(); }
}`} />
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { join } from "node:path";
import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { FileConversationStore } from "./lib/conversation-store.js";
import { dataDir } from "./lib/data-dir.js";

export default defineApplication({
  name: "Support",
  // (1) Foundry runtime data: instances, conversations, schedules, workspace, VFS snapshots…
  data: new FileFoundryDataAdapter({ file: join(dataDir, "foundry.json") }),
  // (2) Glove transcripts for every agent that does not define its own \`store\`.
  conversationStore: ({ conversationId }) =>
    FileConversationStore.open(join(dataDir, "transcripts"), conversationId),
});`} />
      <CodeBlock filename="agents/support/memory/customer.memory.ts" language="typescript" code={`import { join } from "node:path";
import { Effect } from "effect";
import { defineMemory, foundryGuidanceSubject, type AgentDefinitionSurfaceContext } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { dataDir } from "../../../lib/data-dir.js";

const schema = new MemorySchema().defineEpisodeKind({
  name: "interaction",
  description: "A customer request or decision, with its source and date.",
});

// Namespace from trusted instance identity, never from model or user input.
const memoryFor = (context: AgentDefinitionSurfaceContext) =>
  createSqliteMemoryAdapters({
    file: join(dataDir, "memory.sqlite"),
    namespace: foundryGuidanceSubject(context, "instance"),
    schema,
  });

// (3) Structured memory, shared by every conversation of one instance.
export default defineMemory({
  description: "What we know about this customer across conversations",
  context: { adapter: (context) => Effect.sync(() => memoryFor(context).context) },
  episodic: {
    access: "curator",
    adapter: (context) => Effect.sync(() => memoryFor(context).episodic),
  },
});`} />
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import {
  composeAgent,
  defineAgent,
  defineWorkingEnvironment,
  foundryDataEnvironmentPersistence,
} from "glove-foundry";
import { claimTicket } from "./claim-ticket.js";
import customerMemory from "./memory/customer.memory.js";

// (4) Restored before every run and saved after it, one VFS per conversation.
const caseFiles = defineWorkingEnvironment({
  options: { limits: { maxVfsBytes: 8 * 1024 * 1024 } },
  persistence: foundryDataEnvironmentPersistence({ scope: "conversation" }),
});

export default defineAgent({
  description: "Answers customer questions and keeps case notes",
  // (3) A memory profile must be in the catalogue AND selected in \`memory\`.
  components: composeAgent(customerMemory),
  memory: [customerMemory],
  workingEnvironment: caseFiles,
  tools: (_agent, ctx) => [claimTicket(ctx)],
  // (2) No \`store\` here, so transcripts use the application's conversationStore.
  model: () =>
    createAdapter({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
      stream: true,
    }),
  systemPrompt: "You are a support agent. Keep running case notes in /case.md.",
});`} />
      <p>
        <code>claim-ticket.ts</code> is shown in{" "}
        <a href="#compare-and-set">compare-and-set</a>. Add the data directory to{" "}
        <code>.gitignore</code>. In a container, set <code>FOUNDRY_DATA_DIR</code> to a mounted
        volume (see the <Link href="/foundry/docs/deploy#container">container recipe</Link>).
      </p>

      <h2 id="data-adapters">Runtime data: memory vs file adapter</h2>
      <table>
        <thead><tr><th></th><th><code>MemoryFoundryDataAdapter</code></th><th><code>FileFoundryDataAdapter</code></th></tr></thead>
        <tbody>
          <tr><td>Survives restart</td><td>No</td><td>Yes</td></tr>
          <tr><td>Shared with job processes</td><td>No (one copy per process)</td><td>Yes, through the file</td></tr>
          <tr><td>Hosts</td><td>One process</td><td>One host; sibling processes coordinate with a lock</td></tr>
          <tr><td>Default identifier</td><td><code>foundry-memory-data</code></td><td><code>foundry-file:&lt;file&gt;</code></td></tr>
          <tr><td><code>compareAndSetWorkspaceEntry</code></td><td>Yes</td><td>Yes</td></tr>
          <tr><td>Use for</td><td>Tests and throwaway demos</td><td>Single-host deployments and serious local development</td></tr>
        </tbody>
      </table>
      <h3 id="file-adapter-options">FileFoundryDataAdapter options</h3>
      <table>
        <thead><tr><th>Option</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>file</code></td><td>required</td><td>Path of the JSON state file. Its directory is created if missing.</td></tr>
          <tr><td><code>identifier</code></td><td><code>foundry-file:&lt;file&gt;</code></td><td>Adapter identity.</td></tr>
          <tr><td><code>agents</code>, <code>conversations</code>, <code>subscriptions</code>, <code>activations</code>, <code>environment</code></td><td><code>[]</code></td><td>Seed records. A seed is inserted only when no record with that id (or, for environment values, scope + key) exists, so edits made at runtime are never overwritten.</td></tr>
          <tr><td><code>lockTimeoutMs</code></td><td><code>10_000</code></td><td>How long a write waits for another process holding <code>&lt;file&gt;.lock</code>.</td></tr>
          <tr><td><code>staleLockMs</code></td><td><code>30_000</code></td><td>Age after which a dead process’s lock file is removed.</td></tr>
        </tbody>
      </table>
      <p>
        <code>MemoryFoundryDataAdapter</code> accepts the same <code>identifier</code> and seed
        options. Seeds are how you ship a known instance with the code:
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { join } from "node:path";
import {
  FileFoundryDataAdapter,
  createConversation,
  defineAgentInstance,
  defineApplication,
} from "glove-foundry";
import support from "./agents/support/agent.js";
import { dataDir } from "./lib/data-dir.js";

export const supportInstance = defineAgentInstance(support, {
  id: "support-main",
  workspaceId: "support",
  context: { tier: "standard" },
});

export default defineApplication({
  name: "Support",
  data: new FileFoundryDataAdapter({
    file: join(dataDir, "foundry.json"),
    // Seeds are inserted only when no record with that id exists yet.
    agents: [supportInstance],
    conversations: [createConversation(supportInstance, { id: "support-main-chat" })],
    lockTimeoutMs: 10_000,
    staleLockMs: 30_000,
  }),
});`} />
      <p>How the file adapter writes:</p>
      <ul>
        <li>
          Every mutation takes an advisory lock (<code>&lt;file&gt;.lock</code>, created
          exclusively and holding the writer’s pid), reads the whole file, applies the change,
          writes a temporary file with mode <code>0600</code>, fsyncs it and renames it over the
          original. A crash leaves the old or the new file, never a torn one.
        </li>
        <li>
          Mutations within one process are also queued, so concurrent writes never race.
        </li>
        <li>
          The whole state, including base64 VFS snapshots, is one JSON document
          (<code>{"\"version\": 1"}</code>). Every write rewrites it, so keep VFS limits modest
          and expect write cost to grow with total state.
        </li>
        <li>
          It is a single-host adapter. Several hosts need a database adapter with real
          transactions.
        </li>
      </ul>

      <h2 id="custom-adapter">Writing a database adapter</h2>
      <p>
        Implement <code>FoundryDataAdapter</code> (exported from <code>glove-foundry</code>).
        Every method returns an <code>Effect</code> whose error channel is <code>unknown</code>.
        Records must round-trip through JSON.
      </p>
      <table>
        <thead><tr><th>Group</th><th>Methods</th><th>Contract</th></tr></thead>
        <tbody>
          <tr><td>Instances</td><td><code>getAgent</code>, <code>putAgent</code>, <code>listAgents(definitionId?)</code>, <code>provisionAgent</code></td><td><code>provisionAgent</code> must be atomic on <code>provisioningKey</code>: concurrent calls with one key return one instance. Rehydrate with <code>reconstructAgentInstance</code>.</td></tr>
          <tr><td>Subscriptions</td><td><code>getPlaybookSubscription</code>, <code>putPlaybookSubscription</code>, <code>deletePlaybookSubscription</code> (returns whether it existed), <code>listPlaybookSubscriptions(workspaceId?)</code></td><td>Rehydrate with <code>reconstructPlaybookSubscription</code>.</td></tr>
          <tr><td>Inbound delivery</td><td><code>getInboundDelivery</code>, <code>claimInboundDelivery</code>, <code>completeInboundDelivery(key, runIds)</code>, <code>releaseInboundDelivery</code></td><td>Claim is insert-if-absent: <code>true</code> only for the first caller. Complete fails when no claim exists. Release removes only a <code>pending</code> claim.</td></tr>
          <tr><td>Activations</td><td><code>getActivation</code>, <code>putActivation</code>, <code>listActivations(workspaceId?)</code></td><td>Schedule and sleep records; read at startup to re-arm work.</td></tr>
          <tr><td>Conversations</td><td><code>getConversation</code>, <code>putConversation</code>, <code>listConversations(agentId)</code></td><td>Records only; transcripts live in the store.</td></tr>
          <tr><td>Workspace</td><td><code>getWorkspaceEntry</code>, <code>putWorkspaceEntry</code>, <code>listWorkspaceEntries</code>, optional <code>compareAndSetWorkspaceEntry</code></td><td>Keyed by <code>(workspaceId, key)</code>; see below.</td></tr>
          <tr><td>VFS snapshots</td><td><code>getWorkingEnvironmentSnapshot(owner)</code>, <code>putWorkingEnvironmentSnapshot(owner, snapshot)</code></td><td>Keyed by owner scope, workspace, definition, agent and (for conversation scope) conversation. Never expose these as workspace entries.</td></tr>
          <tr><td>Inbox and tasks</td><td><code>putInboxItem</code>, <code>listInboxItems</code>, <code>putTask</code>, <code>listTasks</code></td><td>Upsert by id; list by workspace.</td></tr>
          <tr><td>Environment</td><td><code>listEnvironment({"{ workspaceId, agentId?, conversationId? }"})</code></td><td>Return workspace-scoped values plus agent- or conversation-scoped values matching the ids. Read-only through Foundry; never store secrets here.</td></tr>
        </tbody>
      </table>
      <p>The one method most likely to be written wrong is provisioning, because subscriptions call it concurrently:</p>
      <CodeBlock filename="lib/postgres-data.ts" language="typescript" code={`import { Effect } from "effect";
import {
  createAgentInstance,
  reconstructAgentInstance,
  type AgentInstance,
  type ProvisionAgentOptions,
} from "glove-foundry";

// your code: any SQL client; this stub only names the shape used below.
declare const sql: {
  query<T>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
};

/** One row per provisioning key, so concurrent callers converge on one instance. */
export function provisionAgent(
  input: ProvisionAgentOptions,
): Effect.Effect<AgentInstance, unknown, never> {
  return Effect.tryPromise({
    try: async () => {
      const candidate = createAgentInstance(input.definitionId, input, input.provisioningKey);
      await sql.query(
        "insert into foundry_agents (id, provisioning_key, record) values ($1, $2, $3) " +
          "on conflict (provisioning_key) do nothing",
        [candidate.id, input.provisioningKey, JSON.stringify(candidate)],
      );
      const { rows } = await sql.query<{ record: AgentInstance }>(
        "select record from foundry_agents where provisioning_key = $1",
        [input.provisioningKey],
      );
      return reconstructAgentInstance(rows[0]!.record);
    },
    catch: (cause) => cause,
  });
}`} />

      <h3 id="compare-and-set">compareAndSetWorkspaceEntry</h3>
      <p>
        <code>compareAndSetWorkspaceEntry(entry, expectedUpdatedAt)</code> is an optional,
        atomic “first writer wins” update for coordinating agents through the workspace:
      </p>
      <ul>
        <li><code>expectedUpdatedAt: null</code> succeeds only if the key does not exist.</li>
        <li>Otherwise it succeeds only if the stored <code>updatedAt</code> equals the value you read.</li>
        <li>A replacement must carry a strictly later, parseable <code>updatedAt</code>; anything else throws.</li>
        <li>A conflict returns <code>false</code>: re-read and retry. Every writer to that key must use the same contract.</li>
      </ul>
      <p>
        Both bundled adapters implement it; a database adapter should implement it in one
        transaction (<code>update … where updated_at = $expected</code>, or insert-if-absent for{" "}
        <code>null</code>). Agent code reaches it through the assembly context’s{" "}
        <code>data</code>:
      </p>
      <CodeBlock filename="agents/support/claim-ticket.ts" language="typescript" code={`import { Effect } from "effect";
import type { GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";

const input = z.object({ ticketId: z.string() });

/** First writer wins: an atomic claim on a shared workspace key. */
export function claimTicket(ctx: AgentAssemblyContext): GloveFoldArgs<z.infer<typeof input>> {
  return {
    name: "claim_ticket",
    description: "Claim a ticket so only one agent in this workspace works on it.",
    inputSchema: input,
    async do({ ticketId }) {
      const key = \`ticket-owner:\${ticketId}\`;
      const attempt = ctx.data.compareAndSetWorkspaceEntry?.(
        { workspaceId: ctx.workspaceId, key, value: ctx.agentId, updatedAt: new Date().toISOString() },
        null, // null: succeed only if the key does not exist yet
      );
      if (!attempt) {
        return { status: "error", data: null, message: "This data adapter has no atomic updates." };
      }
      const claimed = await Effect.runPromise(attempt);
      const owner = await Effect.runPromise(ctx.data.getWorkspaceEntry(ctx.workspaceId, key));
      return { status: "success", data: { claimed, owner: owner?.value } };
    },
  };
}`} />
      <p>
        This tool runs inside the job process, so it only coordinates anything when the
        adapter is shared (file or database), never with <code>MemoryFoundryDataAdapter</code>.
      </p>

      <h2 id="transcripts">Conversation transcripts</h2>
      <ul>
        <li>
          Foundry resolves the store as <code>definition.store ?? application.conversationStore</code>.
          Both receive <code>{"{ definitionId, agentId, conversationId, workspaceId }"}</code> and
          return a <code>StoreAdapter</code> (or a promise of one).
        </li>
        <li>
          The factory is called in the job process at the start of every run, and in the
          control process whenever a transcript is read
          (<code>GET /api/conversations/:id/messages</code>, <code>client.conversationTranscript</code>,
          the inspector’s Chat page).
        </li>
        <li>
          With neither configured, runs start with no history and transcripts report{" "}
          <code>persisted: false</code>. Foundry never rebuilds history from run output or events.
        </li>
        <li>
          <code>persisted: true</code> only means a store factory is configured. With a{" "}
          <code>MemoryStore</code> factory the transcript reads back empty while still reporting{" "}
          <code>persisted: true</code>.
        </li>
        <li>
          <code>glove-core</code> ships only <code>MemoryStore</code>. The deprecated{" "}
          <code>glove-sqlite</code> package has <code>new SqliteStore({"{ dbPath, sessionId }"})</code>{" "}
          (better-sqlite3); it does not implement newer optional capabilities such as{" "}
          <code>createSubAgentStore</code>. For production, implement <code>StoreAdapter</code> on
          your database, or extend <code>MemoryStore</code> as above.
        </li>
      </ul>

      <h2 id="memory">Structured memory</h2>
      <p>
        <code>createSqliteMemoryAdapters</code> returns <code>entity</code>, <code>episodic</code>,{" "}
        <code>resources</code>, <code>context</code>, <code>goals</code>, <code>forms</code> and{" "}
        <code>facts</code> adapters over one SQLite file, using Node’s built-in{" "}
        <code>node:sqlite</code>. It requires Node 22.13+; Node may print an{" "}
        <code>ExperimentalWarning</code> for SQLite.
      </p>
      <table>
        <thead><tr><th>Option</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>file</code></td><td>required</td><td>A dedicated SQLite file on a local persistent volume. Network filesystems are unsupported.</td></tr>
          <tr><td><code>namespace</code></td><td>required</td><td>Trusted ownership key. Include tenant/workspace and instance identity.</td></tr>
          <tr><td><code>schema</code></td><td>required</td><td>A <code>MemorySchema</code> from <code>glove-memory/core</code>.</td></tr>
          <tr><td><code>busyTimeoutMs</code></td><td><code>5000</code></td><td>Cross-process lock wait.</td></tr>
          <tr><td><code>maxSnapshotBytes</code></td><td>16 MiB</td><td>Per-subsystem limit; exceeding it fails without committing.</td></tr>
          <tr><td><code>fuzzySearch</code></td><td><code>false</code></td><td>Embedding-free episodic content search.</td></tr>
          <tr><td><code>embedder</code></td><td>none</td><td>Optional vector search.</td></tr>
        </tbody>
      </table>
      <p>
        Derive the namespace from trusted identity with{" "}
        <code>foundryGuidanceSubject(ctx, scope)</code>. It returns{" "}
        <code>foundry:&lt;scope&gt;:&lt;sha256&gt;</code> over the workspace and instance ids, plus the
        conversation id when <code>scope</code> is <code>&quot;conversation&quot;</code> (the
        default). Use <code>&quot;instance&quot;</code> to share memory across one instance’s
        conversations. Never build a namespace from tool input or message text. Back up a coherent
        SQLite snapshot (including the WAL), not a copy of the live main file. See{" "}
        <Link href="/docs/memory">Memory</Link> and{" "}
        <Link href="/foundry/docs/guidance">Goals, facts &amp; forms</Link>.
      </p>

      <h2 id="vfs">Working-environment files</h2>
      <p>
        Foundry closes the working environment after every run. With a{" "}
        <code>persistence</code> adapter it loads a snapshot before the run, restores it when you
        did not pass your own <code>filesystem</code>, and saves a new snapshot when the run ends
        (emitting <code>foundry.working-environment.snapshot.saved</code>).
      </p>
      <ul>
        <li>
          <code>foundryDataEnvironmentPersistence({"{ scope }"})</code> stores snapshots through the
          data adapter’s private snapshot methods. <code>scope: &quot;agent&quot;</code> (the
          default) gives each instance one tree; <code>&quot;conversation&quot;</code> gives each
          conversation its own.
        </li>
        <li>
          For large trees or many concurrent writers, pass a native persistent <code>Vfs</code>{" "}
          (for example <code>cachedRemote</code> from <code>glove-vfs</code>) as the environment’s{" "}
          <code>filesystem</code> and let it own storage and locking. See{" "}
          <Link href="/docs/vfs">VFS</Link> and{" "}
          <Link href="/foundry/docs/working-environments">Working environments</Link>.
        </li>
        <li>
          Snapshots never contain credentials or host secret stores; supply those again each run.
          REPL variables are run-scoped and never persisted; put durable artifacts in the VFS.
        </li>
      </ul>

      <h2 id="restart">What survives a restart</h2>
      <table>
        <thead><tr><th>State</th><th>After restart</th></tr></thead>
        <tbody>
          <tr><td>Instances, conversation records, subscriptions, workspace, inbox, tasks, VFS snapshots</td><td>Kept with a durable data adapter; lost with <code>MemoryFoundryDataAdapter</code>.</td></tr>
          <tr><td>Schedules and sleeps</td><td>Re-armed from persisted activations at startup. Paused, completed and cancelled ones stay disarmed.</td></tr>
          <tr><td>Transcripts and memory</td><td>Kept only with durable stores and memory adapters.</td></tr>
          <tr><td>Runs that were executing</td><td>Not resumed. The live job process is gone; send the work again.</td></tr>
          <tr><td>Run list and status (<code>/api/runs</code>)</td><td>Lost. The execution queue lives in memory in the managed daemon.</td></tr>
          <tr><td>Event history (<code>/api/events</code>)</td><td>Lost by default: the built-in buffer keeps the last <code>observability.maxEvents</code> (10,000) in memory.</td></tr>
          <tr><td>Pending approvals</td><td>Lost: approval records are files in a per-runtime temporary directory (and expire after 5 minutes by default anyway).</td></tr>
          <tr><td>Accounts, routes, bindings</td><td>Re-created from <code>foundry.application.ts</code>. Routes and bindings added at runtime through the API live in an in-memory store unless you supply a durable <code>services</code> layer.</td></tr>
        </tbody>
      </table>
      <p>
        Execution-daemon limits (no remote daemon, no job survival after the control process
        exits, no failover) are covered in{" "}
        <Link href="/foundry/docs/deploy#execution-daemon">Deploy &amp; security</Link>.
      </p>
    </article>
  );
}
