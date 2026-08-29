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
  readonly status: "pending" | "active" | "completed" | "cancelled";
  readonly createdByRunId: string;
  readonly lastRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FoundryDataAdapter {
  readonly identifier: string;
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
  getActivation(id: string): Effect.Effect<FoundryActivationRecord | null, unknown, never>;
  putActivation(activation: FoundryActivationRecord): Effect.Effect<void, unknown, never>;
  listActivations(workspaceId?: string): Effect.Effect<ReadonlyArray<FoundryActivationRecord>, unknown, never>;
  getConversation(id: string): Effect.Effect<Conversation | null, unknown, never>;
  putConversation(conversation: Conversation): Effect.Effect<void, unknown, never>;
  listConversations(agentId: string): Effect.Effect<ReadonlyArray<Conversation>, unknown, never>;
  getWorkspaceEntry(workspaceId: string, key: string): Effect.Effect<WorkspaceEntry | null, unknown, never>;
  putWorkspaceEntry(entry: WorkspaceEntry): Effect.Effect<void, unknown, never>;
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
    readonly kind: "direct" | "transmission" | "activation" | "spawn" | "background";
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
  readonly status: "completed" | "suspended";
  readonly value: unknown;
  readonly agentId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly suspension?: { readonly commandId: string; readonly wakeAt: string };
}

export interface CreateAgentInstanceOptions {
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

export class MemoryFoundryDataAdapter implements FoundryDataAdapter {
  readonly identifier: string;
  private readonly agents = new Map<string, AgentInstance>();
  private readonly agentsByProvisioningKey = new Map<string, string>();
  private readonly subscriptions = new Map<string, PlaybookSubscription>();
  private readonly inboundDeliveries = new Map<string, InboundDeliveryClaim>();
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
    const created = createAgentInstance(input.definitionId, {
      ...input,
      id: input.id ?? `agent_${randomUUID()}`,
    }, input.provisioningKey);
    this.agents.set(created.id, created);
    this.agentsByProvisioningKey.set(input.provisioningKey, created.id);
    return created;
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
