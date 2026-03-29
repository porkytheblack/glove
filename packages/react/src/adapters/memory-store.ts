import type {
  StoreAdapter,
  Message,
  Task,
  InboxItem,
  PermissionStatus,
} from "glove-core/core";

/**
 * In-memory `StoreAdapter` for simple use cases where persistence isn't needed.
 *
 * All data lives in arrays / Maps and is lost when the instance is garbage-collected.
 * Useful for prototyping, testing, or short-lived sessions.
 */
export class MemoryStore implements StoreAdapter {
  identifier: string;

  private messages: Message[] = [];
  private tokenCount = 0;
  private turnCount = 0;
  private tasks: Task[] = [];
  private inboxItems: InboxItem[] = [];
  private permissions = new Map<string, PermissionStatus>();

  constructor(identifier: string) {
    this.identifier = identifier;
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  async getMessages(): Promise<Message[]> {
    return this.messages;
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    this.messages.push(...msgs);
  }

  // ─── Tokens ──────────────────────────────────────────────────────────────────

  async getTokenCount(): Promise<number> {
    return this.tokenCount;
  }

  async addTokens(count: number): Promise<void> {
    this.tokenCount += count;
  }

  // ─── Turns ───────────────────────────────────────────────────────────────────

  async getTurnCount(): Promise<number> {
    return this.turnCount;
  }

  async incrementTurn(): Promise<void> {
    this.turnCount++;
  }

  // ─── Reset ───────────────────────────────────────────────────────────────────

  async resetCounters(): Promise<void> {
    this.tokenCount = 0;
    this.turnCount = 0;
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  async getTasks(): Promise<Task[]> {
    return this.tasks;
  }

  async addTasks(tasks: Task[]): Promise<void> {
    this.tasks = tasks;
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ): Promise<void> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) Object.assign(task, updates);
  }

  // ─── Inbox ─────────────────────────────────────────────────────────────────

  async getInboxItems(): Promise<InboxItem[]> {
    return this.inboxItems;
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    this.inboxItems.push(item);
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void> {
    const item = this.inboxItems.find((i) => i.id === itemId);
    if (item) Object.assign(item, updates);
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> {
    return this.inboxItems.filter((i) => i.status === "resolved");
  }

  // ─── Permissions ─────────────────────────────────────────────────────────────

  async getPermission(toolName: string): Promise<PermissionStatus> {
    return this.permissions.get(toolName) ?? "unset";
  }

  async setPermission(
    toolName: string,
    status: PermissionStatus,
  ): Promise<void> {
    this.permissions.set(toolName, status);
  }
}
