import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Effect, Schema } from "effect";
import { renderDashboard } from "./dashboard.js";
import type { FoundryBrandingConfig } from "./config.js";
import {
  AgentId,
  AgentBinding,
  BindingId,
  Route,
  RouteId,
  RunId,
} from "./domain.js";
import type { EventFilter, FoundryEvent } from "./observability.js";
import type { FoundryRun, FoundryRuntime } from "./runtime.js";
import type {
  AgentInstallation,
  AgentInstallationKind,
} from "./capabilities.js";
import type {
  AgentInstance,
  CreateAgentInstanceOptions,
  FoundryMessageInput,
  FoundryRequest,
  FoundryResult,
  FoundryTask,
  SharedInboxItem,
} from "./primitives.js";

const MAX_BODY_BYTES = 1024 * 1024;

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized === "localhost." ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

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
    if (candidate.name !== undefined && typeof candidate.name !== "string") return false;
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

async function readJson(
  request: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new RequestError(413, `Request body exceeds the ${maxBytes}-byte limit.`);
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

interface OpenAiChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
    readonly image_url?: string | { readonly url?: string };
  }>;
}

interface OpenAiChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<OpenAiChatMessage>;
  readonly stream: boolean;
  readonly user?: string;
  readonly conversationId?: string;
}

interface OpenAiResponsesRequest {
  readonly model: string;
  readonly input: FoundryMessageInput;
  readonly stream: boolean;
  readonly instructions?: string;
  readonly store: boolean;
  readonly user?: string;
  readonly conversationId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

interface FoundryControlRunRequest {
  readonly model: string;
  readonly input: FoundryMessageInput;
  readonly conversationId?: string;
  readonly user?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

function openAiChatRequestFrom(value: unknown): OpenAiChatRequest {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Chat completion body must be an object.");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.model !== "string" || !body.model) {
    throw new RequestError(400, "model is required and must name a Foundry agent instance.");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new RequestError(400, "messages must be a non-empty array.");
  }
  const messages = body.messages.map((item) => {
    if (!item || typeof item !== "object") throw new RequestError(400, "Every message must be an object.");
    const message = item as Record<string, unknown>;
    if (!["system", "user", "assistant", "tool"].includes(String(message.role))) {
      throw new RequestError(400, "Every message must have a supported role.");
    }
    if (typeof message.content !== "string" && !Array.isArray(message.content)) {
      throw new RequestError(400, "Every message must have string or array content.");
    }
    return message as unknown as OpenAiChatMessage;
  });
  if (![...messages].reverse().some((message) => message.role === "user")) {
    throw new RequestError(400, "messages must include a user message.");
  }
  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    ...(typeof body.user === "string" && body.user ? { user: body.user } : {}),
    ...(typeof body.conversation_id === "string" && body.conversation_id
      ? { conversationId: body.conversation_id }
      : {}),
  };
}

function openAiPartText(message: OpenAiChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("\n");
}

function openAiCurrentInput(
  messages: ReadonlyArray<OpenAiChatMessage>,
  includePrior: boolean,
): FoundryMessageInput {
  let userIndex = messages.length - 1;
  while (userIndex >= 0 && messages[userIndex]?.role !== "user") userIndex--;
  const current = messages[userIndex]!;
  const prior = includePrior
    ? messages.slice(0, userIndex).map((message) =>
        `<message role="${message.role}">\n${openAiPartText(message)}\n</message>`,
      ).join("\n")
    : "";
  if (typeof current.content === "string") {
    return prior ? `${prior}\n<current-user-message>\n${current.content}\n</current-user-message>` : current.content;
  }
  const parts: Array<Exclude<FoundryMessageInput, string>[number]> = [];
  if (prior) parts.push({ type: "text", text: prior });
  for (const part of current.content) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (url) parts.push({ type: "image", source: { type: "url", media_type: "image/*", url } });
    }
  }
  if (parts.length === 0) throw new RequestError(400, "The current user message has no supported content.");
  return parts;
}

function openAiOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function responseContentPart(value: unknown): Exclude<FoundryMessageInput, string>[number] | null {
  if (!value || typeof value !== "object") return null;
  const part = value as Record<string, unknown>;
  if ((part.type === "input_text" || part.type === "text") && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.type === "input_image" || part.type === "image_url") {
    const image = typeof part.image_url === "string"
      ? part.image_url
      : part.image_url && typeof part.image_url === "object"
        ? (part.image_url as Record<string, unknown>).url
        : undefined;
    if (typeof image === "string" && image) {
      return { type: "image", source: { type: "url", media_type: "image/*", url: image } };
    }
  }
  if (part.type === "input_file") {
    if (typeof part.file_url === "string" && part.file_url) {
      return {
        type: "document",
        source: { type: "url", media_type: "application/octet-stream", url: part.file_url },
      };
    }
    if (typeof part.file_data === "string" && part.file_data) {
      const dataUrl = part.file_data.match(/^data:([^;,]+);base64,(.+)$/s);
      return {
        type: "document",
        source: dataUrl
          ? { type: "base64", media_type: dataUrl[1]!, data: dataUrl[2]! }
          : { type: "base64", media_type: "application/octet-stream", data: part.file_data },
      };
    }
  }
  return null;
}

function responsesInput(value: unknown, instructions?: unknown): FoundryMessageInput {
  const prefix = typeof instructions === "string" && instructions.trim()
    ? `<instructions>\n${instructions}\n</instructions>`
    : "";
  if (typeof value === "string") return prefix ? `${prefix}\n${value}` : value;
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestError(400, "input must be a non-empty string or array.");
  }
  const messages = value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  let userIndex = messages.length - 1;
  while (userIndex >= 0 && messages[userIndex]?.role !== "user") userIndex--;
  const selected = userIndex >= 0 ? messages[userIndex]! : messages[messages.length - 1]!;
  const prior = messages.slice(0, Math.max(userIndex, 0)).map((item) => {
    const content = typeof item.content === "string"
      ? item.content
      : Array.isArray(item.content)
        ? item.content.map((part) => {
            const normalized = responseContentPart(part);
            return normalized?.type === "text" ? normalized.text : normalized ? `[${normalized.type}]` : "";
          }).filter(Boolean).join("\n")
        : "";
    return `<message role="${typeof item.role === "string" ? item.role : "user"}">\n${content}\n</message>`;
  }).join("\n");
  const content = selected.content ?? selected;
  const parts = (typeof content === "string"
    ? [{ type: "text" as const, text: content }]
    : Array.isArray(content)
      ? content.map(responseContentPart).filter((part): part is Exclude<FoundryMessageInput, string>[number] => part !== null)
      : [responseContentPart(content)].filter((part): part is Exclude<FoundryMessageInput, string>[number] => part !== null));
  const context = [prefix, prior].filter(Boolean).join("\n");
  if (context) parts.unshift({ type: "text", text: context });
  if (parts.length === 0) throw new RequestError(400, "input has no supported text, image, or file content.");
  return parts;
}

function openAiResponsesRequestFrom(value: unknown): OpenAiResponsesRequest {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Responses body must be an object.");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.model !== "string" || !body.model) {
    throw new RequestError(400, "model is required and must name a Foundry agent instance.");
  }
  return {
    model: body.model,
    input: responsesInput(body.input, body.instructions),
    stream: body.stream === true,
    store: body.store !== false,
    ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}),
    ...(typeof body.user === "string" && body.user ? { user: body.user } : {}),
    ...(typeof body.conversation_id === "string" && body.conversation_id
      ? { conversationId: body.conversation_id }
      : {}),
    ...(body.context && typeof body.context === "object"
      ? { context: body.context as Readonly<Record<string, unknown>> }
      : {}),
  };
}

function foundryControlRunRequestFrom(value: unknown): FoundryControlRunRequest {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Run body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const model = typeof body.model === "string" ? body.model : body.agent_id;
  const input = body.input ?? body.message;
  if (typeof model !== "string" || !model) {
    throw new RequestError(400, "model or agent_id is required.");
  }
  if (!isFoundryMessageInput(input)) {
    throw new RequestError(400, "input or message must be a supported Foundry message.");
  }
  return {
    model,
    input,
    ...(typeof body.conversation_id === "string" && body.conversation_id
      ? { conversationId: body.conversation_id }
      : {}),
    ...(typeof body.user === "string" && body.user ? { user: body.user } : {}),
    ...(body.context && typeof body.context === "object"
      ? { context: body.context as Readonly<Record<string, unknown>> }
      : {}),
  };
}

function foundrySteerInputFrom(value: unknown): FoundryMessageInput {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Steering body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const input = body.input ?? body.message ?? body.guidance;
  if (!isFoundryMessageInput(input)) {
    throw new RequestError(400, "input, message, or guidance must be a supported Foundry message.");
  }
  return input;
}

