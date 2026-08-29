import type {
  AnyFoundryAgent,
  FoundryRouteMap,
} from "./definition.js";
import type { FoundryManifest } from "./discovery.js";
import type {
  AccountSummary,
  AgentBinding,
  Route,
  RunGrant,
} from "./domain.js";
import type { ResolveGrantRequest } from "./grants.js";
import type { FoundryApplicationManifest } from "./manifest.js";
import type { FoundryEvent } from "./observability.js";
import type { FoundryRun } from "./runtime.js";
import type {
  AgentInstallation,
  FoundryCapabilityManifest,
} from "./capabilities.js";
import type { FoundryNativeManifest } from "./surfaces.js";
import type {
  AgentInstance,
  Conversation,
  CreateAgentInstanceOptions,
  UpdateAgentInstanceOptions,
  CreateConversationOptions,
  FoundryRequest,
  FoundryMessageInput,
  FoundryResult,
  FoundryTask,
  FoundryActivationRecord,
  EnvironmentValue,
  SharedInboxItem,
  WorkspaceEntry,
} from "./primitives.js";
import type { AgentPlaybook } from "./playbook.js";
import type { PlaybookSubscription } from "./subscription.js";
import type { ApplicationConnectionState } from "./connection.js";

export interface FoundryClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface WaitOptions {
  pollMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FoundryHealth {
  readonly ok: boolean;
  readonly execution: boolean;
  readonly environment: boolean;
  readonly activations: boolean;
  readonly agents: number;
  readonly capabilities: number;
  readonly surfaces: number;
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error ?? `Foundry request failed (${response.status}).`);
  }
  return payload;
}

function routePath(route: string): string {
  return route.split("/").map(encodeURIComponent).join("/");
}

export class FoundryRunHandle<TOutput> {
  readonly id: string;
  readonly initial: FoundryRun<TOutput>;
  private readonly client: FoundryClient<FoundryRouteMap>;

  constructor(
    id: string,
    initial: FoundryRun<TOutput>,
    client: FoundryClient<FoundryRouteMap>,
  ) {
    this.id = id;
    this.initial = initial;
    this.client = client;
  }

  get(): Promise<FoundryRun<TOutput>> {
    return this.client.getRun<TOutput>(this.id);
  }

  cancel(): Promise<boolean> {
    return this.client.cancelRun(this.id);
  }

  events(): Promise<FoundryEvent[]> {
    return this.client.getEvents({ runId: this.id });
  }

  async wait(options: WaitOptions = {}): Promise<FoundryRun<TOutput>> {
    const pollMs = options.pollMs ?? 150;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new Error("Waiting for Foundry run was aborted.");
      }
      const run = await this.get();
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        return run;
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new Error("Waiting for Foundry run was aborted."));
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, pollMs);
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    throw new Error(`Timed out waiting for Foundry run "${this.id}".`);
  }
}

