import type { DurableSubagentOwnership } from "./durable-subagents.js";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { ContentPart, Message } from "glove-core";
import type { EnvSnapshot } from "glove-working-environment";
import {
  installationKey,
  type AgentInstallation,
} from "./capabilities.js";
import { reconstructPlaybook, type AgentPlaybook } from "./playbook.js";
import {
  reconstructPlaybookSubscription,
  type PlaybookSubscription,
} from "./subscription.js";
import type { FoundryAgentDefinition } from "./definition.js";
import type { FoundryScheduleTiming } from "./schedule.js";

export interface AgentInstance {
  readonly durableSubagent?: DurableSubagentOwnership;
  readonly id: string;
  readonly definitionId: string;
  readonly workspaceId: string;
  /** Stable adapter-enforced key used by lazy subscription provisioning. */
  readonly provisioningKey?: string;
  readonly context: Readonly<Record<string, unknown>>;
  /** Persisted desired state. Definitions only provide the capability catalogue. */
  readonly installations: ReadonlyArray<AgentInstallation>;
  readonly playbooks: ReadonlyArray<AgentPlaybook>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Conversation {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly title?: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceEntry {
  readonly workspaceId: string;
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
}

export interface SharedInboxItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly status: "pending" | "resolved" | "dismissed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnvironmentValue {
  readonly key: string;
  /** Secret values are deliberately never exposed through this primitive. */
  readonly value: unknown;
  readonly scope: "workspace" | "agent" | "conversation";
  readonly workspaceId: string;
  readonly agentId?: string;
  readonly conversationId?: string;
}

export interface FoundryTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId?: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: "open" | "in-progress" | "completed" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboundDeliveryClaim {
  readonly key: string;
  readonly status: "pending" | "completed";
  readonly runIds: ReadonlyArray<string>;
  readonly claimedAt: string;
  readonly completedAt?: string;
}

/**
 * An inbound event handed to one agent and not yet finished with: kept from
 * dispatch until the run that handles it settles, so a restart delivers it
 * again instead of losing it with the in-memory run queue.
 */
export interface FoundryPendingInbound {
  /** `<routeId>:<eventId>:<agentId>`. */
  readonly id: string;
  readonly definitionId: string;
  /** The request a run for this event starts from. */
  readonly request: FoundryRequest;
  /** The run handling it now; absent while the event waits for its conversation. */
  readonly runId?: string;
  readonly createdAt: string;
}

export interface FoundryWorkingEnvironmentSnapshotOwner {
  readonly scope: "agent" | "conversation";
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
}

/**
 * Adapter-backed runtime data created by Foundry's scheduling and sleep tools.
 * This is reconstructed state, never a file-authored definition primitive.
 */
export interface FoundryActivationRecord {
  readonly id: string;
  readonly kind: "scheduled" | "sleep";
  readonly definitionId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly message: string;
  readonly payload?: unknown;
  readonly timing: FoundryScheduleTiming;
  readonly origin: "agent-definition" | "agent-tool";
  readonly scheduleName?: string;
  /** Hash of the last reconciled definition value; runtime edits remain overrides. */
  readonly definitionRevision?: string;
  readonly status: "pending" | "active" | "paused" | "completed" | "cancelled";
  readonly createdByRunId: string;
  readonly lastRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FoundryDataAdapter {
  /** Atomic insert-if-absent, scoped by eventRecordId. Required for durable event delivery. */
  claimEvent?(record: import("./event-delivery.js").FoundryEventRecord): Effect.Effect<boolean, unknown, never>;
  putEvent?(record: import("./event-delivery.js").FoundryEventRecord): Effect.Effect<void, unknown, never>;
  listEvents?(): Effect.Effect<ReadonlyArray<import("./event-delivery.js").FoundryEventRecord>, unknown, never>;
  readonly identifier: string;
  /** Purge an archived worker's owned records, retaining an identity tombstone. Shared workspace data is untouched. */
  purgeAgentData?(agentId: string): Effect.Effect<void, unknown, never>;
  getAgent(id: string): Effect.Effect<AgentInstance | null, unknown, never>;
  putAgent(agent: AgentInstance): Effect.Effect<void, unknown, never>;
  listAgents(definitionId?: string): Effect.Effect<ReadonlyArray<AgentInstance>, unknown, never>;
  provisionAgent(input: ProvisionAgentOptions): Effect.Effect<AgentInstance, unknown, never>;
  getPlaybookSubscription(id: string): Effect.Effect<PlaybookSubscription | null, unknown, never>;
  putPlaybookSubscription(subscription: PlaybookSubscription): Effect.Effect<void, unknown, never>;
  deletePlaybookSubscription(id: string): Effect.Effect<boolean, unknown, never>;
  listPlaybookSubscriptions(workspaceId?: string): Effect.Effect<ReadonlyArray<PlaybookSubscription>, unknown, never>;
  getInboundDelivery(key: string): Effect.Effect<InboundDeliveryClaim | null, unknown, never>;
  claimInboundDelivery(key: string): Effect.Effect<boolean, unknown, never>;
  completeInboundDelivery(key: string, runIds: ReadonlyArray<string>): Effect.Effect<void, unknown, never>;
  releaseInboundDelivery(key: string): Effect.Effect<void, unknown, never>;
  /**
   * Pending inbound events (optional). With these, an inbound event survives
   * a restart until the run that handles it finishes; without them, an event
   * whose run was still queued or running when the process stopped is lost.
   */
  putPendingInbound?(record: FoundryPendingInbound): Effect.Effect<void, unknown, never>;
  deletePendingInbound?(id: string): Effect.Effect<void, unknown, never>;
  listPendingInbound?(): Effect.Effect<ReadonlyArray<FoundryPendingInbound>, unknown, never>;
  getActivation(id: string): Effect.Effect<FoundryActivationRecord | null, unknown, never>;
  putActivation(activation: FoundryActivationRecord): Effect.Effect<void, unknown, never>;
  listActivations(workspaceId?: string): Effect.Effect<ReadonlyArray<FoundryActivationRecord>, unknown, never>;
  getConversation(id: string): Effect.Effect<Conversation | null, unknown, never>;
  putConversation(conversation: Conversation): Effect.Effect<void, unknown, never>;
  listConversations(agentId: string): Effect.Effect<ReadonlyArray<Conversation>, unknown, never>;
  getWorkspaceEntry(workspaceId: string, key: string): Effect.Effect<WorkspaceEntry | null, unknown, never>;
  putWorkspaceEntry(entry: WorkspaceEntry): Effect.Effect<void, unknown, never>;
  /** Atomic optimistic update. null requires absence; updates must advance updatedAt. */
  compareAndSetWorkspaceEntry?(entry: WorkspaceEntry, expectedUpdatedAt: string | null): Effect.Effect<boolean, unknown, never>;
  listWorkspaceEntries(workspaceId: string): Effect.Effect<ReadonlyArray<WorkspaceEntry>, unknown, never>;
  /** Private VFS persistence; snapshots are never exposed as workspace entries. */
  getWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner): Effect.Effect<EnvSnapshot | null, unknown, never>;
  putWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner, snapshot: EnvSnapshot): Effect.Effect<void, unknown, never>;
  putInboxItem(item: SharedInboxItem): Effect.Effect<void, unknown, never>;
  listInboxItems(workspaceId: string): Effect.Effect<ReadonlyArray<SharedInboxItem>, unknown, never>;
  putTask(task: FoundryTask): Effect.Effect<void, unknown, never>;
  listTasks(workspaceId: string): Effect.Effect<ReadonlyArray<FoundryTask>, unknown, never>;
  listEnvironment(scope: {
    readonly workspaceId: string;
    readonly agentId?: string;
    readonly conversationId?: string;
  }): Effect.Effect<ReadonlyArray<EnvironmentValue>, unknown, never>;
}

