import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Schema } from "effect";
import { renderDashboard } from "./dashboard.js";
import {
  AgentId,
  AgentBinding,
  BindingId,
  Route,
  RouteId,
  RunId,
} from "./domain.js";
import type { EventFilter, FoundryEvent } from "./observability.js";
import type { FoundryRuntime } from "./runtime.js";
import type {
  AgentInstallation,
  AgentInstallationKind,
} from "./capabilities.js";
import type {
  CreateAgentInstanceOptions,
  FoundryMessageInput,
  FoundryRequest,
  FoundryTask,
  SharedInboxItem,
} from "./primitives.js";

const MAX_BODY_BYTES = 1024 * 1024;

function isFoundryMessageInput(value: unknown): value is FoundryMessageInput {
  if (typeof value === "string") return true;
  if (!Array.isArray(value)) return false;
  return value.every((part) => {
    if (!part || typeof part !== "object") return false;
    const candidate = part as Record<string, unknown>;
    if (!["text", "image", "video", "document"].includes(String(candidate.type))) {
      return false;
    }
    if (candidate.text !== undefined && typeof candidate.text !== "string") return false;
    if (candidate.source === undefined) return true;
    if (!candidate.source || typeof candidate.source !== "object") return false;
    const source = candidate.source as Record<string, unknown>;
    return (
      (source.type === "base64" || source.type === "url") &&
      typeof source.media_type === "string" &&
      (source.data === undefined || typeof source.data === "string") &&
      (source.url === undefined || typeof source.url === "string")
    );
  });
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new RequestError(413, "Request body exceeds the 1 MB limit.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

function eventFilter(url: URL): EventFilter {
  const afterValue = url.searchParams.get("after");
  const limitValue = url.searchParams.get("limit");
  const after = afterValue === null ? undefined : Number(afterValue);
  const limit = limitValue === null ? undefined : Number(limitValue);
  return {
    ...(after !== undefined && Number.isFinite(after) ? { after } : {}),
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(url.searchParams.get("agent")
      ? { agent: url.searchParams.get("agent")! }
      : {}),
    ...(url.searchParams.get("runId")
      ? { runId: url.searchParams.get("runId")! }
      : {}),
    ...(url.searchParams.get("category")
      ? {
          category: url.searchParams.get(
            "category",
          )! as EventFilter["category"],
        }
      : {}),
  };
}

function matches(event: FoundryEvent, filter: EventFilter): boolean {
  if (filter.after !== undefined && event.sequence <= filter.after) return false;
  if (filter.agent && event.agent !== filter.agent) return false;
  if (filter.runId && event.runId !== filter.runId) return false;
  if (filter.category && event.category !== filter.category) return false;
  return true;
}

function agentRoute(pathname: string): string | null {
  const prefix = "/api/agents/";
  const suffix = "/runs";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const encoded = pathname.slice(prefix.length, -suffix.length);
  if (!encoded) return null;
  try {
    return encoded.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function installationFrom(value: unknown): {
  agentId: string;
  installation: AgentInstallation;
} {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Installation body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const kinds = new Set<AgentInstallationKind>([
    "tool",
    "application",
    "mcp",
  ]);
  if (typeof body.agentId !== "string" || !body.agentId) {
    throw new RequestError(400, "agentId is required.");
  }
  if (typeof body.kind !== "string" || !kinds.has(body.kind as AgentInstallationKind)) {
    throw new RequestError(400, "kind is invalid.");
  }
  if (typeof body.id !== "string" || !body.id) {
    throw new RequestError(400, "id is required.");
  }
  return {
    agentId: body.agentId,
    installation: {
      kind: body.kind as AgentInstallationKind,
      id: body.id,
      ...(body.config !== undefined ? { config: body.config } : {}),
    },
  };
}

function foundryRequestFrom(value: unknown): FoundryRequest {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Foundry request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  for (const key of ["agentId", "conversationId", "workspaceId", "message"] as const) {
    if (typeof body[key] !== "string" || !body[key]) {
      throw new RequestError(400, `${key} is required.`);
    }
  }
  return body as unknown as FoundryRequest;
}

export interface FoundryServerOptions {
  host?: string;
  port?: number;
}

export class FoundryServer {
  private readonly server: Server;
  private readonly eventStreams = new Set<ServerResponse>();
  private addressInfo: AddressInfo | null = null;

  constructor(
    private readonly runtime: FoundryRuntime,
    private readonly options: FoundryServerOptions = {},
  ) {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async listen(): Promise<{ host: string; port: number; url: string }> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 4141;
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Foundry server did not receive a TCP address.");
    }
    this.addressInfo = address;
    return { host, port: address.port, url: `http://${host}:${address.port}` };
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    for (const stream of this.eventStreams) stream.end();
    this.eventStreams.clear();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    this.addressInfo = null;
  }

  address(): AddressInfo | null {
    return this.addressInfo;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://foundry.local");
      const method = request.method ?? "GET";
      if (
        method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        url.pathname !== "/health"
      ) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; connect-src 'self'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        response.end(renderDashboard());
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        json(response, 200, await this.runtime.health());
        return;
      }
      if (method === "GET" && url.pathname === "/api/manifest") {
        const definitions = Object.fromEntries(
          this.runtime.agents.map((agent) => [
            agent.route,
            {
              capabilities: this.runtime.capabilityManifest(agent.route),
              surfaces: this.runtime.nativeManifest(agent.route),
            },
          ]),
        );
        json(response, 200, {
          agents: this.runtime.manifest,
          application: this.runtime.applicationManifest,
          definitions,
        });
        return;
      }
      if (method === "GET" && url.pathname === "/api/agents") {
        json(response, 200, this.runtime.manifest.agents);
        return;
      }
      if (url.pathname === "/api/agent-instances" && method === "GET") {
        json(response, 200, await this.runtime.listAgentInstances(url.searchParams.get("definition") ?? undefined));
        return;
      }
      if (url.pathname === "/api/agent-instances" && method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.definitionId !== "string") throw new RequestError(400, "definitionId is required.");
        json(response, 201, await this.runtime.createAgent(body.definitionId, {
          ...(typeof body.id === "string" ? { id: body.id } : {}),
          ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
          ...(body.context && typeof body.context === "object" ? { context: body.context as Record<string, unknown> } : {}),
          ...(Array.isArray(body.installations) ? { installations: body.installations as CreateAgentInstanceOptions["installations"] } : {}),
          ...(Array.isArray(body.playbooks) ? { playbooks: body.playbooks as CreateAgentInstanceOptions["playbooks"] } : {}),
        }));
        return;
      }
      const instanceConfiguration = url.pathname.match(/^\/api\/agent-instances\/([^/]+)$/);
      if (instanceConfiguration && method === "PATCH") {
        const body = await readJson(request) as Record<string, unknown>;
        json(response, 200, await this.runtime.configureAgent(
          decodeURIComponent(instanceConfiguration[1]!),
          {
            ...(body.context && typeof body.context === "object" ? { context: body.context as Record<string, unknown> } : {}),
            ...(Array.isArray(body.installations) ? { installations: body.installations as NonNullable<CreateAgentInstanceOptions["installations"]> } : {}),
            ...(Array.isArray(body.playbooks) ? { playbooks: body.playbooks as NonNullable<CreateAgentInstanceOptions["playbooks"]> } : {}),
          },
        ));
        return;
      }
      const instancePlaybooks = url.pathname.match(/^\/api\/agent-instances\/([^/]+)\/playbooks$/);
      if (instancePlaybooks && method === "PUT") {
        const body = await readJson(request) as Record<string, unknown>;
        if (!Array.isArray(body.playbooks)) throw new RequestError(400, "playbooks must be an array.");
        json(response, 200, await this.runtime.setAgentPlaybooks(
          decodeURIComponent(instancePlaybooks[1]!),
          body.playbooks as NonNullable<CreateAgentInstanceOptions["playbooks"]>,
        ));
        return;
      }
      if (url.pathname === "/api/playbook-subscriptions" && method === "GET") {
        json(
          response,
          200,
          await this.runtime.listPlaybookSubscriptions(
            url.searchParams.get("workspace") ?? undefined,
          ),
        );
        return;
      }
      if (url.pathname === "/api/activations" && method === "GET") {
        json(
          response,
          200,
          await this.runtime.listActivations(
            url.searchParams.get("workspace") ?? undefined,
          ),
        );
        return;
      }
      if (url.pathname === "/api/playbook-subscriptions" && method === "PUT") {
        json(
          response,
          200,
          await this.runtime.putPlaybookSubscription(
            await readJson(request) as never,
          ),
        );
        return;
      }
      const subscriptionDelete = url.pathname.match(
        /^\/api\/playbook-subscriptions\/([^/]+)$/,
      );
      if (subscriptionDelete && method === "DELETE") {
        json(response, 200, {
          removed: await this.runtime.deletePlaybookSubscription(
            decodeURIComponent(subscriptionDelete[1]!),
          ),
        });
        return;
      }
      if (url.pathname === "/api/conversations" && method === "GET") {
        const agentId = url.searchParams.get("agent");
        if (!agentId) throw new RequestError(400, "agent query is required.");
        json(response, 200, await this.runtime.listConversations(agentId));
        return;
      }
      if (url.pathname === "/api/conversations" && method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.agentId !== "string") throw new RequestError(400, "agentId is required.");
        json(response, 201, await this.runtime.createConversation(body.agentId, {
          ...(typeof body.id === "string" ? { id: body.id } : {}),
          ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(body.context && typeof body.context === "object" ? { context: body.context as Record<string, unknown> } : {}),
        }));
        return;
      }
      const conversationMessage = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (conversationMessage && method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.agentId !== "string" || !isFoundryMessageInput(body.message)) {
          throw new RequestError(400, "agentId and message are required.");
        }
        json(response, 202, await this.runtime.send(
          body.agentId,
          decodeURIComponent(conversationMessage[1]!),
          body.message,
          {
            ...(body.payload !== undefined ? { payload: body.payload } : {}),
            ...(body.context && typeof body.context === "object" ? { context: body.context as Record<string, unknown> } : {}),
          },
        ));
        return;
      }
      const workspaceItem = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(inbox|tasks)\/([^/]+)$/);
      if (workspaceItem && method === "PATCH") {
        const workspaceId = decodeURIComponent(workspaceItem[1]!);
        const surface = workspaceItem[2]!;
        const itemId = decodeURIComponent(workspaceItem[3]!);
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.status !== "string") throw new RequestError(400, "status is required.");
        if (surface === "inbox") {
          if (!["pending", "resolved", "dismissed"].includes(body.status)) {
            throw new RequestError(400, "Invalid shared inbox status.");
          }
          json(response, 200, await this.runtime.updateSharedInbox(
            workspaceId,
            itemId,
            body.status as SharedInboxItem["status"],
          ));
          return;
        }
        if (!["open", "in-progress", "completed", "cancelled"].includes(body.status)) {
          throw new RequestError(400, "Invalid task status.");
        }
        json(response, 200, await this.runtime.updateTask(
          workspaceId,
          itemId,
          body.status as FoundryTask["status"],
        ));
        return;
      }
      const workspaceSurface = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(entries|inbox|tasks|environment)$/);
      if (workspaceSurface) {
        const workspaceId = decodeURIComponent(workspaceSurface[1]!);
        const surface = workspaceSurface[2]!;
        if (method === "GET" && surface === "entries") {
          json(response, 200, await this.runtime.listWorkspaceEntries(workspaceId));
          return;
        }
        if (method === "PUT" && surface === "entries") {
          const body = await readJson(request) as Record<string, unknown>;
          if (typeof body.key !== "string") throw new RequestError(400, "key is required.");
          json(response, 200, await this.runtime.putWorkspaceEntry(workspaceId, body.key, body.value));
          return;
        }
        if (method === "GET" && surface === "inbox") {
          json(response, 200, await this.runtime.listSharedInbox(workspaceId));
          return;
        }
        if (method === "POST" && surface === "inbox") {
          const body = await readJson(request) as Record<string, unknown>;
          if (typeof body.topic !== "string") throw new RequestError(400, "topic is required.");
          json(response, 201, await this.runtime.postSharedInbox({
            workspaceId,
            ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
            ...(typeof body.conversationId === "string" ? { conversationId: body.conversationId } : {}),
            topic: body.topic,
            payload: body.payload,
            status: "pending",
          }));
          return;
        }
        if (method === "GET" && surface === "tasks") {
          json(response, 200, await this.runtime.listTasks(workspaceId));
          return;
        }
        if (method === "POST" && surface === "tasks") {
          const body = await readJson(request) as Record<string, unknown>;
          if (typeof body.title !== "string") throw new RequestError(400, "title is required.");
          json(response, 201, await this.runtime.createTask({
            workspaceId,
            ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
            ...(typeof body.conversationId === "string" ? { conversationId: body.conversationId } : {}),
            title: body.title,
            ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
            status: "open",
          }));
          return;
        }
        if (method === "GET" && surface === "environment") {
          json(response, 200, await this.runtime.listDataEnvironment({
            workspaceId,
            ...(url.searchParams.get("agent") ? { agentId: url.searchParams.get("agent")! } : {}),
            ...(url.searchParams.get("conversation") ? { conversationId: url.searchParams.get("conversation")! } : {}),
          }));
          return;
        }
      }
      if (method === "GET" && url.pathname === "/api/capabilities") {
        const definition = url.searchParams.get("definition");
        if (!definition) throw new Error("definition is required");
        json(response, 200, this.runtime.capabilityManifest(definition));
        return;
      }
      if (method === "GET" && url.pathname === "/api/surfaces") {
        const definition = url.searchParams.get("definition");
        if (!definition) throw new Error("definition is required");
        json(response, 200, this.runtime.nativeManifest(definition));
        return;
      }
      if (url.pathname === "/api/installations" && method === "GET") {
        const agentId = url.searchParams.get("agent");
        if (!agentId) throw new RequestError(400, "agent query is required.");
        json(response, 200, await this.runtime.listInstallations(agentId));
        return;
      }
      if (url.pathname === "/api/installations" && method === "PUT") {
        const parsed = installationFrom(await readJson(request));
        const agent = await this.runtime.installCapability(
          parsed.agentId,
          parsed.installation,
        );
        json(response, 200, agent);
        return;
      }
      if (url.pathname === "/api/installations" && method === "DELETE") {
        const parsed = installationFrom(await readJson(request));
        const agent = await this.runtime.uninstallCapability(
          parsed.agentId,
          parsed.installation,
        );
        json(response, 200, agent);
        return;
      }
      if (method === "GET" && url.pathname === "/api/runs") {
        json(response, 200, await this.runtime.listRuns(url.searchParams.get("agent") ?? undefined));
        return;
      }
      if (method === "GET" && url.pathname === "/api/transmissions") {
        json(response, 200, this.runtime.applicationManifest.transmissions);
        return;
      }
      if (method === "GET" && url.pathname === "/api/accounts") {
        json(response, 200, await this.runtime.listAccounts());
        return;
      }
      if (url.pathname === "/api/routes" && method === "GET") {
        json(response, 200, await this.runtime.listRoutes());
        return;
      }
      if (url.pathname === "/api/routes" && method === "PUT") {
        const route = Schema.decodeUnknownSync(Route)(await readJson(request));
        json(response, 200, await this.runtime.putRoute(route));
        return;
      }
      const routeDelete = url.pathname.match(/^\/api\/routes\/([^/]+)$/);
      if (routeDelete && method === "DELETE") {
        const id = Schema.decodeUnknownSync(RouteId)(
          decodeURIComponent(routeDelete[1]!),
        );
        await this.runtime.removeRoute(id);
        json(response, 200, { removed: true });
        return;
      }
      if (url.pathname === "/api/bindings" && method === "GET") {
        json(response, 200, await this.runtime.listBindings());
        return;
      }
      if (url.pathname === "/api/bindings" && method === "PUT") {
        const binding = Schema.decodeUnknownSync(AgentBinding)(
          await readJson(request),
        );
        json(response, 200, await this.runtime.putBinding(binding));
        return;
      }
      const bindingDelete = url.pathname.match(/^\/api\/bindings\/([^/]+)$/);
      if (bindingDelete && method === "DELETE") {
        const id = Schema.decodeUnknownSync(BindingId)(
          decodeURIComponent(bindingDelete[1]!),
        );
        await this.runtime.removeBinding(id);
        json(response, 200, { removed: true });
        return;
      }
      if (url.pathname === "/api/grants/resolve" && method === "POST") {
        const requestBody = Schema.decodeUnknownSync(
          Schema.Struct({
            runId: RunId,
            agentId: AgentId,
            originRouteId: Schema.optional(RouteId),
          }),
        )(await readJson(request));
        json(response, 200, await this.runtime.resolveGrant(requestBody));
        return;
      }
      if (url.pathname === "/api/application-connections" && method === "GET") {
        json(response, 200, this.runtime.listApplicationConnections());
        return;
      }
      const connectionReconnect = url.pathname.match(
        /^\/api\/application-connections\/([^/]+)\/reconnect$/,
      );
      if (connectionReconnect && method === "POST") {
        await this.runtime.reconnectApplicationConnection(
          decodeURIComponent(connectionReconnect[1]!),
        );
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/events" && method === "GET") {
        const filter = eventFilter(url);
        if (request.headers.accept?.includes("text/event-stream")) {
          this.streamEvents(request, response, filter);
        } else {
          json(response, 200, this.runtime.observability.list(filter));
        }
        return;
      }
      const transmissionFire = url.pathname.match(/^\/api\/transmissions\/([^/]+)\/fire$/);
      if (transmissionFire && method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.eventId !== "string" || typeof body.threadKey !== "string") {
          throw new RequestError(400, "eventId and threadKey are required.");
        }
        json(response, 202, await this.runtime.dispatchInbound({
          routeId: decodeURIComponent(transmissionFire[1]!),
          eventId: body.eventId,
          threadKey: body.threadKey,
          raw: body.raw,
        }));
        return;
      }
      const transmissionDeliver = url.pathname.match(/^\/api\/transmissions\/([^/]+)\/deliver$/);
      if (transmissionDeliver && method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.agentId !== "string" || typeof body.runId !== "string") {
          throw new RequestError(400, "agentId and runId are required.");
        }
        json(response, 200, await this.runtime.dispatchOutbound({
          routeId: decodeURIComponent(transmissionDeliver[1]!),
          agentId: body.agentId,
          runId: body.runId,
          payload: body.payload,
        }));
        return;
      }
      const route = agentRoute(url.pathname);
      if (route && method === "POST") {
        json(response, 202, await this.runtime.request(route, foundryRequestFrom(await readJson(request))));
        return;
      }
      const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
      if (cancelMatch && method === "POST") {
        json(response, 200, {
          cancelled: await this.runtime.cancel(decodeURIComponent(cancelMatch[1]!)),
        });
        return;
      }
      const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (eventsMatch && method === "GET") {
        json(
          response,
          200,
          this.runtime.observability.list({
            runId: decodeURIComponent(eventsMatch[1]!),
            limit: 5_000,
          }),
        );
        return;
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && method === "GET") {
        const run = await this.runtime.getRun(decodeURIComponent(runMatch[1]!));
        if (!run) throw new RequestError(404, "Foundry run was not found.");
        json(response, 200, run);
        return;
      }
      throw new RequestError(404, "Foundry route was not found.");
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 400;
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) json(response, status, { error: message });
      else response.end();
    }
  }

  private streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    filter: EventFilter,
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.eventStreams.add(response);
    response.write(": glove-foundry\n\n");
    for (const event of this.runtime.observability.list(filter)) {
      response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const unsubscribe = this.runtime.observability.subscribe((event) => {
      if (matches(event, filter)) {
        response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    });
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      this.eventStreams.delete(response);
    };
    request.once("close", close);
    response.once("close", close);
  }
}
