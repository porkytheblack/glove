import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  InboxItem,
  Message,
  StoreAdapter,
  TokenConsumptionCounter,
} from "glove-core";

interface Persisted {
  messages: Message[];
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  inbox: InboxItem[];
}

/**
 * File-backed StoreAdapter with inbox support. Same minimal write-on-every-
 * mutation pattern as `FileStore`, but also implements the optional inbox
 * methods so `mountMesh` accepts it (`assertInboxCapable` requires
 * `getInboxItems`/`addInboxItem`/`updateInboxItem`/`getResolvedInboxItems`).
 */
export class InboxFileStore implements StoreAdapter {
  identifier: string;
  private path: string;
  private state: Persisted;

  constructor(identifier: string, path: string) {
    this.identifier = identifier;
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try {
        this.state = JSON.parse(readFileSync(path, "utf8")) as Persisted;
        this.state.inbox ??= [];
      } catch {
        this.state = blank();
      }
    } else {
      this.state = blank();
    }
  }

  private flush(): void {
    writeFileSync(this.path, JSON.stringify(this.state));
  }

  async getMessages(): Promise<Message[]> {
    return [...this.state.messages];
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    this.state.messages.push(...msgs);
    this.flush();
  }

  async getTokenCount(): Promise<number> {
    return this.state.tokensIn + this.state.tokensOut;
  }

  async addTokens(c: TokenConsumptionCounter): Promise<void> {
    this.state.tokensIn += c.tokens_in;
    this.state.tokensOut += c.tokens_out;
    this.flush();
  }

  async getTurnCount(): Promise<number> {
    return this.state.turnCount;
  }

  async incrementTurn(): Promise<void> {
    this.state.turnCount += 1;
    this.flush();
  }

  async resetCounters(): Promise<void> {
    this.state.tokensIn = 0;
    this.state.tokensOut = 0;
    this.state.turnCount = 0;
    this.flush();
  }

  async getInboxItems(): Promise<InboxItem[]> {
    return [...this.state.inbox];
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    this.state.inbox.push(item);
    this.flush();
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void> {
    const item = this.state.inbox.find((i) => i.id === itemId);
    if (!item) return;
    Object.assign(item, updates);
    this.flush();
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> {
    return this.state.inbox.filter((i) => i.status === "resolved");
  }
}

function blank(): Persisted {
  return {
    messages: [],
    tokensIn: 0,
    tokensOut: 0,
    turnCount: 0,
    inbox: [],
  };
}