/** The exact request shape accepted by `Glove.processRequest`. */
export type FoundryMessageInput = string | ReadonlyArray<ContentPart>;

export interface FoundryRequest {
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly message: FoundryMessageInput;
  readonly payload?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly source?: {
    readonly kind: "direct" | "transmission" | "activation" | "spawn" | "background" | "delegation" | "agent-message";
    readonly id?: string;
    readonly provider?: string;
    readonly eventId?: string;
    readonly threadKey?: string;
  };
}

/**
 * Normalize Foundry's wire input into the native user `Message` seen by the
 * Glove loop. Lazy assembly happens before hooks run, so this intentionally
 * represents the unmodified inbound turn.
 */
export function toGloveMessage(input: FoundryMessageInput): Message {
  if (typeof input === "string") {
    return freezeGloveMessage({ sender: "user", text: input });
  }

  const text = input
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("\n");
  const media = input
    .filter((part) => part.type !== "text")
    .map(cloneContentPart);
  if (media.length === 0) {
    return freezeGloveMessage({ sender: "user", text });
  }

  return freezeGloveMessage({
    sender: "user",
    text: text.length > 0 ? text : "[multimodal message]",
    content: [
      ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
      ...media,
    ],
  });
}

/** Snapshot a stored native message before sharing it across parallel resolvers. */
export function freezeGloveMessage(message: Message): Message {
  return freezeInstanceData(structuredClone(message));
}

