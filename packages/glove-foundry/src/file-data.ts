import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import type { EnvSnapshot } from "glove-working-environment";
import {
  createAgentInstance,
  reconstructAgentInstance,
  type AgentInstance,
  type Conversation,
  type EnvironmentValue,
  type FoundryActivationRecord,
  type FoundryDataAdapter,
  type FoundryWorkingEnvironmentSnapshotOwner,
  type InboundDeliveryClaim,
  type ProvisionAgentOptions,
  type SharedInboxItem,
  type FoundryTask,
  type WorkspaceEntry,
} from "./primitives.js";
import {
  reconstructPlaybookSubscription,
  type PlaybookSubscription,
} from "./subscription.js";

interface PersistedWorkingEnvironment {
  readonly owner: FoundryWorkingEnvironmentSnapshotOwner;
  readonly snapshot: EnvSnapshot;
}

interface FileFoundryState {
  readonly version: 1;
  agents: AgentInstance[];
  subscriptions: PlaybookSubscription[];
  inboundDeliveries: InboundDeliveryClaim[];
  activations: FoundryActivationRecord[];
  conversations: Conversation[];
  workspaceEntries: WorkspaceEntry[];
  workingEnvironments: PersistedWorkingEnvironment[];
  inbox: SharedInboxItem[];
  tasks: FoundryTask[];
  environment: EnvironmentValue[];
}

export interface FileFoundryDataAdapterOptions {
  /** JSON state file. Writes use a same-directory atomic rename. */
  readonly file: string;
  readonly identifier?: string;
  readonly environment?: ReadonlyArray<EnvironmentValue>;
  readonly agents?: ReadonlyArray<AgentInstance>;
  readonly conversations?: ReadonlyArray<Conversation>;
  readonly subscriptions?: ReadonlyArray<PlaybookSubscription>;
  readonly activations?: ReadonlyArray<FoundryActivationRecord>;
  /** Maximum wait for another process holding the state lock. */
  readonly lockTimeoutMs?: number;
  /** A dead process's abandoned lock is recoverable after this duration. */
  readonly staleLockMs?: number;
}

function emptyState(environment: ReadonlyArray<EnvironmentValue>): FileFoundryState {
  return {
    version: 1,
    agents: [],
    subscriptions: [],
    inboundDeliveries: [],
    activations: [],
    conversations: [],
    workspaceEntries: [],
    workingEnvironments: [],
    inbox: [],
    tasks: [],
    environment: structuredClone([...environment]),
  };
}

function replaceById<T extends { readonly id: string }>(values: T[], value: T): void {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index === -1) values.push(structuredClone(value));
  else values[index] = structuredClone(value);
}

function environmentOwnerKey(owner: FoundryWorkingEnvironmentSnapshotOwner): string {
  return [
    owner.scope,
    owner.workspaceId,
    owner.definitionId,
    owner.agentId,
    owner.scope === "conversation" ? owner.conversationId : "",
  ].join("\u0000");
}

function effect<A>(operation: () => Promise<A>): Effect.Effect<A, unknown, never> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(cause: unknown): string | undefined {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { readonly code?: unknown }).code)
    : undefined;
}

/**
 * Durable, dependency-free Foundry data for a single host.
 *
 * The adapter serializes in-process mutations, coordinates sibling Foundry
 * worker processes with an advisory lock, and commits with atomic rename.
 * Deployments with several hosts should provide a database-backed adapter.
 */