export class FoundryClient<TRoutes extends FoundryRouteMap> {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: FoundryClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:4141").replace(
      /\/$/,
      "",
    );
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async health(): Promise<FoundryHealth> {
    return readResponse(await this.fetcher(`${this.baseUrl}/health`));
  }

  agent<TRoute extends Extract<keyof TRoutes, string>>(route: TRoute): {
    create(options?: CreateAgentInstanceOptions): Promise<AgentInstance>;
    request(
      request: FoundryRequest,
    ): Promise<FoundryRunHandle<FoundryResult>>;
  } {
    return {
      create: (options) => this.createAgent(route, options),
      request: async (request) => {
        const response = await this.fetcher(
          `${this.baseUrl}/api/agents/${routePath(route)}/runs`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          },
        );
        const run = await readResponse<FoundryRun<FoundryResult>>(response);
        return new FoundryRunHandle(run.id, run, this.asUntyped());
      },
    };
  }

  async createAgent(definitionId: string, options: CreateAgentInstanceOptions = {}): Promise<AgentInstance> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/agent-instances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ definitionId, ...options }),
    }));
  }

  async agentInstances(definitionId?: string): Promise<ReadonlyArray<AgentInstance>> {
    const query = definitionId ? `?definition=${encodeURIComponent(definitionId)}` : "";
    return readResponse(await this.fetcher(`${this.baseUrl}/api/agent-instances${query}`));
  }

  async configureAgent(agentId: string, options: UpdateAgentInstanceOptions): Promise<AgentInstance> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/agent-instances/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    }));
  }

  async setAgentPlaybooks(agentId: string, playbooks: ReadonlyArray<AgentPlaybook>): Promise<AgentInstance> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/agent-instances/${encodeURIComponent(agentId)}/playbooks`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playbooks }),
    }));
  }

  async createConversation(agentId: string, options: CreateConversationOptions = {}): Promise<Conversation> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, ...options }),
    }));
  }

  async conversations(agentId: string): Promise<ReadonlyArray<Conversation>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/conversations?agent=${encodeURIComponent(agentId)}`));
  }

  async workspaceEntries(workspaceId: string): Promise<ReadonlyArray<WorkspaceEntry>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/entries`));
  }

  async putWorkspaceEntry(workspaceId: string, key: string, value: unknown): Promise<WorkspaceEntry> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/entries`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }),
    }));
  }

  async sharedInbox(workspaceId: string): Promise<ReadonlyArray<SharedInboxItem>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`));
  }

  async postSharedInbox(workspaceId: string, input: { readonly topic: string; readonly payload?: unknown; readonly agentId?: string; readonly conversationId?: string }): Promise<SharedInboxItem> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }));
  }

  async updateSharedInbox(workspaceId: string, itemId: string, status: SharedInboxItem["status"]): Promise<SharedInboxItem> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(itemId)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    }));
  }

  async tasks(workspaceId: string): Promise<ReadonlyArray<FoundryTask>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`));
  }

  async createTask(workspaceId: string, input: { readonly title: string; readonly detail?: string; readonly agentId?: string; readonly conversationId?: string }): Promise<FoundryTask> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }));
  }

  async updateTask(workspaceId: string, taskId: string, status: FoundryTask["status"]): Promise<FoundryTask> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    }));
  }

  async dataEnvironment(workspaceId: string, scope?: { readonly agentId?: string; readonly conversationId?: string }): Promise<ReadonlyArray<EnvironmentValue>> {
    const query = new URLSearchParams();
    if (scope?.agentId) query.set("agent", scope.agentId);
    if (scope?.conversationId) query.set("conversation", scope.conversationId);
    return readResponse(await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/environment${query.size ? `?${query}` : ""}`));
  }

  async dispatchInbound(input: {
    readonly routeId: string;
    readonly eventId: string;
    readonly threadKey: string;
    readonly raw: unknown;
  }): Promise<ReadonlyArray<FoundryRun>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/transmissions/${encodeURIComponent(input.routeId)}/fire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }));
  }

  async playbookSubscriptions(
    workspaceId?: string,
  ): Promise<ReadonlyArray<PlaybookSubscription>> {
    const query = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/playbook-subscriptions${query}`),
    );
  }

  async activations(
    workspaceId?: string,
  ): Promise<ReadonlyArray<FoundryActivationRecord>> {
    const query = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/activations${query}`),
    );
  }

  async putPlaybookSubscription(
    subscription: PlaybookSubscription,
  ): Promise<PlaybookSubscription> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/playbook-subscriptions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription),
      }),
    );
  }

  async deletePlaybookSubscription(id: string): Promise<boolean> {
    const result = await readResponse<{ removed: boolean }>(
      await this.fetcher(
        `${this.baseUrl}/api/playbook-subscriptions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    );
    return result.removed;
  }

  async applicationConnections(): Promise<ReadonlyArray<ApplicationConnectionState>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/application-connections`));
  }

  async reconnectApplicationConnection(id: string): Promise<void> {
    await readResponse(
      await this.fetcher(
        `${this.baseUrl}/api/application-connections/${encodeURIComponent(id)}/reconnect`,
        { method: "POST" },
      ),
    );
  }

  async dispatchOutbound(input: {
    readonly routeId: string;
    readonly agentId: string;
    readonly runId: string;
    readonly payload: unknown;
  }): Promise<unknown> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/transmissions/${encodeURIComponent(input.routeId)}/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }));
  }

  async send(
    agentId: string,
    conversationId: string,
    message: FoundryMessageInput,
    options: { readonly payload?: unknown; readonly context?: Readonly<Record<string, unknown>> } = {},
  ): Promise<FoundryRunHandle<FoundryResult>> {
    const run = await readResponse<FoundryRun<FoundryResult>>(
      await this.fetcher(`${this.baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, message, ...options }),
      }),
    );
    return new FoundryRunHandle(run.id, run, this.asUntyped());
  }

  async getRun<TOutput = unknown>(runId: string): Promise<FoundryRun<TOutput>> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`,
    );
    return readResponse<FoundryRun<TOutput>>(response);
  }

  async runs<TOutput = unknown>(route?: string): Promise<ReadonlyArray<FoundryRun<TOutput>>> {
    const query = route ? `?agent=${encodeURIComponent(route)}` : "";
    return readResponse(await this.fetcher(`${this.baseUrl}/api/runs${query}`));
  }

  async cancelRun(runId: string): Promise<boolean> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    );
    const payload = await readResponse<{ cancelled: boolean }>(response);
    return payload.cancelled;
  }

  async getEvents(filter?: {
    runId?: string;
    agent?: string;
    after?: number;
    category?: FoundryEvent["category"];
  }): Promise<FoundryEvent[]> {
    const query = new URLSearchParams();
    if (filter?.runId) query.set("runId", filter.runId);
    if (filter?.agent) query.set("agent", filter.agent);
    if (filter?.after !== undefined) query.set("after", String(filter.after));
    if (filter?.category) query.set("category", filter.category);
    const suffix = query.size > 0 ? `?${query}` : "";
    const response = await this.fetcher(`${this.baseUrl}/api/events${suffix}`,
      { headers: { accept: "application/json" } },
    );
    return readResponse<FoundryEvent[]>(response);
  }

  async manifest(): Promise<{
    agents: FoundryManifest;
    application: FoundryApplicationManifest;
    definitions: Readonly<Record<string, {
      capabilities: FoundryCapabilityManifest;
      surfaces: FoundryNativeManifest;
    }>>;
  }> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/manifest`),
    );
  }

  async capabilities(definitionId: string): Promise<FoundryCapabilityManifest> {
    const query = new URLSearchParams({ definition: definitionId });
    return readResponse(await this.fetcher(`${this.baseUrl}/api/capabilities?${query}`));
  }

  async surfaces(definitionId: string): Promise<FoundryNativeManifest> {
    const query = new URLSearchParams({ definition: definitionId });
    return readResponse(await this.fetcher(`${this.baseUrl}/api/surfaces?${query}`));
  }

  async installations(
    agentId: string,
  ): Promise<ReadonlyArray<AgentInstallation>> {
    const query = new URLSearchParams({ agent: agentId });
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/installations?${query}`),
    );
  }

  async install(agentId: string, installation: AgentInstallation): Promise<AgentInstance> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/installations`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, ...installation }),
      }),
    );
  }

  async uninstall(
    agentId: string,
    installation: AgentInstallation,
  ): Promise<AgentInstance> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/installations`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, ...installation }),
      }),
    );
  }

  async accounts(): Promise<ReadonlyArray<AccountSummary>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/accounts`));
  }

  async routes(): Promise<ReadonlyArray<Route>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/routes`));
  }

  async putRoute(route: Route): Promise<Route> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/routes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(route),
      }),
    );
  }

  async removeRoute(id: string): Promise<void> {
    await readResponse(
      await this.fetcher(`${this.baseUrl}/api/routes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    );
  }

  async bindings(): Promise<ReadonlyArray<AgentBinding>> {
    return readResponse(await this.fetcher(`${this.baseUrl}/api/bindings`));
  }

  async putBinding(binding: AgentBinding): Promise<AgentBinding> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/bindings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(binding),
      }),
    );
  }

  async removeBinding(id: string): Promise<void> {
    await readResponse(
      await this.fetcher(
        `${this.baseUrl}/api/bindings/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    );
  }

  async resolveGrant(request: ResolveGrantRequest): Promise<RunGrant> {
    return readResponse(
      await this.fetcher(`${this.baseUrl}/api/grants/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
  }

  private asUntyped(): FoundryClient<FoundryRouteMap> {
    return this as unknown as FoundryClient<FoundryRouteMap>;
  }
}

export function createFoundryClient<
  TRoutes extends FoundryRouteMap = Record<string, AnyFoundryAgent>,
>(options?: FoundryClientOptions): FoundryClient<TRoutes> {
  return new FoundryClient<TRoutes>(options);
}
