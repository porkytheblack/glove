import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  MemoryStore,
  permissionKey,
  type InboxItem,
  type Message,
  type PermissionStatus,
  type StoreAdapter,
  type Task,
  type TokenConsumptionCounter,
} from "glove-core";
import { hermesDataDirectory } from "./paths.js";

interface ConversationState {
  readonly version: 1;
  readonly identifier: string;
  messages: Message[];
  usage: TokenConsumptionCounter;
  turns: number;
  tasks: Task[];
  permissions: Record<string, PermissionStatus>;
  inbox: InboxItem[];
}

function emptyState(identifier: string): ConversationState {
  return {
    version: 1,
    identifier,
    messages: [],
    usage: { tokens_in: 0, tokens_out: 0 },
    turns: 0,
    tasks: [],
    permissions: {},
    inbox: [],
  };
}

function code(cause: unknown): string | undefined {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code)
    : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A compact durable StoreAdapter used by the shipping reference deployment. */
class FileConversationStore implements StoreAdapter {
  readonly identifier: string;
  private readonly file: string;
  private readonly lockFile: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(identifier: string) {
    this.identifier = identifier;
    const digest = createHash("sha256").update(identifier).digest("hex");
    this.file = join(hermesDataDirectory(), "conversations", `${digest}.json`);
    this.lockFile = `${this.file}.lock`;
  }

  private serialize<A>(operation: () => Promise<A>): Promise<A> {
    const current = this.queue.then(operation, operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async acquire(): Promise<() => Promise<void>> {
    await mkdir(join(hermesDataDirectory(), "conversations"), { recursive: true });
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        const handle = await open(this.lockFile, "wx");
        await handle.writeFile(String(process.pid));
        await handle.close();
        return async () => {
          try { await unlink(this.lockFile); } catch (cause) {
            if (code(cause) !== "ENOENT") throw cause;
          }
        };
      } catch (cause) {
        if (code(cause) !== "EEXIST") throw cause;
        try {
          const lock = await stat(this.lockFile);
          if (Date.now() - lock.mtimeMs > 30_000) {
            await unlink(this.lockFile);
            continue;
          }
        } catch (lockCause) {
          if (code(lockCause) === "ENOENT") continue;
          throw lockCause;
        }
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for conversation store "${this.identifier}".`);
        await delay(20 + Math.floor(Math.random() * 30));
      }
    }
  }

  private async read(): Promise<ConversationState> {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8")) as ConversationState;
      if (state.version !== 1 || state.identifier !== this.identifier) {
        throw new Error(`Invalid conversation state in "${this.file}".`);
      }
      return state;
    } catch (cause) {
      if (code(cause) === "ENOENT") return emptyState(this.identifier);
      throw cause;
    }
  }

  private async write(state: ConversationState): Promise<void> {
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
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

  private async readSnapshot(): Promise<ConversationState> {
    await this.queue;
    return structuredClone(await this.read());
  }

  private async mutate<A>(operation: (state: ConversationState) => A | Promise<A>): Promise<A> {
    return this.serialize(async () => {
      const release = await this.acquire();
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

  async getMessages() { return (await this.readSnapshot()).messages; }
  async appendMessages(messages: Message[]) {
    await this.mutate((state) => { state.messages.push(...structuredClone(messages)); });
  }
  async getTokenCount() {
    const usage = (await this.readSnapshot()).usage;
    return usage.tokens_in + usage.tokens_out;
  }
  async getTokenConsumption() { return (await this.readSnapshot()).usage; }
  async addTokens(usage: TokenConsumptionCounter) {
    await this.mutate((state) => {
      state.usage.tokens_in += usage.tokens_in;
      state.usage.tokens_out += usage.tokens_out;
      state.usage.cache_creation_input_tokens =
        (state.usage.cache_creation_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      state.usage.cache_read_input_tokens =
        (state.usage.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    });
  }
  async getTurnCount() { return (await this.readSnapshot()).turns; }
  async incrementTurn() { await this.mutate((state) => { state.turns += 1; }); }
  async resetCounters() {
    await this.mutate((state) => {
      state.turns = 0;
      state.usage = { tokens_in: 0, tokens_out: 0 };
    });
  }
  async getTasks() { return (await this.readSnapshot()).tasks; }
  async addTasks(tasks: Task[]) {
    await this.mutate((state) => { state.tasks = structuredClone(tasks); });
  }
  async updateTask(taskId: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>) {
    await this.mutate((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (task) Object.assign(task, structuredClone(updates));
    });
  }
  async getPermission(toolName: string, input?: unknown) {
    return (await this.readSnapshot()).permissions[permissionKey(toolName, input)] ?? "unset";
  }
  async setPermission(toolName: string, status: PermissionStatus, input?: unknown) {
    await this.mutate((state) => { state.permissions[permissionKey(toolName, input)] = status; });
  }
  async getInboxItems() { return (await this.readSnapshot()).inbox; }
  async addInboxItem(item: InboxItem) {
    await this.mutate((state) => {
      const index = state.inbox.findIndex((candidate) => candidate.id === item.id);
      if (index === -1) state.inbox.push(structuredClone(item));
      else state.inbox[index] = structuredClone(item);
    });
  }
  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ) {
    await this.mutate((state) => {
      const item = state.inbox.find((candidate) => candidate.id === itemId);
      if (item) Object.assign(item, structuredClone(updates));
    });
  }
  async getResolvedInboxItems() {
    return (await this.readSnapshot()).inbox.filter((item) => item.status === "resolved");
  }
  async createSubAgentStore(namespace: string, durable = false): Promise<StoreAdapter> {
    if (!durable) return new MemoryStore(`${this.identifier}:ephemeral:${namespace}:${randomUUID()}`);
    return new FileConversationStore(`${this.identifier}:subagent:${namespace}`);
  }
}

export function hermesConversationStore(scope: {
  readonly agentId: string;
  readonly conversationId: string;
}) {
  return new FileConversationStore(`foundry-hermes:${scope.agentId}:${scope.conversationId}`);
}
