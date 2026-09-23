import { MemoryStore, type Message, type Task, type InboxItem, type TokenConsumptionCounter } from "glove-core";
import { createHash } from "node:crypto";
import { readState, writeState } from "./state.js";
import { stateDir } from "./settings.js";
interface SavedConversation { version: 2; messages: Message[]; tasks: Task[]; inbox: InboxItem[] }
const estimate = (messages: Message[]) => Math.ceil(JSON.stringify(messages).length / 3);
/** Single active run owns this conversation. Append persists the actual Glove transcript. */
export class ConversationStore extends MemoryStore {
  private promptTokens = 0;
  private countedMessages = 0;
  constructor(id: string, private directory = stateDir) { super(id); }
  private get file() { return `conversation-${createHash("sha256").update(this.identifier).digest("hex")}.json`; }
  static async open(id: string, directory = stateDir) {
    const store = new ConversationStore(id, directory);
    await store.restore();
    return store;
  }
  private async restore() {
    const saved = await readState<Message[] | SavedConversation>(this.file, [], this.directory);
    if (Array.isArray(saved)) { await super.appendMessages(saved); return; }
    if (saved.version !== 2 || !Array.isArray(saved.messages) || !Array.isArray(saved.tasks) || !Array.isArray(saved.inbox)) throw new Error("Unsupported or invalid conversation state; no data was reset.");
    await super.appendMessages(saved.messages);
    await super.addTasks(saved.tasks);
    for (const item of saved.inbox) await super.addInboxItem(item);
  }
  private async save() {
    await writeState(this.file, { version: 2, messages: await this.getMessages(), tasks: await this.getTasks(), inbox: await this.getInboxItems() } satisfies SavedConversation, this.directory);
  }
  override async appendMessages(messages: Message[]) {
    await super.appendMessages(messages);
    await this.save();
  }
  override async addTasks(tasks: Task[]) { await super.addTasks(tasks); await this.save(); }
  override async updateTask(id: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>) { await super.updateTask(id, updates); await this.save(); }
  override async addInboxItem(item: InboxItem) { await super.addInboxItem(item); await this.save(); }
  override async updateInboxItem(id: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>) { await super.updateInboxItem(id, updates); await this.save(); }
  /** Context pressure is not cumulative billing across repeated requests. */
  override async addTokens(usage: TokenConsumptionCounter) {
    await super.addTokens(usage);
    this.promptTokens = usage.tokens_in + usage.tokens_out;
    this.countedMessages = (await this.getMessages()).length;
  }
  override async getTokenCount() {
    const all = await this.getMessages();
    let checkpoint = -1;
    for (let index = all.length - 1; index >= 0; index--) if (all[index].is_compaction) { checkpoint = index; break; }
    const visible = all.slice(Math.max(0, checkpoint));
    return Math.max(estimate(visible), this.promptTokens ? this.promptTokens + estimate(all.slice(this.countedMessages)) : 0);
  }
  override async resetCounters() { await super.resetCounters(); this.promptTokens = 0; this.countedMessages = (await this.getMessages()).length; }
}