function approvalDecisionFrom(value: unknown): "approve" | "deny" {
  if (!value || typeof value !== "object") {
    throw new RequestError(400, "Approval body must be an object.");
  }
  const decision = (value as Record<string, unknown>).decision;
  if (decision !== "approve" && decision !== "deny") {
    throw new RequestError(400, 'decision must be "approve" or "deny".');
  }
  return decision;
}

function approvalFilter(url: URL): {
  runId?: string;
  status?: "pending" | "approved" | "denied" | "expired" | "cancelled";
} {
  const runId = url.searchParams.get("runId") ?? url.searchParams.get("run_id") ?? undefined;
  const rawStatus = url.searchParams.get("status");
  const statuses = ["pending", "approved", "denied", "expired", "cancelled"] as const;
  if (rawStatus && !(statuses as readonly string[]).includes(rawStatus)) {
    throw new RequestError(400, "Unknown approval status filter.");
  }
  return {
    ...(runId ? { runId } : {}),
    ...(rawStatus ? { status: rawStatus as (typeof statuses)[number] } : {}),
  };
}

export interface FoundryServerOptions {
  host?: string;
  port?: number;
  branding?: FoundryBrandingConfig;
  /** Bounded JSON body allowance for message-bearing multimodal endpoints. */
  messageBodyBytes?: number;
}

export class FoundryServer {
  private readonly server: Server;
  private readonly eventStreams = new Set<ServerResponse>();
  private addressInfo: AddressInfo | null = null;

