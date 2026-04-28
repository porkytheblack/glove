import type { Message, StoreAdapter } from "glove-core/core";

/**
 * Minimal in-memory store used by transient discovery subagents.
 *
 * The subagent is constructed fresh per `find_capability` call and discarded
 * when the call returns, so we never need persistence here.
 */
export class DiscoveryMemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokenCount = 0;
  private turnCount = 0;

  constructor(id: string) {
    this.identifier = id;
  }

  async getMessages() {
    return this.messages;
  }

  async appendMessages(msgs: Array<Message>) {
    this.messages.push(...msgs);
  }

  async getTokenCount() {
    return this.tokenCount;
  }

  async addTokens(count: number) {
    this.tokenCount += count;
  }

  async getTurnCount() {
    return this.turnCount;
  }

  async incrementTurn() {
    this.turnCount++;
  }

  async resetCounters() {
    this.tokenCount = 0;
    this.turnCount = 0;
  }
}