/** Clone readonly request parts for Glove's mutable public input signature. */
export function toGloveRequestInput(
  input: FoundryMessageInput,
): string | ContentPart[] {
  return typeof input === "string" ? input : input.map(cloneContentPart);
}

function cloneContentPart(part: ContentPart): ContentPart {
  return {
    ...part,
    ...(part.source ? { source: { ...part.source } } : {}),
  };
}

export interface FoundryResult {
  /** Internal event receipts, acknowledged by the controller only after successful completion. */
  readonly consumedEventIds?: ReadonlyArray<string>;
  readonly status: "completed" | "suspended";
  readonly value: unknown;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly suspension?: FoundrySuspension;
}

/** Why a run ended without finishing: it went to sleep, or it asked a question. */
export type FoundrySuspension =
  | { readonly kind?: "sleep"; readonly commandId: string; readonly wakeAt: string }
  | {
      readonly kind: "question";
      readonly commandId: string;
      readonly delegationId: string;
      readonly question: string;
    };

export interface CreateAgentInstanceOptions {
  /** @internal Set only by durable worker provisioning. */
  readonly durableSubagent?: DurableSubagentOwnership;
  readonly id?: string;
  readonly workspaceId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly installations?: ReadonlyArray<AgentInstallation>;
  readonly playbooks?: ReadonlyArray<AgentPlaybook>;
}

export interface ProvisionAgentOptions extends CreateAgentInstanceOptions {
  readonly definitionId: string;
  readonly provisioningKey: string;
}

export interface UpdateAgentInstanceOptions {
  readonly context?: Readonly<Record<string, unknown>>;
  readonly installations?: ReadonlyArray<AgentInstallation>;
  readonly playbooks?: ReadonlyArray<AgentPlaybook>;
}

