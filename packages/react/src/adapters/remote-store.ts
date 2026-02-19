import type {
  StoreAdapter,
  Message,
  Task,
  PermissionStatus,
} from "glove-core/core";

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
  addTokens?: (sessionId: string, count: number) => Promise<void>;
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

  // Permissions
  getPermission?: (
    sessionId: string,
    toolName: string,
  ) => Promise<PermissionStatus>;
  setPermission?: (
    sessionId: string,
    toolName: string,
    status: PermissionStatus,
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

    async addTokens(count) {
      if (actions.addTokens) {
        await actions.addTokens(sessionId, count);
      } else {
        tokenCount += count;
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

    // ─── Permissions ───────────────────────────────────────────────────────

    async getPermission(toolName) {
      if (actions.getPermission)
        return actions.getPermission(sessionId, toolName);
      return permissions.get(toolName) ?? "unset";
    },

    async setPermission(toolName, status) {
      if (actions.setPermission) {
        await actions.setPermission(sessionId, toolName, status);
      } else {
        permissions.set(toolName, status);
      }
    },
  };
}
