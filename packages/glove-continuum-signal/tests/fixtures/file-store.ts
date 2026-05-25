import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Message,
  StoreAdapter,
  TokenConsumptionCounter,
} from "glove-core";

interface Persisted {
  messages: Message[];
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
}

/**
 * Minimal file-backed StoreAdapter. Reads on construction, writes on every
 * mutation. Synchronous I/O — fine for tests, not production. The point is
 * to demonstrate that `glove-continuum-signal` re-invokes the agent's
 * `.store(name)` factory on each triggered wakeup and that consumer-provided
 * stores survive across spawns of the bootstrap subprocess.
 */
export class FileStore implements StoreAdapter {
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
}

function blank(): Persisted {
  return { messages: [], tokensIn: 0, tokensOut: 0, turnCount: 0 };
}