export interface CreateConversationOptions {
  readonly id?: string;
  readonly workspaceId?: string;
  readonly title?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface UpdateConversationOptions {
  readonly title?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export class MemoryFoundryDataAdapter implements FoundryDataAdapter {
  readonly identifier: string;
  private readonly agents = new Map<string, AgentInstance>();
  private readonly agentsByProvisioningKey = new Map<string, string>();
  private readonly subscriptions = new Map<string, PlaybookSubscription>();
  private readonly inboundDeliveries = new Map<string, InboundDeliveryClaim>();
  private readonly events = new Map<string, import("./event-delivery.js").FoundryEventRecord>();
  private readonly pendingInbound = new Map<string, FoundryPendingInbound>();
  private readonly activations = new Map<string, FoundryActivationRecord>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly workspace = new Map<string, WorkspaceEntry>();
  private readonly workingEnvironments = new Map<string, EnvSnapshot>();
  private readonly inbox = new Map<string, SharedInboxItem>();
  private readonly tasks = new Map<string, FoundryTask>();
  private readonly environment: EnvironmentValue[];
  private pendingAgents: AgentInstance[];
  private pendingSubscriptions: PlaybookSubscription[];

  constructor(options?: {
    readonly identifier?: string;
    readonly environment?: ReadonlyArray<EnvironmentValue>;
    readonly agents?: ReadonlyArray<AgentInstance>;
    readonly conversations?: ReadonlyArray<Conversation>;
    readonly subscriptions?: ReadonlyArray<PlaybookSubscription>;
    readonly activations?: ReadonlyArray<FoundryActivationRecord>;
  }) {
    this.identifier = options?.identifier ?? "foundry-memory-data";
    this.environment = [...(options?.environment ?? [])];
    this.pendingAgents = [...(options?.agents ?? [])];
    this.pendingSubscriptions = [...(options?.subscriptions ?? [])];
    for (const activation of options?.activations ?? []) {
      this.activations.set(activation.id, reconstructActivation(activation));
    }
    for (const conversation of options?.conversations ?? []) this.conversations.set(conversation.id, conversation);
  }

  /** Resolve file-owned identities only after Foundry discovery has bound them. */
  private materializeSeeds(): void {
    for (const agent of this.pendingAgents) {
      const reconstructed = reconstructAgentInstance(agent);
      this.agents.set(agent.id, reconstructed);
      if (reconstructed.provisioningKey) {
        this.agentsByProvisioningKey.set(reconstructed.provisioningKey, reconstructed.id);
      }
    }
    this.pendingAgents = [];
    for (const subscription of this.pendingSubscriptions) {
      this.subscriptions.set(subscription.id, reconstructPlaybookSubscription(subscription));
    }
    this.pendingSubscriptions = [];
  }

  getAgent(id: string) { return Effect.sync(() => {
    this.materializeSeeds();
    return this.agents.get(id) ?? null;
  }); }
  putAgent(agent: AgentInstance) { return Effect.sync(() => {
    this.materializeSeeds();
    const reconstructed = reconstructAgentInstance(agent);
    const prior = this.agents.get(agent.id);
    if (prior?.provisioningKey && prior.provisioningKey !== reconstructed.provisioningKey) {
      this.agentsByProvisioningKey.delete(prior.provisioningKey);
    }
    this.agents.set(agent.id, reconstructed);
    if (reconstructed.provisioningKey) {
      this.agentsByProvisioningKey.set(reconstructed.provisioningKey, reconstructed.id);
    }
  }); }
  listAgents(definitionId?: string) { return Effect.sync(() => {
    this.materializeSeeds();
    return [...this.agents.values()].filter((item) => !definitionId || item.definitionId === definitionId);
  }); }
  provisionAgent(input: ProvisionAgentOptions) { return Effect.sync(() => {
    this.materializeSeeds();
    const existingId = this.agentsByProvisioningKey.get(input.provisioningKey);
    if (existingId) return this.agents.get(existingId)!;
    if (input.id && this.agents.has(input.id)) throw new Error(`Agent instance "${input.id}" already exists with another provisioning key.`);
    const created = createAgentInstance(input.definitionId, {
      ...input,
      id: input.id ?? `agent_${randomUUID()}`,
    }, input.provisioningKey);
    this.agents.set(created.id, created);
    this.agentsByProvisioningKey.set(input.provisioningKey, created.id);
    return created;
  }); }
  purgeAgentData(agentId: string) { return Effect.sync(() => {
    this.materializeSeeds();
    const agent = this.agents.get(agentId);
    if (!agent?.durableSubagent || agent.durableSubagent.status !== "archived") throw new Error("Only archived durable workers can be purged.");
    const conversationIds = new Set([...this.conversations.values()].filter((item) => item.agentId === agentId).map((item) => item.id));
    for (const [id, item] of this.events) if (item.target.agentId === agentId) this.events.delete(id);
    for (const [id, item] of this.pendingInbound) if (item.request.agentId === agentId) this.pendingInbound.delete(id);
    for (const [id, item] of this.activations) if (item.agentId === agentId) this.activations.delete(id);
    for (const id of conversationIds) this.conversations.delete(id);
    for (const [id, item] of this.inbox) if (item.agentId === agentId || conversationIds.has(item.conversationId ?? "")) this.inbox.delete(id);
    for (const [id, item] of this.tasks) if (item.agentId === agentId || conversationIds.has(item.conversationId ?? "")) this.tasks.delete(id);
    for (let i = this.environment.length - 1; i >= 0; i--) {
      const item = this.environment[i]!;
      if (item.scope !== "workspace" && (item.agentId === agentId || conversationIds.has(item.conversationId ?? ""))) this.environment.splice(i, 1);
    }
    for (const key of this.workingEnvironments.keys()) if (key.split("\u0000")[3] === agentId) this.workingEnvironments.delete(key);
    this.agents.set(agentId, reconstructAgentInstance({ ...agent, context: {}, installations: [], playbooks: [], durableSubagent: { ...agent.durableSubagent, status: "purged" }, updatedAt: new Date().toISOString() }));
  }); }
  getPlaybookSubscription(id: string) { return Effect.sync(() => {
    this.materializeSeeds();
    return this.subscriptions.get(id) ?? null;
  }); }
  putPlaybookSubscription(subscription: PlaybookSubscription) { return Effect.sync(() => {
    this.materializeSeeds();
    this.subscriptions.set(subscription.id, reconstructPlaybookSubscription(subscription));
  }); }
  deletePlaybookSubscription(id: string) { return Effect.sync(() => {
    this.materializeSeeds();
    return this.subscriptions.delete(id);
  }); }
  listPlaybookSubscriptions(workspaceId?: string) { return Effect.sync(() => {
    this.materializeSeeds();
    return [...this.subscriptions.values()].filter((item) => !workspaceId || item.workspaceId === workspaceId);
  }); }
  getInboundDelivery(key: string) { return Effect.succeed(this.inboundDeliveries.get(key) ?? null); }
  claimInboundDelivery(key: string) { return Effect.sync(() => {
    if (this.inboundDeliveries.has(key)) return false;
    this.inboundDeliveries.set(key, Object.freeze({
      key,
      status: "pending" as const,
      runIds: Object.freeze([]),
      claimedAt: new Date().toISOString(),
    }));
    return true;
  }); }
  completeInboundDelivery(key: string, runIds: ReadonlyArray<string>) { return Effect.sync(() => {
    const prior = this.inboundDeliveries.get(key);
    if (!prior) throw new Error(`Inbound delivery claim "${key}" does not exist.`);
    this.inboundDeliveries.set(key, Object.freeze({
      ...prior,
      status: "completed" as const,
      runIds: Object.freeze([...runIds]),
      completedAt: new Date().toISOString(),
    }));
  }); }
  releaseInboundDelivery(key: string) { return Effect.sync(() => {
    if (this.inboundDeliveries.get(key)?.status === "pending") {
      this.inboundDeliveries.delete(key);
    }
  }); }
  claimEvent(record: import("./event-delivery.js").FoundryEventRecord) { return Effect.sync(() => {
    if (this.agents.get(record.target.agentId)?.durableSubagent?.status === "purged") throw new Error("Cannot deliver an event to a purged worker.");
    if (this.events.has(record.id)) return false;
    this.events.set(record.id, structuredClone(record)); return true;
  }); }
  putEvent(record: import("./event-delivery.js").FoundryEventRecord) { return Effect.sync(() => {
    if (this.agents.get(record.target.agentId)?.durableSubagent?.status !== "purged") this.events.set(record.id, structuredClone(record));
  }); }
  listEvents() { return Effect.sync(() => [...this.events.values()].map((record) => structuredClone(record))); }

  putPendingInbound(record: FoundryPendingInbound) { return Effect.sync(() => {
    this.pendingInbound.set(record.id, structuredClone(record));
  }); }
  deletePendingInbound(id: string) { return Effect.sync(() => { this.pendingInbound.delete(id); }); }
  listPendingInbound() { return Effect.sync(() =>
    [...this.pendingInbound.values()].map((record) => structuredClone(record))); }
  getActivation(id: string) { return Effect.succeed(this.activations.get(id) ?? null); }
  putActivation(activation: FoundryActivationRecord) { return Effect.sync(() => {
    this.activations.set(activation.id, reconstructActivation(activation));
  }); }
  listActivations(workspaceId?: string) { return Effect.succeed(
    [...this.activations.values()].filter((item) => !workspaceId || item.workspaceId === workspaceId),
  ); }
  getConversation(id: string) { return Effect.succeed(this.conversations.get(id) ?? null); }
  putConversation(conversation: Conversation) { return Effect.sync(() => { this.conversations.set(conversation.id, Object.freeze({ ...conversation })); }); }
  listConversations(agentId: string) { return Effect.succeed([...this.conversations.values()].filter((item) => item.agentId === agentId)); }
  getWorkspaceEntry(workspaceId: string, key: string) { return Effect.succeed(this.workspace.get(`${workspaceId}:${key}`) ?? null); }
  putWorkspaceEntry(entry: WorkspaceEntry) { return Effect.sync(() => { this.workspace.set(`${entry.workspaceId}:${entry.key}`, Object.freeze({ ...entry })); }); }
  compareAndSetWorkspaceEntry(entry: WorkspaceEntry, expectedUpdatedAt: string | null) {
    return Effect.sync(() => {
      const key = `${entry.workspaceId}:${entry.key}`;
      const current = this.workspace.get(key);
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) return false;
      if (!Number.isFinite(Date.parse(entry.updatedAt)) || (current && Date.parse(entry.updatedAt) <= Date.parse(current.updatedAt))) {
        throw new Error("An atomic workspace update must advance updatedAt.");
      }
      this.workspace.set(key, freezeInstanceData(structuredClone(entry)));
      return true;
    });
  }
  listWorkspaceEntries(workspaceId: string) { return Effect.succeed([...this.workspace.values()].filter((item) => item.workspaceId === workspaceId)); }
  getWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner) {
    return Effect.sync(() => {
      const snapshot = this.workingEnvironments.get(workingEnvironmentOwnerKey(owner));
      return snapshot ? structuredClone(snapshot) : null;
    });
  }
  putWorkingEnvironmentSnapshot(
    owner: FoundryWorkingEnvironmentSnapshotOwner,
    snapshot: EnvSnapshot,
  ) {
    return Effect.sync(() => {
      this.workingEnvironments.set(
        workingEnvironmentOwnerKey(owner),
        structuredClone(snapshot),
      );
    });
  }
  putInboxItem(item: SharedInboxItem) { return Effect.sync(() => { this.inbox.set(item.id, Object.freeze({ ...item })); }); }
  listInboxItems(workspaceId: string) { return Effect.succeed([...this.inbox.values()].filter((item) => item.workspaceId === workspaceId)); }
  putTask(task: FoundryTask) { return Effect.sync(() => { this.tasks.set(task.id, Object.freeze({ ...task })); }); }
  listTasks(workspaceId: string) { return Effect.succeed([...this.tasks.values()].filter((item) => item.workspaceId === workspaceId)); }
  listEnvironment(scope: { readonly workspaceId: string; readonly agentId?: string; readonly conversationId?: string }) {
    return Effect.succeed(this.environment.filter((item) =>
      item.workspaceId === scope.workspaceId &&
      (item.scope === "workspace" || (item.scope === "agent" && item.agentId === scope.agentId) || (item.scope === "conversation" && item.conversationId === scope.conversationId)),
    ));
  }
}

