import type {
  StoreAdapter,
  Message,
  Task,
  TokenConsumptionCounter,
  InboxItem,
  PermissionStatus,
} from "glove-core/core";
import { permissionKey } from "glove-core";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Async actions that delegate storage to the user's backend.
 *
 * Every function receives the `sessionId` that was curried via `createRemoteStore`
 * so a single `actions` object can be shared across sessions.
 *
 * Only `getMessages` and `appendMessages` are required. Everything else falls
 * back to in-memory tracking when omitted.
 */
export interface RemoteStoreActions {
  // Required — message persistence
  getMessages: (sessionId: string) => Promise<Message[]>;
  appendMessages: (sessionId: string, messages: Message[]) => Promise<void>;

  // Optional — in-memory defaults when omitted
  getTokenCount?: (sessionId: string) => Promise<number>;
  addTokens?: (sessionId: string, args: TokenConsumptionCounter) => Promise<void>;
  getTurnCount?: (sessionId: string) => Promise<number>;
  incrementTurn?: (sessionId: string) => Promise<void>;
  resetCounters?: (sessionId: string) => Promise<void>;

  // Tasks
  getTasks?: (sessionId: string) => Promise<Task[]>;
  addTasks?: (sessionId: string, tasks: Task[]) => Promise<void>;
  updateTask?: (
    sessionId: string,
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ) => Promise<void>;

  // Inbox
  getInboxItems?: (sessionId: string) => Promise<InboxItem[]>;
  addInboxItem?: (sessionId: string, item: InboxItem) => Promise<void>;
  updateInboxItem?: (
    sessionId: string,
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ) => Promise<void>;
  getResolvedInboxItems?: (sessionId: string) => Promise<InboxItem[]>;

  // Permissions
  //
  // `input` is the model-supplied tool input for THIS call. Use it to scope
  // decisions per-input (e.g. exact-match on a canonical form) or ignore it
  // and apply the decision to the whole tool. When omitted, the in-memory
  // fallback keys decisions on `(toolName, JSON.stringify(input ?? null))`,
  // matching the default `MemoryStore`.
  getPermission?: (
    sessionId: string,
    toolName: string,
    input?: unknown,
  ) => Promise<PermissionStatus>;
  setPermission?: (
    sessionId: string,
    toolName: string,
    status: PermissionStatus,
    input?: unknown,
  ) => Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a `StoreAdapter` that delegates to user-provided async functions.
 *
 * ```ts
 * const storeActions = {
 *   getMessages: (sid) => fetch(`/api/${sid}/messages`).then(r => r.json()),
 *   appendMessages: (sid, msgs) =>
 *     fetch(`/api/${sid}/messages`, { method: "POST", body: JSON.stringify(msgs) }),
 * };
 *
 * const store = createRemoteStore("session-123", storeActions);
 * ```
 *
 * @param sessionId - Curried into every action call
 * @param actions   - User-provided async functions (only getMessages + appendMessages required)
 */
export function createRemoteStore(
  sessionId: string,
  actions: RemoteStoreActions,
): StoreAdapter {
  // In-memory fallbacks for optional methods
  let tokenCount = 0;
  let turnCount = 0;
  let tasks: Task[] = [];
  let inboxItems: InboxItem[] = [];
  const permissions = new Map<string, PermissionStatus>();

  return {
    identifier: sessionId,

    // ─── Required ──────────────────────────────────────────────────────────

    async getMessages() {
      return actions.getMessages(sessionId);
    },

    async appendMessages(msgs) {
      await actions.appendMessages(sessionId, msgs);
    },

    // ─── Tokens ────────────────────────────────────────────────────────────

    async getTokenCount() {
      if (actions.getTokenCount) return actions.getTokenCount(sessionId);
      return tokenCount;
    },

    async addTokens(args) {
      if (actions.addTokens) {
        await actions.addTokens(sessionId, args);
      } else {
        tokenCount += args.tokens_in + args.tokens_out;
      }
    },

    // ─── Turns ─────────────────────────────────────────────────────────────

    async getTurnCount() {
      if (actions.getTurnCount) return actions.getTurnCount(sessionId);
      return turnCount;
    },

    async incrementTurn() {
      if (actions.incrementTurn) {
        await actions.incrementTurn(sessionId);
      } else {
        turnCount++;
      }
    },

    // ─── Reset ─────────────────────────────────────────────────────────────

    async resetCounters() {
      if (actions.resetCounters) {
        await actions.resetCounters(sessionId);
      } else {
        tokenCount = 0;
        turnCount = 0;
      }
    },

    // ─── Tasks ─────────────────────────────────────────────────────────────

    async getTasks() {
      if (actions.getTasks) return actions.getTasks(sessionId);
      return tasks;
    },

    async addTasks(newTasks) {
      if (actions.addTasks) {
        await actions.addTasks(sessionId, newTasks);
      } else {
        tasks = newTasks;
      }
    },

    async updateTask(taskId, updates) {
      if (actions.updateTask) {
        await actions.updateTask(sessionId, taskId, updates);
      } else {
        const task = tasks.find((t) => t.id === taskId);
        if (task) Object.assign(task, updates);
      }
    },

    // ─── Inbox ──────────────────────────────────────────────────────────

    async getInboxItems() {
      if (actions.getInboxItems) return actions.getInboxItems(sessionId);
      return inboxItems;
    },

    async addInboxItem(item) {
      if (actions.addInboxItem) {
        await actions.addInboxItem(sessionId, item);
      } else {
        inboxItems.push(item);
      }
    },

    async updateInboxItem(itemId, updates) {
      if (actions.updateInboxItem) {
        await actions.updateInboxItem(sessionId, itemId, updates);
      } else {
        const item = inboxItems.find((i) => i.id === itemId);
        if (item) Object.assign(item, updates);
      }
    },

    async getResolvedInboxItems() {
      if (actions.getResolvedInboxItems) return actions.getResolvedInboxItems(sessionId);
      return inboxItems.filter((i) => i.status === "resolved");
    },

    // ─── Permissions ───────────────────────────────────────────────────────

    async getPermission(toolName, input) {
      if (actions.getPermission)
        return actions.getPermission(sessionId, toolName, input);
      return permissions.get(permissionKey(toolName, input)) ?? "unset";
    },

    async setPermission(toolName, status, input) {
      if (actions.setPermission) {
        await actions.setPermission(sessionId, toolName, status, input);
      } else {
        permissions.set(permissionKey(toolName, input), status);
      }
    },
  };
}
