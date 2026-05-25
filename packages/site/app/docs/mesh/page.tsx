import { CodeBlock } from "@/components/code-block";

export default async function MeshPage() {
  return (
    <div className="docs-content">
      <h1>Mesh Network</h1>

      <p>
        <code>glove-mesh</code> lets multiple Glove agents talk to each other —
        direct messages, broadcasts, acknowledgements — on top of the existing{" "}
        <a href="/docs/inbox">inbox</a> primitive. The package is strictly
        additive (no <code>glove-core</code> changes) and ships{" "}
        <strong>no authentication</strong>; the consumer&apos;s{" "}
        <code>MeshAdapter</code> owns transport and any signing or verification.
      </p>

      <p>
        Install it next to <code>glove-core</code>:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-mesh`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>When to use mesh</h2>

      <p>
        Mesh is for <strong>peers</strong> — multiple Glove agents running
        async or in parallel that need to coordinate. Examples:
      </p>

      <ul>
        <li>A planner agent assigning tasks to a worker agent on the same host.</li>
        <li>A swarm of specialised agents (researcher, drafter, reviewer) collaborating on output.</li>
        <li>Cross-process or cross-host agents passing messages over Redis pub/sub, NATS, or HTTP webhooks.</li>
      </ul>

      <p>
        If you want a parent agent to delegate work to an isolated sub-task,
        use <a href="/docs/extensions"><code>defineSubAgent</code></a> instead —
        subagents run nested under the parent. Mesh is for peers, not children.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Mental model</h2>

      <p>
        Each agent owns its own <code>StoreAdapter</code>+inbox. The{" "}
        <code>MeshAdapter</code> is a per-agent view of the network (matches{" "}
        <code>McpAdapter</code>&apos;s per-conversation pattern). When agent
        A calls <code>glove_mesh_send_message({"{ to: \"b\", ... }"})</code>, the
        framework drops a <code>status: &quot;resolved&quot;</code>{" "}
        <code>InboxItem</code> with tag <code>mesh:from:a</code> into B&apos;s
        store. B&apos;s existing inbox-injection path surfaces it as a
        synthetic user message on B&apos;s next <code>ask()</code> — exactly
        like an externally-resolved inbox item.
      </p>

      <p>
        The &quot;shared inbox&quot; is conceptual: the mesh is shared; the
        inbox stays per-agent.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Quick start (in-process)</h2>

      <p>
        Two agents talking through one shared <code>MeshNetwork</code> in the
        same Node process:
      </p>

      <CodeBlock
        filename="examples/mesh-demo/index.ts"
        language="typescript"
        code={`import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

const network = new MeshNetwork();

async function makeAgent(id: string, name: string, description: string) {
  const store = new MemoryStore(id);
  const glove = new Glove({
    store,
    model: createAdapter({ provider: "anthropic" }),
    displayManager: new Displaymanager(),
    systemPrompt: \`You are \${name}. \${description}\`,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarize the conversation." },
  }).build(store);

  await mountMesh(glove, {
    adapter: new InMemoryMeshAdapter(network, id),
    identity: { id, name, description, capabilities: ["chat"] },
  });

  return glove;
}

const planner = await makeAgent("planner", "Planner", "Plans tasks for the team.");
const worker  = await makeAgent("worker",  "Worker",  "Executes assigned tasks.");

await planner.processRequest(
  "Find an agent that can execute tasks and ask them to do something. Block until they respond.",
);
await worker.processRequest("Check your inbox and acknowledge anything you see.");
await planner.processRequest("Continue.");`}
      />

      <p>
        For distributed setups — multiple processes, multiple hosts —
        implement <code>MeshAdapter</code> directly over your transport of
        choice. The four mesh tools and the inbox routing don&apos;t change.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What it gives the agent</h2>

      <p>
        After <code>mountMesh</code> resolves, four model-callable tools are
        folded onto the running Glove:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Input</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>glove_mesh_send_message</code></td>
            <td><code>{"{ to, content, in_reply_to?, blocking? }"}</code></td>
            <td>Send a private message to a specific agent.</td>
          </tr>
          <tr>
            <td><code>glove_mesh_broadcast</code></td>
            <td><code>{"{ content, blocking? }"}</code></td>
            <td>Send a message to every other registered agent.</td>
          </tr>
          <tr>
            <td><code>glove_mesh_list_agents</code></td>
            <td><code>{"{ filter? }"}</code></td>
            <td>Discover who&apos;s on the network. Filter by capability or name substring.</td>
          </tr>
          <tr>
            <td><code>glove_mesh_acknowledge</code></td>
            <td><code>{"{ message_id, note? }"}</code></td>
            <td>Lightweight delivery confirmation. Unblocks the original sender.</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>The MeshAdapter contract</h2>

      <p>
        Implement one per agent. Same shape as <code>McpAdapter</code> /{" "}
        <code>StoreAdapter</code>: an <code>identifier</code> field plus async
        methods. The consumer owns transport and persistence.
      </p>

      <CodeBlock
        filename="glove-mesh/core"
        language="typescript"
        code={`interface MeshAdapter {
  identifier: string;

  // Identity / registration
  register(identity: AgentIdentity): Promise<void>;
  unregister(): Promise<void>;
  listAgents(): Promise<AgentIdentity[]>;
  getAgent(id: string): Promise<AgentIdentity | null>;

  // Outbound
  send(message: MeshMessage): Promise<void>;
  broadcast(message: Omit<MeshMessage, "to">): Promise<void>;
  acknowledge(messageId: string, note?: string): Promise<void>;

  // Inbound — framework registers ONE handler per agent
  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void;
}`}
      />

      <p>Adapter guarantees the framework relies on:</p>

      <ul>
        <li><code>send</code> resolves when the transport has accepted the message, <strong>not</strong> when the recipient handles it.</li>
        <li><code>broadcast</code> excludes the sender from fan-out.</li>
        <li>Handler errors must <strong>not</strong> bubble — log and continue so fan-out to other agents stays intact.</li>
        <li><code>acknowledge</code> routes an <code>IncomingMeshMessage</code> with <code>kind: &quot;ack&quot;</code> back to the original sender of <code>messageId</code>.</li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>Message types</h2>

      <CodeBlock
        filename="glove-mesh/core"
        language="typescript"
        code={`interface AgentIdentity {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

interface MeshMessage {
  id: string;                    // sender-generated
  from: string;                  // sender-claimed; unverified in v1
  to?: string;                   // omitted on broadcast
  in_reply_to?: string;
  content: string;
  created_at: string;            // ISO-8601
  blocking?: boolean;
  metadata?: Record<string, unknown>;
}

interface IncomingMeshMessage extends MeshMessage {
  kind: "direct" | "broadcast" | "ack";
  ack_of?: string;               // when kind === "ack"
  ack_note?: string;
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Blocking sends</h2>

      <p>
        Set <code>blocking: true</code> on <code>glove_mesh_send_message</code>{" "}
        or <code>glove_mesh_broadcast</code> when the agent should not proceed
        until a response arrives. The framework inserts a pending blocking{" "}
        <code>InboxItem</code> tagged <code>mesh:waiting:{"<msg_id>"}</code>;
        when the ack/reply lands, that item flips to <code>resolved</code> and
        shows up via the standard{" "}
        <code>[Inbox: N item(s) resolved]</code> injection on the next turn.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool call</th>
            <th>Pending item</th>
            <th>Resolves on</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>{"glove_mesh_send_message({ blocking: false })"}</code></td>
            <td>No</td>
            <td>n/a — returns immediately</td>
          </tr>
          <tr>
            <td><code>{"glove_mesh_send_message({ blocking: true })"}</code></td>
            <td>Yes, tag <code>mesh:waiting:&lt;msg_id&gt;</code></td>
            <td>Ack with <code>ack_of === msg_id</code>, or a reply (<code>glove_mesh_send_message</code> with <code>in_reply_to === msg_id</code>)</td>
          </tr>
          <tr>
            <td><code>{"glove_mesh_broadcast({ blocking: true })"}</code></td>
            <td>Yes</td>
            <td>The first ack received from any peer. Later acks arrive as ordinary inbox items.</td>
          </tr>
          <tr>
            <td><code>glove_mesh_acknowledge</code></td>
            <td>No</td>
            <td>n/a — itself</td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Reply implies ack.</strong> A direct incoming message with{" "}
        <code>in_reply_to: X</code> does both: surfaces the reply body as a
        new resolved inbox item AND resolves the pending blocking item for{" "}
        <code>X</code>. The recipient doesn&apos;t need to call{" "}
        <code>glove_mesh_acknowledge</code> separately when replying.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Inbox tag convention</h2>

      <p>
        Mesh-originated inbox items use namespaced tags so consumers can filter
        mesh traffic out of inbox histories:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tag prefix</th>
            <th>Direction</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>mesh:from:&lt;sender&gt;</code></td>
            <td>inbound</td>
            <td>direct message from another agent</td>
          </tr>
          <tr>
            <td><code>mesh:broadcast:from:&lt;sender&gt;</code></td>
            <td>inbound</td>
            <td>broadcast from another agent</td>
          </tr>
          <tr>
            <td><code>mesh:waiting:&lt;msg_id&gt;</code></td>
            <td>local</td>
            <td>pending blocking item for an outbound send</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>No authentication</h2>

      <p>
        The <code>from</code> field on every <code>MeshMessage</code> is{" "}
        sender-claimed and not verified. If you need authenticated messaging,
        sign messages before calling <code>adapter.send</code> /{" "}
        <code>adapter.broadcast</code> and verify in your{" "}
        <code>subscribe</code> handler — <code>glove-mesh</code> itself stays
        out of the way. This mirrors how{" "}
        <code>McpAdapter.getAccessToken</code> keeps auth a consumer concern.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>BYO transport (Redis pub/sub sketch)</h2>

      <p>
        For cross-process or distributed setups, implement{" "}
        <code>MeshAdapter</code> directly. The adapter is the only seam.
      </p>

      <CodeBlock
        filename="redis-mesh-adapter.ts"
        language="typescript"
        code={`import type { MeshAdapter, MeshMessage, IncomingMeshMessage, AgentIdentity } from "glove-mesh";
import type { Redis } from "ioredis";

export class RedisMeshAdapter implements MeshAdapter {
  identifier: string;

  constructor(private redis: Redis, private agentId: string) {
    this.identifier = \`redis-mesh-\${agentId}\`;
  }

  async register(identity: AgentIdentity) {
    await this.redis.hset("mesh:agents", this.agentId, JSON.stringify(identity));
  }
  async unregister() {
    await this.redis.hdel("mesh:agents", this.agentId);
  }
  async listAgents(): Promise<AgentIdentity[]> {
    const raw = await this.redis.hgetall("mesh:agents");
    return Object.values(raw).map((s) => JSON.parse(s));
  }
  async getAgent(id: string) {
    const raw = await this.redis.hget("mesh:agents", id);
    return raw ? (JSON.parse(raw) as AgentIdentity) : null;
  }

  async send(msg: MeshMessage) {
    await this.redis.set(\`mesh:msg:\${msg.id}:sender\`, msg.from, "EX", 3600);
    await this.redis.publish(\`mesh:agent:\${msg.to}\`, JSON.stringify({ ...msg, kind: "direct" }));
  }
  async broadcast(msg: Omit<MeshMessage, "to">) {
    await this.redis.set(\`mesh:msg:\${msg.id}:sender\`, this.agentId, "EX", 3600);
    await this.redis.publish("mesh:broadcast", JSON.stringify({ ...msg, kind: "broadcast", from: this.agentId }));
  }
  async acknowledge(messageId: string, note?: string) {
    const sender = await this.redis.get(\`mesh:msg:\${messageId}:sender\`);
    if (!sender) throw new Error(\`No record of message "\${messageId}"\`);
    const ack = {
      id: \`ack_\${Date.now()}_\${Math.random().toString(36).slice(2, 10)}\`,
      from: this.agentId,
      to: sender,
      content: note ?? "",
      created_at: new Date().toISOString(),
      kind: "ack" as const,
      ack_of: messageId,
      ack_note: note,
    };
    await this.redis.publish(\`mesh:agent:\${sender}\`, JSON.stringify(ack));
  }

  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>) {
    const sub = this.redis.duplicate();
    sub.subscribe(\`mesh:agent:\${this.agentId}\`, "mesh:broadcast");
    sub.on("message", async (_chan, raw) => {
      try {
        await handler(JSON.parse(raw) as IncomingMeshMessage);
      } catch (err) {
        console.warn("[mesh-redis] handler:", err);
      }
    });
    return () => {
      sub.unsubscribe();
      sub.quit();
    };
  }
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>How this differs from <code>glove_post_to_inbox</code></h2>

      <ul>
        <li><code>glove_post_to_inbox</code> — &quot;I will resolve this myself later from outside the conversation&quot; (external service, webhook, cron).</li>
        <li><code>glove_mesh_send_message</code> — &quot;I&apos;m talking to another Glove agent on the mesh&quot; (peer-to-peer).</li>
      </ul>

      <p>
        Both write to the same <code>StoreAdapter</code> inbox surface; the
        tag prefix tells them apart.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Limitations (v1)</h2>

      <ul>
        <li><code>InMemoryMeshAdapter</code> is process-local; restarts wipe state. Real transports are the consumer&apos;s responsibility.</li>
        <li>The sender-table LRU that maps <code>message_id → sender_id</code> for ack routing caps at 1024 by default — acks for very old messages are best-effort.</li>
        <li>Broadcast blocking resolves on the <strong>first</strong> ack, not all peers.</li>
        <li>
          No new <code>SubscriberEvent</code> types: observability rides on
          existing <code>tool_use_result</code> events for the four mesh tools
          plus inbox-state writes.
        </li>
        <li>No group/topic concept. Broadcast targets every registered agent.</li>
      </ul>
    </div>
  );
}
