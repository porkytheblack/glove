/**
 * A fleet of 10 dummy MCP servers — one per business domain — each served over
 * real Streamable HTTP, in-process. This is the "10+ providers" scale where you
 * canNOT fold every tool up front: the agent must DISCOVER and activate the
 * providers a task needs, and the scratchpad contains whatever they return.
 *
 * Five providers (crm, issues, support, billing, analytics) join on account_id
 * and are what a churn-risk board needs; the other five (hr, inventory, calendar,
 * docs, email) are realistic distractors in the catalogue so discovery has to
 * actually discriminate.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpCatalogueEntry } from "glove-mcp";

// ─── seeded data ─────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const rng = mulberry32(0xf1ee7);

const N_ACCOUNTS = 200;
const ACCOUNTS = Array.from({ length: N_ACCOUNTS }, (_, i) => {
  const tier = rng() < 0.22 ? "enterprise" : rng() < 0.6 ? "growth" : "startup";
  const arr = tier === "enterprise" ? 80_000 + Math.floor(rng() * 420_000) : tier === "growth" ? 15_000 + Math.floor(rng() * 65_000) : 2_000 + Math.floor(rng() * 13_000);
  return {
    account_id: `ACC-${pad(i + 1, 4)}`,
    name: `${pick(rng, ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Wonka", "Soylent", "Vandelay", "Tyrell", "Oscorp", "Aperture", "Weyland", "Nakatomi"])} ${pick(rng, ["Corp", "Labs", "Industries", "Systems", "Group", "Holdings"])}`,
    tier,
    arr,
    region: pick(rng, ["NA", "EU", "APAC", "LATAM"]),
  };
});
const accountIds = ACCOUNTS.map((a) => a.account_id);
const someAccount = () => pick(rng, accountIds);

const ISSUES = Array.from({ length: 500 }, (_, i) => ({
  id: `ISS-${pad(1000 + i, 4)}`, account_id: someAccount(),
  state: rng() < 0.35 ? "open" : "closed",
  priority: rng() < 0.1 ? "P0" : rng() < 0.35 ? "P1" : "P2",
  team: pick(rng, ["platform", "billing", "growth", "data", "mobile"]),
}));
const TICKETS = Array.from({ length: 400 }, (_, i) => ({
  id: `TIC-${pad(i, 4)}`, account_id: someAccount(),
  status: rng() < 0.4 ? "open" : "resolved",
  severity: rng() < 0.15 ? "high" : rng() < 0.5 ? "medium" : "low",
  csat: 1 + Math.floor(rng() * 5),
}));
const INVOICES = Array.from({ length: 600 }, (_, i) => {
  const overdue = rng() < 0.18;
  return { id: `INV-${pad(i, 5)}`, account_id: someAccount(), amount: 500 + Math.floor(rng() * 40_000), status: overdue ? "overdue" : rng() < 0.7 ? "paid" : "open", days_overdue: overdue ? 1 + Math.floor(rng() * 90) : 0 };
});
const USAGE = ACCOUNTS.map((a) => {
  const trend = Math.floor(rng() * 60) - 35; // -35%..+25%
  return { account_id: a.account_id, mau: 10 + Math.floor(rng() * 5000), wau: 5 + Math.floor(rng() * 2000), trend_30d_pct: trend };
});
const EMPLOYEES = Array.from({ length: 150 }, (_, i) => ({ id: `EMP-${pad(i, 4)}`, name: `Employee ${i}`, team: pick(rng, ["eng", "sales", "cs", "ops", "marketing"]), manager: `MGR-${pad(Math.floor(rng() * 20), 2)}` }));
const SKUS = Array.from({ length: 300 }, (_, i) => ({ id: `SKU-${pad(i, 4)}`, name: `Widget ${i}`, stock: Math.floor(rng() * 2000), warehouse: pick(rng, ["us-east", "us-west", "eu", "apac"]) }));
const EVENTS = Array.from({ length: 250 }, (_, i) => ({ id: `EVT-${pad(i, 4)}`, account_id: someAccount(), type: pick(rng, ["qbr", "demo", "onboarding", "renewal-call"]), date: `2026-0${1 + Math.floor(rng() * 6)}-${pad(1 + Math.floor(rng() * 28), 2)}` }));
const DOCS = Array.from({ length: 300 }, (_, i) => ({ id: `DOC-${pad(i, 4)}`, title: `Runbook ${i}`, kind: pick(rng, ["runbook", "spec", "postmortem", "guide"]) }));
const THREADS = Array.from({ length: 350 }, (_, i) => ({ id: `THR-${pad(i, 4)}`, account_id: someAccount(), subject: `Re: ticket ${i}`, unread: rng() < 0.3 }));

// ─── provider definitions ────────────────────────────────────────────────────
interface ProviderTool { name: string; description: string; data: () => unknown }
interface ProviderDef { id: string; name: string; description: string; tags: string[]; tool: ProviderTool }

const PROVIDERS: ProviderDef[] = [
  { id: "crm", name: "CRM", description: "Customer accounts: tier, ARR, region, renewal. The source of truth for who a customer is.", tags: ["accounts", "customers", "revenue", "arr"], tool: { name: "list_accounts", description: "Every account (id, name, tier, ARR, region). Full dump.", data: () => ACCOUNTS } },
  { id: "issues", name: "Issue Tracker", description: "Engineering issues/bugs per account: state, priority (P0..P2), team.", tags: ["issues", "bugs", "engineering", "p0"], tool: { name: "search_issues", description: "Every issue (id, account_id, state, priority, team). Full dump.", data: () => ISSUES } },
  { id: "support", name: "Support Desk", description: "Customer support tickets per account: status, severity, CSAT.", tags: ["support", "tickets", "csat", "severity"], tool: { name: "list_tickets", description: "Every ticket (id, account_id, status, severity, csat). Full dump.", data: () => TICKETS } },
  { id: "billing", name: "Billing", description: "Invoices per account: amount, status, days overdue. Dunning / collections.", tags: ["billing", "invoices", "overdue", "finance"], tool: { name: "list_invoices", description: "Every invoice (id, account_id, amount, status, days_overdue). Full dump.", data: () => INVOICES } },
  { id: "analytics", name: "Product Analytics", description: "Per-account product usage: MAU/WAU and 30-day usage trend percentage.", tags: ["analytics", "usage", "mau", "engagement", "trend"], tool: { name: "usage_by_account", description: "Per-account usage (account_id, mau, wau, trend_30d_pct). Full dump.", data: () => USAGE } },
  { id: "hr", name: "HR Directory", description: "Internal employee directory: team, manager. Not customer data.", tags: ["hr", "employees", "internal"], tool: { name: "list_employees", description: "Every employee (id, name, team, manager). Full dump.", data: () => EMPLOYEES } },
  { id: "inventory", name: "Inventory", description: "Physical SKU stock levels by warehouse. Supply chain.", tags: ["inventory", "skus", "stock", "warehouse"], tool: { name: "list_skus", description: "Every SKU (id, name, stock, warehouse). Full dump.", data: () => SKUS } },
  { id: "calendar", name: "Calendar", description: "Scheduled customer events: QBRs, demos, renewal calls.", tags: ["calendar", "events", "meetings"], tool: { name: "list_events", description: "Every event (id, account_id, type, date). Full dump.", data: () => EVENTS } },
  { id: "docs", name: "Docs / Wiki", description: "Internal documents: runbooks, specs, postmortems.", tags: ["docs", "wiki", "runbooks"], tool: { name: "search_docs", description: "Every doc (id, title, kind). Full dump.", data: () => DOCS } },
  { id: "email", name: "Email", description: "Email threads per account: subject, unread flag.", tags: ["email", "threads", "inbox"], tool: { name: "list_threads", description: "Every thread (id, account_id, subject, unread). Full dump.", data: () => THREADS } },
];

// ─── one Streamable-HTTP MCP server per provider ─────────────────────────────
export interface RunningServer { url: string; close: () => Promise<void> }

async function startOne(def: ProviderDef): Promise<RunningServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
  };
  const http: Server = createServer(async (req, res) => {
    try {
      if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") return void res.writeHead(404).end();
      const sid = req.headers["mcp-session-id"] as string | undefined;
      const body = req.method === "POST" ? await read(req) : undefined;
      let transport = sid ? transports.get(sid) : undefined;
      if (!transport) {
        if (req.method === "POST" && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (s) => { transports.set(s, transport!); },
          });
          transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId); };
          const server = new McpServer({ name: def.id, version: "1.0.0" });
          server.registerTool(def.tool.name, { title: def.tool.name, description: def.tool.description, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: JSON.stringify(def.tool.data()) }] }));
          await server.connect(transport);
        } else {
          return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No session" }, id: null }));
        }
      }
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end();
      console.error(`[mcp:${def.id}]`, err instanceof Error ? err.message : err);
    }
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((r) => { for (const t of transports.values()) void t.close().catch(() => {}); http.close(() => r()); }),
  };
}

export interface Fleet {
  catalogue: McpCatalogueEntry[];
  urlOf: (id: string) => string;
  close: () => Promise<void>;
}

/** Start all 10 providers and return a glove-mcp catalogue pointing at them. */
export async function startFleet(): Promise<Fleet> {
  const running = new Map<string, RunningServer>();
  for (const def of PROVIDERS) running.set(def.id, await startOne(def));

  const catalogue: McpCatalogueEntry[] = PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    url: running.get(p.id)!.url,
    tags: p.tags,
  }));

  return {
    catalogue,
    urlOf: (id) => running.get(id)!.url,
    close: async () => { await Promise.all([...running.values()].map((s) => s.close())); },
  };
}
