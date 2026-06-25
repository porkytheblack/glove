/**
 * Two dummy MCP servers, served over real Streamable HTTP, in-process.
 *
 * These stand in for the third-party MCP servers a team would actually wire up —
 * an issue tracker (Linear / Jira / GitHub Issues) and a CRM (Salesforce /
 * HubSpot). They speak the genuine MCP wire protocol via
 * `@modelcontextprotocol/sdk`, so glove-mcp's `connectMcp` talks to them exactly
 * as it would to a hosted server. Nothing here is faked at the transport layer —
 * only the data behind the tools is synthetic.
 *
 * Each server returns its *entire* dataset from a single tool call. That's the
 * point: a chunky tool result is what bloats context today, and it's exactly
 * what `storeAndTruncate` + the scratchpad are designed to contain.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { generateAccounts, generateIssues } from "./data";

export interface RunningMcpServer {
  url: string; // http://127.0.0.1:<port>/mcp
  port: number;
  close: () => Promise<void>;
}

type RegisterTools = (server: McpServer) => void;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * Boot one Streamable-HTTP MCP endpoint on an ephemeral localhost port using the
 * canonical stateful-session pattern: the first `initialize` POST mints a
 * session, subsequent requests route back to the same transport by the
 * `mcp-session-id` header. `enableJsonResponse` keeps responses as plain JSON
 * (no SSE), which is all the glove-mcp client needs here.
 */
async function startMcpHttpServer(name: string, register: RegisterTools): Promise<RunningMcpServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer: Server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");
      if (pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const body = req.method === "POST" ? await readJsonBody(req) : undefined;

      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (req.method === "POST" && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sid) => {
              transports.set(sid, transport!);
            },
          });
          transport.onclose = () => {
            if (transport!.sessionId) transports.delete(transport!.sessionId);
          };
          const server = new McpServer({ name, version: "1.0.0" });
          register(server);
          await server.connect(transport);
        } else {
          res.writeHead(400, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "No valid MCP session" },
              id: null,
            }),
          );
          return;
        }
      }

      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end();
      // eslint-disable-next-line no-console
      console.error(`[mcp:${name}] request error:`, err instanceof Error ? err.message : err);
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of transports.values()) void t.close().catch(() => {});
        httpServer.close(() => resolve());
      }),
  };
}

// ─── The two servers ─────────────────────────────────────────────────────────

export interface DummyMcpFleet {
  issues: RunningMcpServer;
  crm: RunningMcpServer;
  close: () => Promise<void>;
}

/**
 * Start the issue-tracker and CRM MCP servers. The CRM is generated first so the
 * issue tracker can reference real `account_id`s — the two datasets actually
 * join, which is the whole reason the example exists.
 */
export async function startDummyMcpServers(): Promise<DummyMcpFleet> {
  const accounts = generateAccounts(250);
  const issues = generateIssues(600, accounts.map((a) => a.account_id));

  const crm = await startMcpHttpServer("crm", (server) => {
    server.registerTool(
      "list_accounts",
      {
        title: "List accounts",
        description:
          "Return EVERY customer account in the CRM (id, name, tier, ARR, region, " +
          "seats, CSM, renewal date, health). No arguments — this is a full dump.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => ({ content: [{ type: "text", text: JSON.stringify(accounts) }] }),
    );
  });

  const issuesServer = await startMcpHttpServer("issues", (server) => {
    server.registerTool(
      "search_issues",
      {
        title: "Search issues",
        description:
          "Return EVERY issue in the tracker (id, title, account_id, state, priority, " +
          "team, assignee, labels, created_at), open and closed. No arguments — full dump.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => ({ content: [{ type: "text", text: JSON.stringify(issues) }] }),
    );
  });

  return {
    issues: issuesServer,
    crm,
    close: async () => {
      await Promise.all([issuesServer.close(), crm.close()]);
    },
  };
}