export class FileFoundryDataAdapter implements FoundryDataAdapter {
  readonly identifier: string;
  private readonly file: string;
  private readonly lockFile: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly seeds: Omit<FileFoundryState, "version" | "inboundDeliveries" | "workspaceEntries" | "workingEnvironments" | "inbox" | "tasks">;
  private initialized: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileFoundryDataAdapterOptions) {
    if (!options.file.trim()) throw new Error("FileFoundryDataAdapter requires a file path.");
    this.file = options.file;
    this.lockFile = `${options.file}.lock`;
    this.identifier = options.identifier ?? `foundry-file:${options.file}`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
    this.seeds = {
      agents: [...(options.agents ?? [])],
      subscriptions: [...(options.subscriptions ?? [])],
      activations: [...(options.activations ?? [])],
      conversations: [...(options.conversations ?? [])],
      environment: [...(options.environment ?? [])],
    };
  }

  private serialize<A>(operation: () => Promise<A>): Promise<A> {
    const current = this.queue.then(operation, operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.file), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        const handle = await open(this.lockFile, "wx");
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        await handle.close();
        return async () => {
          try {
            await unlink(this.lockFile);
          } catch (cause) {
            if (errorCode(cause) !== "ENOENT") throw cause;
          }
        };
      } catch (cause) {
        if (errorCode(cause) !== "EEXIST") throw cause;
        try {
          const lock = await stat(this.lockFile);
          if (Date.now() - lock.mtimeMs > this.staleLockMs) {
            await unlink(this.lockFile);
            continue;
          }
        } catch (staleCause) {
          if (errorCode(staleCause) === "ENOENT") continue;
          throw staleCause;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for Foundry data lock "${this.lockFile}".`);
        }
        await sleep(20 + Math.floor(Math.random() * 30));
      }
    }
  }

  private async read(): Promise<FileFoundryState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<FileFoundryState>;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported Foundry data version ${String(parsed.version)} in "${this.file}".`);
      }
      return {
        version: 1,
        agents: parsed.agents ?? [],
        subscriptions: parsed.subscriptions ?? [],
        inboundDeliveries: parsed.inboundDeliveries ?? [],
        activations: parsed.activations ?? [],
        conversations: parsed.conversations ?? [],
        workspaceEntries: parsed.workspaceEntries ?? [],
        workingEnvironments: parsed.workingEnvironments ?? [],
        inbox: parsed.inbox ?? [],
        tasks: parsed.tasks ?? [],
        environment: parsed.environment ?? [],
      };
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return emptyState(this.seeds.environment);
      throw cause;
    }
  }

  private async write(state: FileFoundryState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.file);
    } catch (cause) {
      try { await unlink(temporary); } catch { /* Preserve the commit failure. */ }
      throw cause;
    }
  }

  private async mutate<A>(operation: (state: FileFoundryState) => A | Promise<A>): Promise<A> {
    return this.serialize(async () => {
      const release = await this.acquireLock();
      try {
        const state = await this.read();
        const result = await operation(state);
        await this.write(state);
        return result;
      } finally {
        await release();
      }
    });
  }

  private async ensureInitialized(): Promise<void> {
    this.initialized ??= this.mutate((state) => {
      for (const seed of this.seeds.agents) {
        if (!state.agents.some((agent) => agent.id === seed.id)) {
          state.agents.push(structuredClone(reconstructAgentInstance(seed)));
        }
      }
      for (const seed of this.seeds.subscriptions) {
        if (!state.subscriptions.some((item) => item.id === seed.id)) {
          state.subscriptions.push(structuredClone(reconstructPlaybookSubscription(seed)));
        }
      }
      for (const seed of this.seeds.activations) {
        if (!state.activations.some((item) => item.id === seed.id)) {
          state.activations.push(structuredClone(seed));
        }
      }
      for (const seed of this.seeds.conversations) {
        if (!state.conversations.some((item) => item.id === seed.id)) {
          state.conversations.push(structuredClone(seed));
        }
      }
      for (const seed of this.seeds.environment) {
        const key = `${seed.scope}:${seed.workspaceId}:${seed.agentId ?? ""}:${seed.conversationId ?? ""}:${seed.key}`;
        if (!state.environment.some((item) =>
          `${item.scope}:${item.workspaceId}:${item.agentId ?? ""}:${item.conversationId ?? ""}:${item.key}` === key
        )) state.environment.push(structuredClone(seed));
      }
    });
    await this.initialized;
  }

  private async snapshot(): Promise<FileFoundryState> {
    await this.ensureInitialized();
    await this.queue;
    return this.read();
  }

  getAgent(id: string) { return effect(async () => {
    const value = (await this.snapshot()).agents.find((agent) => agent.id === id);
    return value ? reconstructAgentInstance(value) : null;
  }); }

  putAgent(agent: AgentInstance) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.agents, reconstructAgentInstance(agent)));
  }); }

  listAgents(definitionId?: string) { return effect(async () =>
    (await this.snapshot()).agents
      .filter((agent) => !definitionId || agent.definitionId === definitionId)
      .map(reconstructAgentInstance)); }

  provisionAgent(input: ProvisionAgentOptions) { return effect(async () => {
    await this.ensureInitialized();
    return this.mutate((state) => {
      const existing = state.agents.find((agent) => agent.provisioningKey === input.provisioningKey);
      if (existing) return reconstructAgentInstance(existing);
      const created = createAgentInstance(input.definitionId, {
        ...input,
        id: input.id ?? `agent_${randomUUID()}`,
      }, input.provisioningKey);
      state.agents.push(structuredClone(created));
      return created;
    });
  }); }

  getPlaybookSubscription(id: string) { return effect(async () => {
    const value = (await this.snapshot()).subscriptions.find((item) => item.id === id);
    return value ? reconstructPlaybookSubscription(value) : null;
  }); }

  putPlaybookSubscription(subscription: PlaybookSubscription) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.subscriptions, reconstructPlaybookSubscription(subscription)));
  }); }

  deletePlaybookSubscription(id: string) { return effect(async () => {
    await this.ensureInitialized();
    return this.mutate((state) => {
      const length = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter((item) => item.id !== id);
      return state.subscriptions.length !== length;
    });
  }); }

  listPlaybookSubscriptions(workspaceId?: string) { return effect(async () =>
    (await this.snapshot()).subscriptions
      .filter((item) => !workspaceId || item.workspaceId === workspaceId)
      .map(reconstructPlaybookSubscription)); }

  getInboundDelivery(key: string) { return effect(async () =>
    (await this.snapshot()).inboundDeliveries.find((item) => item.key === key) ?? null); }

  claimInboundDelivery(key: string) { return effect(async () => {
    await this.ensureInitialized();
    return this.mutate((state) => {
      if (state.inboundDeliveries.some((item) => item.key === key)) return false;
      state.inboundDeliveries.push({
        key,
        status: "pending",
        runIds: [],
        claimedAt: new Date().toISOString(),
      });
      return true;
    });
  }); }

  completeInboundDelivery(key: string, runIds: ReadonlyArray<string>) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => {
      const prior = state.inboundDeliveries.find((item) => item.key === key);
      if (!prior) throw new Error(`Inbound delivery claim "${key}" does not exist.`);
      const index = state.inboundDeliveries.findIndex((item) => item.key === key);
      state.inboundDeliveries[index] = structuredClone({
        ...prior,
        status: "completed",
        runIds: [...runIds],
        completedAt: new Date().toISOString(),
      });
    });
  }); }

  releaseInboundDelivery(key: string) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => {
      state.inboundDeliveries = state.inboundDeliveries.filter(
        (item) => item.key !== key || item.status !== "pending",
      );
    });
  }); }

  getActivation(id: string) { return effect(async () =>
    structuredClone((await this.snapshot()).activations.find((item) => item.id === id) ?? null)); }

  putActivation(activation: FoundryActivationRecord) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.activations, activation));
  }); }

  listActivations(workspaceId?: string) { return effect(async () =>
    structuredClone((await this.snapshot()).activations.filter((item) => !workspaceId || item.workspaceId === workspaceId))); }

  getConversation(id: string) { return effect(async () =>
    structuredClone((await this.snapshot()).conversations.find((item) => item.id === id) ?? null)); }

  putConversation(conversation: Conversation) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.conversations, conversation));
  }); }

  listConversations(agentId: string) { return effect(async () =>
    structuredClone((await this.snapshot()).conversations.filter((item) => item.agentId === agentId))); }

  getWorkspaceEntry(workspaceId: string, key: string) { return effect(async () =>
    structuredClone((await this.snapshot()).workspaceEntries.find((item) => item.workspaceId === workspaceId && item.key === key) ?? null)); }

  putWorkspaceEntry(entry: WorkspaceEntry) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => {
      const index = state.workspaceEntries.findIndex((item) => item.workspaceId === entry.workspaceId && item.key === entry.key);
      if (index === -1) state.workspaceEntries.push(structuredClone(entry));
      else state.workspaceEntries[index] = structuredClone(entry);
    });
  }); }

  listWorkspaceEntries(workspaceId: string) { return effect(async () =>
    structuredClone((await this.snapshot()).workspaceEntries.filter((item) => item.workspaceId === workspaceId))); }

  getWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner) { return effect(async () => {
    const key = environmentOwnerKey(owner);
    const value = (await this.snapshot()).workingEnvironments.find((item) => environmentOwnerKey(item.owner) === key);
    return value ? structuredClone(value.snapshot) : null;
  }); }

  putWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner, snapshot: EnvSnapshot) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => {
      const key = environmentOwnerKey(owner);
      const index = state.workingEnvironments.findIndex((item) => environmentOwnerKey(item.owner) === key);
      const value = structuredClone({ owner, snapshot });
      if (index === -1) state.workingEnvironments.push(value);
      else state.workingEnvironments[index] = value;
    });
  }); }

  putInboxItem(item: SharedInboxItem) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.inbox, item));
  }); }

  listInboxItems(workspaceId: string) { return effect(async () =>
    structuredClone((await this.snapshot()).inbox.filter((item) => item.workspaceId === workspaceId))); }

  putTask(task: FoundryTask) { return effect(async () => {
    await this.ensureInitialized();
    await this.mutate((state) => replaceById(state.tasks, task));
  }); }

  listTasks(workspaceId: string) { return effect(async () =>
    structuredClone((await this.snapshot()).tasks.filter((item) => item.workspaceId === workspaceId))); }

  listEnvironment(scope: { readonly workspaceId: string; readonly agentId?: string; readonly conversationId?: string }) {
    return effect(async () => structuredClone((await this.snapshot()).environment.filter((item) =>
      item.workspaceId === scope.workspaceId &&
      (item.scope === "workspace" ||
        (item.scope === "agent" && item.agentId === scope.agentId) ||
        (item.scope === "conversation" && item.conversationId === scope.conversationId)),
    )));
  }
}
