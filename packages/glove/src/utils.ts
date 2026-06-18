import type {
  InboxItem,
  Message,
  PermissionStatus,
  StoreAdapter,
  Task,
  TokenConsumptionCounter,
} from "./core";

/**
 * Build a canonical permission key from a tool name and its input.
 *
 * `(toolName, input) → "${toolName}::${JSON.stringify(input ?? null)}"`
 *
 * Exact-match semantics: distinct inputs produce distinct keys, so the
 * agent will re-ask for permission whenever the input differs. Stores
 * that want fuzzier matching (prefix on a shell command, directory on
 * a file path, &c.) should implement their own keying instead of using
 * this helper.
 */
export function permissionKey(toolName: string, input?: unknown): string {
  let payload: string;
  try {
    payload = JSON.stringify(input ?? null);
  } catch {
    // Circular / non-serializable inputs fall back to a per-tool key so we
    // never throw out of a permission lookup. The caller still gets a
    // working (if coarser) decision.
    payload = "null";
  }
  return `${toolName}::${payload}`;
}

/**
 * Default in-memory `StoreAdapter`. Used by `Glove` when the caller doesn't
 * supply a store, and freely usable as a no-setup option for prototyping,
 * tests, and short-lived sessions. All data lives in process memory and is
 * lost when the instance is garbage-collected.
 *
 * Implements `createSubAgentStore` so subagents work out of the box: with
 * `durable: false` (the default) every invocation gets a fresh child store;
 * with `durable: true` the same child instance is returned for the same
 * namespace so a subagent can carry message history across invocations.
 */
export class MemoryStore implements StoreAdapter {
  identifier: string;

  private messages: Array<Message> = [];
  private tokensIn = 0;
  private tokensOut = 0;
  private cacheCreationInputTokens = 0;
  private cacheReadInputTokens = 0;
  private turnCount = 0;
  private tasks: Array<Task> = [];
  private permissions = new Map<string, PermissionStatus>();
  private inboxItems: Array<InboxItem> = [];
  private durableSubStores = new Map<string, MemoryStore>();

  constructor(identifier: string) {
    this.identifier = identifier;
  }

  async getMessages() {
    return this.messages;
  }

  async appendMessages(msgs: Array<Message>) {
    this.messages.push(...msgs);
  }

  async getTokenCount() {
    return this.tokensIn + this.tokensOut;
  }

  async addTokens(args: TokenConsumptionCounter) {
    this.tokensIn += args.tokens_in;
    this.tokensOut += args.tokens_out;
    this.cacheCreationInputTokens += args.cache_creation_input_tokens ?? 0;
    this.cacheReadInputTokens += args.cache_read_input_tokens ?? 0;
  }

  async getTokenConsumption(): Promise<TokenConsumptionCounter> {
    return {
      tokens_in: this.tokensIn,
      tokens_out: this.tokensOut,
      cache_creation_input_tokens: this.cacheCreationInputTokens,
      cache_read_input_tokens: this.cacheReadInputTokens,
    };
  }

  async getTurnCount() {
    return this.turnCount;
  }

  async incrementTurn() {
    this.turnCount++;
  }

  async resetCounters() {
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.cacheCreationInputTokens = 0;
    this.cacheReadInputTokens = 0;
    this.turnCount = 0;
  }

  async getTasks() {
    return this.tasks;
  }

  async addTasks(tasks: Array<Task>) {
    this.tasks = tasks;
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) Object.assign(task, updates);
  }

  async getPermission(toolName: string, input?: unknown) {
    return this.permissions.get(permissionKey(toolName, input)) ?? "unset";
  }

  async setPermission(toolName: string, status: PermissionStatus, input?: unknown) {
    this.permissions.set(permissionKey(toolName, input), status);
  }

  async getInboxItems() {
    return this.inboxItems;
  }

  async addInboxItem(item: InboxItem) {
    this.inboxItems.push(item);
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ) {
    const item = this.inboxItems.find((i) => i.id === itemId);
    if (item) Object.assign(item, updates);
  }

  async getResolvedInboxItems() {
    return this.inboxItems.filter((i) => i.status === "resolved");
  }

  async createSubAgentStore(namespace: string, durable = false): Promise<StoreAdapter> {
    if (durable) {
      let existing = this.durableSubStores.get(namespace);
      if (!existing) {
        existing = new MemoryStore(`${this.identifier}__${namespace}`);
        this.durableSubStores.set(namespace, existing);
      }
      return existing;
    }
    return new MemoryStore(`${this.identifier}__${namespace}_${Date.now()}`);
  }
}

// Returns messages from the last compaction onward. The store keeps full history
// for the frontend, while the model only sees the post-compaction context.
export function splitAtLastCompaction(messages: Array<Message>) {
    
    for (let i = messages.length - 1; i > 0;  i--) {
        if(messages[i].is_compaction) {
            return messages.slice(i)
        }
    }

    return messages
}


/**
 * Wraps a Promise to make it abortable via an AbortSignal.
 * When the signal aborts, the returned Promise rejects immediately,
 * even if the wrapped Promise is still pending (e.g., waiting on pushAndWait).
 *
 * @example
 * await abortablePromise(signal, tool.run(inputs, handOver))
 */
export function abortablePromise<T>(
  signal: AbortSignal | undefined,
  promise: Promise<T>
): Promise<T> {
  // If no signal, just return the original promise
  if (!signal) return promise;

  // If already aborted, reject immediately
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }

  // Race the promise against abort
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new Error("Aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}