  constructor(
    private readonly runtime: FoundryRuntime,
    private readonly options: FoundryServerOptions = {},
  ) {
    if (
      options.messageBodyBytes !== undefined &&
      (!Number.isInteger(options.messageBodyBytes) ||
        options.messageBodyBytes < MAX_BODY_BYTES ||
        options.messageBodyBytes > 128 * 1024 * 1024)
    ) {
      throw new Error("Foundry messageBodyBytes must be an integer from 1048576 to 134217728.");
    }
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async listen(): Promise<{ host: string; port: number; url: string }> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 4141;
    if (!isLoopbackHost(host) && !this.runtime.application.requestAuthorization) {
      throw new Error(
        `Foundry refuses to bind ${host} without application.requestAuthorization. ` +
        "Keep the runtime on loopback or provide a user-owned authorization adapter.",
      );
    }
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
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      // A Foundry process must be able to stop even when an inspector or API
      // client retains a keep-alive socket. The server is already closed to
      // new work before existing connections are drained here.
      this.server.closeAllConnections();
    });
    this.addressInfo = null;
  }

  address(): AddressInfo | null {
    return this.addressInfo;
  }

  private async authorizeRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    method: string,
  ): Promise<boolean> {
    const adapter = this.runtime.application.requestAuthorization;
    if (!adapter) return true;
    let authorized = false;
    try {
      authorized = await Effect.runPromise(adapter.authorize({
        method,
        path: url.pathname,
        query: url.search,
        ...(typeof request.headers.authorization === "string"
          ? { authorization: request.headers.authorization }
          : {}),
        ...(typeof request.headers.cookie === "string"
          ? { cookie: request.headers.cookie }
          : {}),
        ...(request.socket.remoteAddress
          ? { remoteAddress: request.socket.remoteAddress }
          : {}),
      }));
    } catch {
      // Authorization adapter errors deny access without disclosing provider
      // or credential details through the public HTTP surface.
    }
    if (authorized) return true;
    response.writeHead(401, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "www-authenticate": adapter.challenge ?? 'Bearer realm="Glove Foundry"',
    });
    response.end('{"error":"Foundry authorization is required."}');
    return false;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://foundry.local");
      const method = request.method ?? "GET";
      if (!(await this.authorizeRequest(request, response, url, method))) return;
      if (
        method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/v1/") &&
        url.pathname !== "/health" &&
        url.pathname !== "/health/detailed"
      ) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          // The inspector's stylesheet pulls the Glove brand typefaces from
          // Google Fonts, so style-src and font-src name those two origins and
          // nothing else. Everything executable stays same-origin.
          "content-security-policy": [
            "default-src 'self'",
            "script-src 'unsafe-inline' 'self'",
            "style-src 'unsafe-inline' 'self' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data:",
            "connect-src 'self'",
          ].join("; "),
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        response.end(renderDashboard(this.options.branding));
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        json(response, 200, await this.runtime.health());
        return;
      }
      if (method === "GET" && url.pathname === "/health/detailed") {
        const health = await this.runtime.health();
        json(response, 200, {
          ...health,
          connections: this.runtime.listApplicationConnections(),
          runs: await this.runtime.listRuns(),
        });
        return;
      }
      if (method === "GET" && url.pathname === "/v1/models") {
        const instances = await this.runtime.listAgentInstances();
        json(response, 200, {
          object: "list",
          data: instances.map((instance) => ({
            id: instance.id,
            object: "model",
            created: Math.floor(Date.parse(instance.createdAt) / 1_000),
            owned_by: `glove-foundry:${instance.definitionId}`,
          })),
        });
        return;
      }
      if (method === "POST" && url.pathname === "/v1/chat/completions") {
        await this.handleOpenAiChat(request, response, openAiChatRequestFrom(await readJson(request, this.options.messageBodyBytes)));
        return;
      }
      if (method === "POST" && url.pathname === "/v1/responses") {
        await this.handleOpenAiResponse(request, response, openAiResponsesRequestFrom(await readJson(request, this.options.messageBodyBytes)));
        return;
      }
      if (method === "GET" && url.pathname === "/v1/capabilities") {
        json(response, 200, {
          object: "foundry.capabilities",
          protocols: {
            native: true,
            openaiChatCompletions: { streaming: true, multimodalInput: true },
            openaiResponses: { streaming: true, multimodalInput: true },
            runControl: {
              create: true,
              status: true,
              events: true,
              stop: true,
              steer: true,
              steeringMode: "interrupt-and-restart",
            },
            approvals: { list: true, resolve: true, default: "deny" },
          },
          runtime: await this.runtime.health(),
        });
        return;
      }
      if (method === "POST" && url.pathname === "/v1/runs") {
        const body = foundryControlRunRequestFrom(await readJson(request, this.options.messageBodyBytes));
        const agent = await this.resolveAgent(body.model);
        const conversation = await this.resolveConversation(
          request,
          agent,
          "control",
          body.conversationId ?? body.user,
        );
        const run = await this.runtime.send(agent.id, conversation.id, body.input, {
          ...(body.context ? { context: { ...body.context, protocol: "foundry-control" } } : {
            context: { protocol: "foundry-control" },
          }),
        });
        response.setHeader("x-foundry-conversation-id", conversation.id);
        json(response, 202, run);
        return;
      }
      const v1RunEvents = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
      if (v1RunEvents && method === "GET") {
        const runId = decodeURIComponent(v1RunEvents[1]!);
        if (!await this.runtime.getRun(runId)) throw new RequestError(404, "Foundry run was not found.");
        const filter = { ...eventFilter(url), runId, limit: 5_000 };
        if (request.headers.accept?.includes("text/event-stream")) {
          this.streamEvents(request, response, filter, { closeOnTerminalRun: true });
        } else {
          json(response, 200, this.runtime.observability.list(filter));
        }
        return;
      }
      const v1RunStop = url.pathname.match(/^\/v1\/runs\/([^/]+)\/stop$/);
      if (v1RunStop && method === "POST") {
        const runId = decodeURIComponent(v1RunStop[1]!);
        if (!await this.runtime.getRun(runId)) throw new RequestError(404, "Foundry run was not found.");
        json(response, 200, { id: runId, stopped: await this.runtime.cancel(runId) });
        return;
      }
      const v1RunSteer = url.pathname.match(/^\/v1\/runs\/([^/]+)\/steer$/);
      if (v1RunSteer && method === "POST") {
        const runId = decodeURIComponent(v1RunSteer[1]!);
        if (!await this.runtime.getRun(runId)) throw new RequestError(404, "Foundry run was not found.");
        json(response, 202, await this.runtime.steer(runId, foundrySteerInputFrom(await readJson(request, this.options.messageBodyBytes))));
        return;
      }
      const v1Run = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (v1Run && method === "GET") {
        const run = await this.runtime.getRun(decodeURIComponent(v1Run[1]!));
        if (!run) throw new RequestError(404, "Foundry run was not found.");
        json(response, 200, run);
        return;
      }
      if (method === "GET" && url.pathname === "/v1/approvals") {
        json(response, 200, await this.runtime.listApprovals(approvalFilter(url)));
        return;
      }
      const v1Approval = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
      if (v1Approval && method === "POST") {
        json(response, 200, await this.runtime.resolveApproval(
          decodeURIComponent(v1Approval[1]!),
          approvalDecisionFrom(await readJson(request)),
        ));
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
      const conversationItem = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (conversationItem && method === "PATCH") {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.agentId !== "string") throw new RequestError(400, "agentId is required.");
        if (body.title !== undefined && typeof body.title !== "string") {
          throw new RequestError(400, "title must be a string.");
        }
        if (typeof body.title === "string" && (!body.title.trim() || body.title.trim().length > 120)) {
          throw new RequestError(400, "title must contain 1 to 120 characters.");
        }
        if (body.context !== undefined && (!body.context || typeof body.context !== "object" || Array.isArray(body.context))) {
          throw new RequestError(400, "context must be an object.");
        }
        json(response, 200, await this.runtime.updateConversation(
          body.agentId,
          decodeURIComponent(conversationItem[1]!),
          {
            ...(typeof body.title === "string" ? { title: body.title } : {}),
            ...(body.context && typeof body.context === "object"
              ? { context: body.context as Record<string, unknown> }
              : {}),
          },
        ));
        return;
      }
      const conversationMessage = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (conversationMessage && method === "GET") {
        const agentId = url.searchParams.get("agent");
        if (!agentId) throw new RequestError(400, "agent query is required.");
        const limitValue = url.searchParams.get("limit");
        const offsetValue = url.searchParams.get("offset");
        const limit = limitValue === null ? undefined : Number(limitValue);
        const offset = offsetValue === null ? undefined : Number(offsetValue);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
          throw new RequestError(400, "limit must be an integer from 1 to 500.");
        }
        if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
          throw new RequestError(400, "offset must be a non-negative integer.");
        }
        json(response, 200, await this.runtime.conversationTranscript(
          agentId,
          decodeURIComponent(conversationMessage[1]!),
          {
            ...(offset !== undefined ? { offset } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
        ));
        return;
      }
      if (conversationMessage && method === "POST") {
        const body = await readJson(request, this.options.messageBodyBytes) as Record<string, unknown>;
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
      if (url.pathname === "/api/approvals" && method === "GET") {
        json(response, 200, await this.runtime.listApprovals(approvalFilter(url)));
        return;
      }
      const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
      if (approvalMatch && method === "POST") {
        json(response, 200, await this.runtime.resolveApproval(
          decodeURIComponent(approvalMatch[1]!),
          approvalDecisionFrom(await readJson(request)),
        ));
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
          ...(typeof body.conversationKey === "string" ? { conversationKey: body.conversationKey } : {}),
          ...(body.conversationScope === "route" || body.conversationScope === "agent"
            ? { conversationScope: body.conversationScope }
            : {}),
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
      const steerMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/steer$/);
      if (steerMatch && method === "POST") {
        const runId = decodeURIComponent(steerMatch[1]!);
        if (!await this.runtime.getRun(runId)) {
          throw new RequestError(404, "Foundry run was not found.");
        }
        json(
          response,
          202,
          await this.runtime.steer(
            runId,
            foundrySteerInputFrom(await readJson(request, this.options.messageBodyBytes)),
          ),
        );
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

  private async handleOpenAiChat(
    request: IncomingMessage,
    response: ServerResponse,
    body: OpenAiChatRequest,
  ): Promise<void> {
    const agent = await this.resolveAgent(body.model);
    const requestedConversation =
      request.headers["x-foundry-conversation-id"] ?? body.conversationId ?? body.user;
    const conversations = await this.runtime.listConversations(agent.id);
    const conversation = await this.resolveConversation(request, agent, "openai", requestedConversation);
    const existing = conversations.some((item) => item.id === conversation.id);
    const run = await this.runtime.send(
      agent.id,
      conversation.id,
      openAiCurrentInput(body.messages, !existing),
      { context: { protocol: "openai-chat-completions" } },
    );
    const completionId = `chatcmpl-${run.id}`;
    const created = Math.floor(Date.now() / 1_000);
    response.setHeader("x-foundry-conversation-id", conversation.id);

    if (!body.stream) {
      const completed = await this.runtime.waitForRun<FoundryResult>(run.id, { timeoutMs: run.timeoutMs });
      if (!completed || completed.status !== "completed") {
        throw new RequestError(502, completed?.error ?? "Foundry did not complete the chat request.");
      }
      json(response, 200, {
        id: completionId,
        object: "chat.completion",
        created,
        model: agent.id,
        choices: [{
          index: 0,
          message: { role: "assistant", content: openAiOutput(completed.output?.value) },
          finish_reason: "stop",
        }],
        system_fingerprint: "glove-foundry",
      });
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-foundry-conversation-id": conversation.id,
    });
    this.eventStreams.add(response);
    const seen = new Set<string>();
    let emittedText = false;
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null): void => {
      response.write(`data: ${JSON.stringify({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: agent.id,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`);
    };
    chunk({ role: "assistant" });
    const emitEvent = (event: FoundryEvent): void => {
      if (event.runId !== run.id || seen.has(event.id)) return;
      seen.add(event.id);
      if (event.type.endsWith("text_delta")) {
        const data = event.data as { text?: unknown };
        if (typeof data.text === "string" && data.text) {
          emittedText = true;
          chunk({ content: data.text });
        }
      }
    };
    const unsubscribe = this.runtime.observability.subscribe(emitEvent);
    for (const event of this.runtime.observability.list({ runId: run.id, limit: 5_000 })) emitEvent(event);
    try {
      const completed = await this.runtime.waitForRun<FoundryResult>(run.id, { timeoutMs: run.timeoutMs });
      if (!completed || completed.status !== "completed") {
        chunk({ content: `Foundry error: ${completed?.error ?? "run did not complete"}` }, "stop");
      } else {
        if (!emittedText) chunk({ content: openAiOutput(completed.output?.value) });
        chunk({}, "stop");
      }
      response.write("data: [DONE]\n\n");
      response.end();
    } finally {
      unsubscribe();
      this.eventStreams.delete(response);
    }
  }

  private async resolveAgent(model: string): Promise<AgentInstance> {
    const instances = await this.runtime.listAgentInstances();
    const exact = instances.find((instance) => instance.id === model);
    const byDefinition = instances.filter((instance) => instance.definitionId === model);
    const agent = exact ?? (byDefinition.length === 1 ? byDefinition[0] : undefined);
    if (!agent) {
      throw new RequestError(404, `Foundry model "${model}" does not resolve to one agent instance.`);
    }
    return agent;
  }

  private async resolveConversation(
    request: IncomingMessage,
    agent: AgentInstance,
    protocol: "openai" | "responses" | "control",
    requested?: unknown,
  ): Promise<{ id: string; workspaceId: string }> {
    const header = request.headers["x-foundry-conversation-id"];
    const key = typeof header === "string" && header
      ? header
      : typeof requested === "string" && requested
        ? requested
        : undefined;
    const prefix = protocol === "openai" ? "openai" : protocol;
    const conversationId = key?.startsWith(`${prefix}-`) && key.length < 128
      ? key
      : key
        ? `${prefix}-${createHash("sha256").update(`${agent.id}\0${key}`).digest("hex").slice(0, 32)}`
        : `${prefix}-${randomUUID()}`;
    const conversations = await this.runtime.listConversations(agent.id);
    const existing = conversations.find((conversation) => conversation.id === conversationId);
    if (existing) return existing;
    return this.runtime.createConversation(agent.id, {
      id: conversationId,
      title: protocol === "control" ? "Hercules control session" : "OpenAI-compatible session",
      context: { protocol: protocol === "responses" ? "openai-responses" : protocol === "openai" ? "openai-chat-completions" : "foundry-control" },
    });
  }

  private responseObject(
    run: FoundryRun<FoundryResult>,
    request: OpenAiResponsesRequest,
    conversationId: string,
  ): Record<string, unknown> {
    const text = openAiOutput(run.output?.value);
    const status = run.status === "pending"
      ? "queued"
      : run.status === "running"
        ? "in_progress"
        : run.status;
    const completed = status === "completed";
    return {
      id: `resp_${run.id}`,
      object: "response",
      created_at: Math.floor(Date.parse(run.createdAt) / 1_000),
      completed_at: run.completedAt ? Math.floor(Date.parse(run.completedAt) / 1_000) : null,
      background: false,
      status,
      error: run.error ? { message: run.error, type: "foundry_run_error" } : null,
      incomplete_details: completed || status === "failed" || status === "cancelled"
        ? null
        : { reason: run.status },
      instructions: request.instructions ?? null,
      max_output_tokens: null,
      max_tool_calls: null,
      model: request.model,
      output: completed ? [{
        id: `msg_${run.id}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [], logprobs: [] }],
      }] : [],
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      service_tier: "default",
      store: request.store,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: [],
      top_p: 1,
      truncation: "disabled",
      user: request.user ?? null,
      metadata: {
        "glove.foundry.run_id": run.id,
        "glove.foundry.conversation_id": conversationId,
      },
      usage: completed ? {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 0,
      } : null,
    };
  }

  private async handleOpenAiResponse(
    request: IncomingMessage,
    response: ServerResponse,
    body: OpenAiResponsesRequest,
  ): Promise<void> {
    const agent = await this.resolveAgent(body.model);
    const conversation = await this.resolveConversation(
      request,
      agent,
      "responses",
      body.conversationId ?? body.user,
    );
    const run = await this.runtime.send(agent.id, conversation.id, body.input, {
      context: { ...(body.context ?? {}), protocol: "openai-responses" },
    });
    response.setHeader("x-foundry-conversation-id", conversation.id);
    if (!body.stream) {
      const completed = await this.runtime.waitForRun<FoundryResult>(run.id, { timeoutMs: run.timeoutMs });
      if (!completed) throw new RequestError(502, "Foundry did not complete the response request.");
      json(response, completed.status === "completed" ? 200 : 502, this.responseObject(completed, body, conversation.id));
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-foundry-conversation-id": conversation.id,
    });
    this.eventStreams.add(response);
    const messageId = `msg_${run.id}`;
    let sequence = 0;
    const emit = (type: string, data: Record<string, unknown>): void => {
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
    };
    const inProgress = this.responseObject({ ...run, status: "running" }, body, conversation.id);
    emit("response.created", { response: inProgress });
    emit("response.in_progress", { response: inProgress });
    emit("response.output_item.added", {
      output_index: 0,
      item: { id: messageId, type: "message", status: "in_progress", role: "assistant", content: [] },
    });
    emit("response.content_part.added", {
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    const seen = new Set<string>();
    let text = "";
    const emitEvent = (event: FoundryEvent): void => {
      if (event.runId !== run.id || seen.has(event.id) || !event.type.endsWith("text_delta")) return;
      seen.add(event.id);
      const value = event.data as { text?: unknown };
      if (typeof value.text !== "string" || !value.text) return;
      text += value.text;
      emit("response.output_text.delta", {
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta: value.text,
      });
    };
    const unsubscribe = this.runtime.observability.subscribe(emitEvent);
    for (const event of this.runtime.observability.list({ runId: run.id, limit: 5_000 })) emitEvent(event);
    try {
      const completed = await this.runtime.waitForRun<FoundryResult>(run.id, { timeoutMs: run.timeoutMs });
      if (!completed) throw new Error("Foundry did not complete the response request.");
      const output = openAiOutput(completed.output?.value);
      if (!text && output) {
        text = output;
        emit("response.output_text.delta", {
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta: output,
        });
      }
      emit("response.output_text.done", {
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        text,
      });
      emit("response.content_part.done", {
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text, annotations: [], logprobs: [] },
      });
      emit("response.output_item.done", {
        output_index: 0,
        item: {
          id: messageId,
          type: "message",
          status: completed.status === "completed" ? "completed" : "incomplete",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [], logprobs: [] }],
        },
      });
      emit(completed.status === "completed" ? "response.completed" : "response.failed", {
        response: this.responseObject(completed, body, conversation.id),
      });
      response.end();
    } finally {
      unsubscribe();
      this.eventStreams.delete(response);
    }
  }

  private streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    filter: EventFilter,
    options: { readonly closeOnTerminalRun?: boolean } = {},
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.eventStreams.add(response);
    response.write(": glove-foundry\n\n");
    const seen = new Set<string>();
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = (): void => undefined;
    const close = (end = false): void => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      this.eventStreams.delete(response);
      if (end && !response.writableEnded) response.end();
    };
    const emit = (event: FoundryEvent): void => {
      if (!matches(event, filter) || seen.has(event.id) || closed) return;
      seen.add(event.id);
      response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
      if (
        options.closeOnTerminalRun &&
        ["run.completed", "run.failed", "run.cancelled", "run.timeout", "run.skipped"].includes(event.type)
      ) {
        queueMicrotask(() => close(true));
      }
    };
    unsubscribe = this.runtime.observability.subscribe(emit);
    for (const event of this.runtime.observability.list(filter)) emit(event);
    if (!closed) heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    request.once("close", close);
    response.once("close", close);
  }
}
