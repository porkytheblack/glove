import { CodeBlock } from "@/components/code-block";

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  marginTop: "1.5rem",
  marginBottom: "1.5rem",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  minWidth: "540px",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontFamily: "var(--mono)",
  whiteSpace: "nowrap",
};
const thDescStyle: React.CSSProperties = {
  ...thStyle,
  fontFamily: undefined,
  whiteSpace: "normal",
};
const headRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
};
const bodyRowStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
};
const propCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--accent)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const typeCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontFamily: "var(--mono)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  fontSize: "0.825rem",
};
const descCell: React.CSSProperties = {
  padding: "0.75rem 1rem",
  color: "var(--text-secondary)",
  whiteSpace: "normal",
  minWidth: "200px",
};

function PropTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: [string, string, string][];
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={headRowStyle}>
            {headers.map((h, i) => (
              <th key={h} style={i < 2 ? thStyle : thDescStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, desc]) => (
            <tr key={prop + type} style={bodyRowStyle}>
              <td style={propCell}>{prop}</td>
              <td style={typeCell}>{type}</td>
              <td style={descCell}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function McpPage() {
  return (
    <div className="docs-content">
      <h1>MCP Integration</h1>

      <p>
        The <code>glove-mcp</code> package bridges{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
        >
          Model Context Protocol
        </a>{" "}
        servers into a Glove agent. Hosted MCPs (Notion, Gmail, Linear,
        GitHub, …) become first-class tools — namespaced, permission-aware,
        and discoverable mid-conversation. The framework stays agnostic: it
        knows about bearer tokens, nothing more. OAuth dances, refresh
        schedules, and credential storage live entirely in your app.
      </p>

      {/* ================================================================== */}
      {/* QUICK START                                                        */}
      {/* ================================================================== */}
      <h2 id="quick-start">Quick Start</h2>

      <p>Install the package:</p>

      <CodeBlock code={`pnpm add glove-mcp`} language="sh" />

      <p>Wire it into a <code>Glove</code> with three pieces:</p>

      <ol>
        <li>
          <strong>Catalogue</strong> — a static{" "}
          <code>McpCatalogueEntry[]</code> describing every MCP server the
          app supports. Identical across users.
        </li>
        <li>
          <strong>Adapter</strong> — a per-conversation{" "}
          <code>McpAdapter</code>. Holds which entries are active and
          resolves access tokens.
        </li>
        <li>
          <strong>One call</strong> — <code>mountMcp(glove, {`{ adapter, entries }`})</code>{" "}
          reloads previously active servers and folds in the{" "}
          <code>find_capability</code> discovery tool.
        </li>
      </ol>

      <CodeBlock
        code={`import { Glove, Displaymanager, AnthropicAdapter } from "glove-core";
import { mountMcp, type McpAdapter, type McpCatalogueEntry } from "glove-mcp";

const entries: McpCatalogueEntry[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Read and write Notion pages, databases, comments, and blocks.",
    url: "https://mcp.notion.com/mcp",
  },
];

class MyAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>();
  constructor(id: string) { this.identifier = id; }

  async getActive() { return [...this.active]; }
  async activate(id: string) { this.active.add(id); }
  async deactivate(id: string) { this.active.delete(id); }

  async getAccessToken(id: string) {
    const t = process.env[\`\${id.toUpperCase()}_TOKEN\`];
    if (!t) throw new Error(\`No token for "\${id}"\`);
    return t;
  }
}

const glove = new Glove({
  store: new MemoryStore("convo-1"),
  model: new AnthropicAdapter({ model: "claude-sonnet-4.5", stream: true }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are a helpful assistant. Use find_capability to discover external tools.",
  serverMode: true,
  compaction_config: { compaction_instructions: "Summarise." },
});

await mountMcp(glove, { adapter: new MyAdapter("convo-1"), entries });
glove.build();`}
        language="ts"
      />

      <p>
        That&apos;s it. The agent boots with <code>find_capability</code>{" "}
        folded in. When the model needs Notion, it calls{" "}
        <code>find_capability(&quot;notion&quot;)</code>; a discovery
        subagent matches the catalogue, calls{" "}
        <code>adapter.activate(&quot;notion&quot;)</code>, connects, and
        folds bridged tools (<code>notion__search</code>,{" "}
        <code>notion__fetch</code>, …) onto the running Glove. Next turn the
        model uses them directly.
      </p>

      {/* ================================================================== */}
      {/* MCPADAPTER                                                         */}
      {/* ================================================================== */}
      <h2 id="adapter">The McpAdapter</h2>

      <p>
        Per-conversation, mirrors <code>StoreAdapter</code>. Five methods.
        State it holds: which entries are active, and how to resolve a
        token.
      </p>

      <PropTable
        headers={["Method", "Type", "Purpose"]}
        rows={[
          ["identifier", "string", "Log-correlation id, typically the conversation id."],
          ["getActive", "() => Promise<string[]>", "Active entry ids in this conversation. Read by mountMcp at boot for reload."],
          ["activate", "(id) => Promise<void>", "Mark active. Called by the discovery subagent after a successful connect + fold."],
          ["deactivate", "(id) => Promise<void>", "Mark inactive. v1 limitation: doesn't unfold tools from the running Glove — refresh the session for that."],
          ["getAccessToken", "(id) => Promise<string>", "Sole auth seam. Returns a bearer token; framework wraps it as Authorization: Bearer …. Throwing fails activation/reload gracefully."],
        ]}
      />

      <p>
        The state split is clean. <strong>Adapter (per-conversation)</strong>{" "}
        holds the active set. <strong>Token store (often shared)</strong>{" "}
        holds credentials. Build a tiny adapter that delegates token reads
        to whatever store you use — the framework only ever sees the
        returned string.
      </p>

      {/* ================================================================== */}
      {/* CATALOGUE                                                          */}
      {/* ================================================================== */}
      <h2 id="catalogue">McpCatalogueEntry</h2>

      <p>
        Static, app-level config — describes one MCP server. Pass an array
        of entries to <code>mountMcp</code> alongside the adapter. The{" "}
        <code>id</code> doubles as the tool namespace prefix (a Notion{" "}
        <code>search</code> tool surfaces to the model as{" "}
        <code>notion__search</code>; the <code>__</code> separator is
        regex-safe across all model providers).
      </p>

      <PropTable
        headers={["Field", "Type", "Purpose"]}
        rows={[
          ["id", "string", "Stable namespace prefix and activation key."],
          ["name", "string", "Human-readable name. Used by the discovery subagent to match user intent."],
          ["description", "string", "Short blurb. Discovery matches against this too."],
          ["url", "string", "MCP server URL. v1 supports HTTP transport only."],
          ["tags", "string[] (optional)", "Discovery uses these for matching."],
          ["metadata", "Record<string, unknown> (optional)", "Arbitrary extra info, untouched by the framework."],
        ]}
      />

      {/* ================================================================== */}
      {/* DISCOVERY                                                          */}
      {/* ================================================================== */}
      <h2 id="discovery">Discovery & find_capability</h2>

      <p>
        <code>mountMcp</code> always folds <code>find_capability</code> into
        the agent. The model calls it with a brief description (e.g.{" "}
        <em>&quot;send an email&quot;</em>); a discovery subagent matches
        the catalogue, optionally negotiates ambiguity, calls{" "}
        <code>activate(id)</code>, and folds the bridged tools. Three
        ambiguity policies decide what happens when more than one entry
        matches:
      </p>

      <PropTable
        headers={["Policy", "Type", "When to use"]}
        rows={[
          [
            "{ type: \"interactive\" }",
            "default in UI Gloves",
            "Subagent calls pushAndWait with an mcp_picker slot. Requires a renderer in your displayManager. The user picks; the subagent activates.",
          ],
          [
            "{ type: \"auto-pick-best\" }",
            "default when serverMode: true",
            "Subagent silently picks the highest-ranked match. Use for headless agents, evals, cron jobs.",
          ],
          [
            "{ type: \"defer-to-main\" }",
            "explicit opt-in",
            "Subagent returns the candidate list as text and lets the main agent decide. Useful when the main model is better-positioned to disambiguate from full conversation context.",
          ],
        ]}
      />

      <p>
        Override the subagent&apos;s model or system prompt via{" "}
        <code>subagentModel</code> / <code>subagentSystemPrompt</code> on{" "}
        <code>MountMcpConfig</code> if you want.
      </p>

      {/* ================================================================== */}
      {/* AUTH                                                               */}
      {/* ================================================================== */}
      <h2 id="auth">Auth model</h2>

      <p>
        The framework&apos;s auth surface is exactly one method:{" "}
        <code>McpAdapter.getAccessToken(id) =&gt; Promise&lt;string&gt;</code>.
        It hands the string to <code>connectMcp</code> as{" "}
        <code>Authorization: Bearer &lt;string&gt;</code>. That&apos;s the
        whole protocol. Where you got the token, how you refresh it, and
        where you persist it are all your concern.
      </p>

      <p>
        When a token expires mid-call, the bridged tool returns:
      </p>

      <CodeBlock
        code={`{ status: "error", message: "auth_expired", data: null }`}
        language="ts"
      />

      <p>
        That&apos;s the contract. Watch for it in your subscriber, refresh
        the token in your store, and the next connection picks up the new
        value. The framework never touches refresh logic.
      </p>

      <h3 id="oauth-helpers">OAuth helpers (opt-in)</h3>

      <p>
        For the common case of running the MCP authorization spec OAuth
        flow yourself, <code>glove-mcp</code> ships an opt-in subpath:
      </p>

      <CodeBlock
        code={`import {
  runMcpOAuth,
  FsOAuthStore,        // file-backed (atomic writes, mode 0600)
  MemoryOAuthStore,    // in-process (tests / single-shot scripts)
  McpOAuthProvider,    // SDK provider impl, store-backed
  buildClientMetadata,
} from "glove-mcp/oauth";`}
        language="ts"
      />

      <p>
        <code>runMcpOAuth</code> drives the full dance — discovery,
        Dynamic Client Registration (or pre-registered creds for servers
        like Google&apos;s), PKCE, callback listener, token persist, and
        a verification call:
      </p>

      <CodeBlock
        code={`import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

await runMcpOAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "notion",
  port: 53683,
});

// For servers that don't support DCR (Google):
await runMcpOAuth({
  serverUrl: "https://gmailmcp.googleapis.com/mcp/v1",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "gmail",
  port: 53684,
  preRegisteredClient: {
    client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
    client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
  },
  scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
  verify: { type: "callTool", name: "list_labels" },
});`}
        language="ts"
      />

      <p>
        The acquired <code>access_token</code> <em>is</em> the bearer token —
        your <code>getAccessToken</code> reads it from the store and hands
        it back to the framework:
      </p>

      <CodeBlock
        code={`import { FsOAuthStore } from "glove-mcp/oauth";

const STORE = new FsOAuthStore(".mcp-oauth.json");

class MyAdapter implements McpAdapter {
  // ...active-set methods
  async getAccessToken(id: string) {
    const state = await STORE.get(id);
    if (state.tokens?.access_token) return state.tokens.access_token;
    throw new Error("Run \`my-app auth " + id + "\`");
  }
}`}
        language="ts"
      />

      <p>
        If you have static tokens already (env vars, internal integration
        secrets, vault reads, your own OAuth from elsewhere), skip{" "}
        <code>glove-mcp/oauth</code> entirely.{" "}
        <code>getAccessToken</code> is the only seam.
      </p>

      {/* ================================================================== */}
      {/* BRIDGED TOOL SEMANTICS                                             */}
      {/* ================================================================== */}
      <h2 id="bridged-tools">Bridged tool semantics</h2>

      <p>
        <code>bridgeMcpTool(connection, tool, serverMode)</code> turns each
        MCP tool into a <code>GloveFoldArgs</code>. <code>mountMcp</code>{" "}
        and the discovery <code>activate</code> tool call this for you;
        you typically don&apos;t invoke it directly.
      </p>

      <ul>
        <li>
          <strong>Naming</strong> —{" "}
          <code>{`\${connection.namespace}__\${tool.name}`}</code>. Notion&apos;s
          remote <code>search</code> becomes <code>notion__search</code>.
          The <code>__</code> separator is safe across providers.
        </li>
        <li>
          <strong>Schema</strong> — the MCP server&apos;s{" "}
          <code>inputSchema</code> (raw JSON Schema) is forwarded verbatim
          via the new <code>Tool.jsonSchema</code> field. The executor
          skips local Zod validation; the server is the source of truth.
        </li>
        <li>
          <strong>Permission gating</strong> — derived from the MCP tool&apos;s
          annotations and your <code>serverMode</code>. When{" "}
          <code>serverMode === true</code>, all bridged tools default to{" "}
          <code>requiresPermission: false</code>. Otherwise, tools are
          gated unless their MCP annotation has{" "}
          <code>readOnlyHint: true</code>.
        </li>
        <li>
          <strong>renderData</strong> — the full MCP{" "}
          <code>content[]</code> array (text, images, resources) is passed
          through as <code>renderData</code> on the tool result. Server-side
          agents ignore it; React renderers can use it for rich display.
          The model only ever sees the joined text in <code>data</code>.
        </li>
        <li>
          <strong>auth_expired</strong> — 401 / unauthorized responses
          during a tool call map to{" "}
          <code>{`{ status: "error", message: "auth_expired", data: null }`}</code>.
        </li>
      </ul>

      {/* ================================================================== */}
      {/* SERVER MODE                                                        */}
      {/* ================================================================== */}
      <h2 id="server-mode">serverMode</h2>

      <p>
        <code>new Glove({`{ serverMode: true, ... }`})</code> is the
        canonical &quot;I am headless&quot; flag. Two MCP-relevant defaults
        flip:
      </p>

      <ul>
        <li>
          Bridged tools never gate. Even MCP-annotated{" "}
          <code>destructiveHint: true</code> tools execute without
          permission prompts (no user to ask).
        </li>
        <li>
          Discovery&apos;s ambiguity policy defaults to{" "}
          <code>auto-pick-best</code>.
        </li>
      </ul>

      <p>
        Use <code>serverMode</code> for cron agents, eval harnesses,
        WebSocket bots — anything without a UI to drive permission
        prompts. UI agents leave it false (the default) so your renderer
        can intercept destructive calls.
      </p>

      {/* ================================================================== */}
      {/* PRODUCTION                                                         */}
      {/* ================================================================== */}
      <h2 id="production">Production lift-and-shift</h2>

      <p>
        For multi-user apps, three things change. The agent code does not.
      </p>

      <ul>
        <li>
          <strong>Token store</strong> — replace <code>FsOAuthStore</code>{" "}
          with a per-user implementation backed by your DB. The{" "}
          <code>OAuthStore</code> interface is three methods (
          <code>get</code>, <code>set</code>, <code>delete</code>).
        </li>
        <li>
          <strong>OAuth flow</strong> — move <code>runMcpOAuth</code> from
          a CLI into route handlers.{" "}
          <code>GET /oauth/&lt;id&gt;/start</code> redirects;{" "}
          <code>GET /oauth/&lt;id&gt;/callback</code> exchanges. Same
          machinery.
        </li>
        <li>
          <strong>Refresh</strong> — background-refresh expired tokens
          however your stack does it. The agent reads bearer strings from
          your store via <code>getAccessToken</code> on every connection,
          so updating the store is enough.
        </li>
      </ul>

      <p>
        See the <code>examples/mcp-cli/</code> folder in the repo for a
        complete reference consumer covering Notion, Gmail, and the
        multi-MCP discovery agent.
      </p>

      {/* ================================================================== */}
      {/* RELATED                                                            */}
      {/* ================================================================== */}
      <h2 id="related">Related</h2>

      <ul>
        <li>
          <a href="/docs/server-side">Server-Side Agents</a> — the
          headless context most MCP agents run in.
        </li>
        <li>
          <a href="/docs/concepts">Core Concepts</a> — Glove&apos;s
          building blocks (Tools, Adapters, Display Stack).
        </li>
        <li>
          <a href="/docs/core">Core API</a> —{" "}
          <code>Glove</code> builder, <code>fold</code>,{" "}
          <code>build</code>, <code>processRequest</code>.
        </li>
      </ul>
    </div>
  );
}
