import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MemoryStore,
  type InboxItem,
  type Message,
  type Task,
  type TokenConsumptionCounter,
} from "glove-core";

import { dataPath } from "./paths.js";

/** Transcripts live in `.data/transcripts`. */
const TRANSCRIPTS = dataPath("transcripts");

interface SavedConversation {
  readonly messages: Message[];
  readonly turns: number;
  readonly tokens: TokenConsumptionCounter;
  readonly tasks: Task[];
  readonly inbox: InboxItem[];
}

/**
 * Foundry runs every message in a fresh process, so a plain `MemoryStore`
 * would start each turn with no history. This one loads the conversation from
 * a JSON file and rewrites it after every change.
 *
 * One host, one active run per conversation. Replace it with a database-backed
 * StoreAdapter when several hosts share conversations.
 */
export class FileStore extends MemoryStore {
  private restoring = false;
  private writes = Promise.resolve();

  private constructor(conversationId: string, private readonly file: string) {
    super(conversationId);
  }

  static async open(conversationId: string, directory = TRANSCRIPTS): Promise<FileStore> {
    const name = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
    const store = new FileStore(conversationId, join(directory, `${name}.json`));
    await store.restore();
    return store;
  }

  static async remove(conversationId: string): Promise<void> {
    const name = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
    await rm(join(TRANSCRIPTS, `${name}.json`), { force: true });
  }

  private async restore(): Promise<void> {
    let saved: SavedConversation;
    try {
      saved = JSON.parse(await readFile(this.file, "utf8")) as SavedConversation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    this.restoring = true;
    try {
      await this.appendMessages(saved.messages);
      await this.addTokens(saved.tokens);
      for (let turn = 0; turn < saved.turns; turn++) await this.incrementTurn();
      await this.addTasks(saved.tasks);
      for (const item of saved.inbox) await this.addInboxItem(item);
    } finally {
      this.restoring = false;
    }
  }

  private async save(): Promise<void> {
    if (this.restoring) return;
    // Realtime transcript and usage callbacks can arrive concurrently.
    this.writes = this.writes.then(async () => {
      const saved: SavedConversation = {
        messages: await this.getMessages(),
        turns: await this.getTurnCount(),
        tokens: await this.getTokenConsumption(),
        tasks: await this.getTasks(),
        inbox: await this.getInboxItems(),
      };
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(saved));
      await rename(temporary, this.file);
    });
    await this.writes;
  }

  override async appendMessages(messages: Message[]) { await super.appendMessages(messages); await this.save(); }
  override async addTokens(usage: TokenConsumptionCounter) { await super.addTokens(usage); await this.save(); }
  override async incrementTurn() { await super.incrementTurn(); await this.save(); }
  override async resetCounters() { await super.resetCounters(); await this.save(); }
  override async addTasks(tasks: Task[]) { await super.addTasks(tasks); await this.save(); }
  override async updateTask(id: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>) {
    await super.updateTask(id, updates);
    await this.save();
  }
  override async addInboxItem(item: InboxItem) { await super.addInboxItem(item); await this.save(); }
  override async updateInboxItem(id: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>) {
    await super.updateInboxItem(id, updates);
    await this.save();
  }
}