function workingEnvironmentOwnerKey(
  owner: FoundryWorkingEnvironmentSnapshotOwner,
): string {
  return [
    owner.scope,
    owner.workspaceId,
    owner.definitionId,
    owner.agentId,
    owner.scope === "conversation" ? owner.conversationId : "",
  ].join("\u0000");
}

/** Rehydrate immutable, adapter-owned future activation data. */
function reconstructActivation(activation: FoundryActivationRecord): FoundryActivationRecord {
  return Object.freeze({
    ...activation,
    ...(activation.payload !== undefined
      ? { payload: freezeInstanceData(structuredClone(activation.payload)) }
      : {}),
    timing: Object.freeze({ ...activation.timing }),
  });
}

export function createAgentInstance(
  definitionId: string,
  options: CreateAgentInstanceOptions = {},
  provisioningKey?: string,
): AgentInstance {
  const now = new Date().toISOString();
  return reconstructAgentInstance({
    id: options.id ?? `agent_${randomUUID()}`,
    definitionId,
    ...(options.durableSubagent ? { durableSubagent: options.durableSubagent } : {}),
    workspaceId: options.workspaceId ?? "default",
    ...(provisioningKey ? { provisioningKey } : {}),
    context: options.context ?? {},
    installations: options.installations ?? [],
    playbooks: options.playbooks ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Code-authoring helper; instance data stores the referenced definition id. */
export function defineAgentInstance(
  definition: FoundryAgentDefinition,
  options: CreateAgentInstanceOptions = {},
): AgentInstance {
  const now = new Date().toISOString();
  const seed = {
    id: options.id ?? `agent_${randomUUID()}`,
    workspaceId: options.workspaceId ?? "default",
    context: options.context ?? {},
    installations: options.installations ?? [],
    playbooks: options.playbooks ?? [],
    createdAt: now,
    updatedAt: now,
  } as AgentInstance & Record<string, unknown>;
  Object.defineProperty(seed, "definitionId", {
    enumerable: true,
    get: () => definition.id,
  });
  return Object.freeze(seed);
}

/** Rehydrate a durable adapter record into Foundry's immutable runtime shape. */
export function reconstructAgentInstance(agent: AgentInstance): AgentInstance {
  return Object.freeze({
    ...agent,
    ...(agent.durableSubagent ? { durableSubagent: Object.freeze({ ...agent.durableSubagent }) } : {}),
    context: freezeInstanceData(structuredClone(agent.context)),
    installations: normalizeAgentInstallations(agent.installations),
    playbooks: Object.freeze(agent.playbooks.map(reconstructPlaybook)),
  });
}

/**
 * Reconstruct immutable capability desired state from persisted instance data.
 * Duplicate entries use last-write-wins semantics, matching dynamic UI updates.
 */
export function normalizeAgentInstallations(
  installations: ReadonlyArray<AgentInstallation>,
): ReadonlyArray<AgentInstallation> {
  const byKey = new Map<string, AgentInstallation>();
  for (const installation of installations) {
    const copy = Object.freeze({
      kind: installation.kind,
      id: installation.id,
      ...(installation.accountId !== undefined
        ? { accountId: installation.accountId }
        : {}),
      ...(installation.config !== undefined
        ? { config: freezeInstanceData(structuredClone(installation.config)) }
        : {}),
    });
    byKey.set(installationKey(copy), copy);
  }
  return Object.freeze([...byKey.values()]);
}

function freezeInstanceData<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeInstanceData(child);
  }
  return Object.freeze(value);
}

export function createConversation(
  agent: AgentInstance,
  options: CreateConversationOptions = {},
): Conversation {
  const now = new Date().toISOString();
  return Object.freeze({
    id: options.id ?? `conversation_${randomUUID()}`,
    agentId: agent.id,
    workspaceId: options.workspaceId ?? agent.workspaceId,
    ...(options.title ? { title: options.title } : {}),
    context: Object.freeze({ ...(options.context ?? {}) }),
    createdAt: now,
    updatedAt: now,
  });
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
