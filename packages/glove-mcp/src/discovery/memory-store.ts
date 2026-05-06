import type { Message, StoreAdapter, TokenConsumptionCounter } from "glove-core/core";

/**
 * Minimal in-memory fallback store used when the parent store doesn't
 * implement `createSubAgentStore`. Each `discovermcp` invocation gets
 * its own instance so prior search state never leaks across calls.
 */
export class DiscoveryMemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokensIn = 0;
  private tokensOut = 0;
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
    return this.tokensIn + this.tokensOut;
  }

  async addTokens(args: TokenConsumptionCounter) {
    this.tokensIn += args.tokens_in;
    this.tokensOut += args.tokens_out;
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
    this.turnCount = 0;
  }
}
