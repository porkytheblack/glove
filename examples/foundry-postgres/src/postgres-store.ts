/**
 * Conversation transcripts in PostgreSQL: the Glove StoreAdapter for one
 * conversation. Messages are kept in insertion order; tokens and turns are
 * counters; permission decisions are keyed the way MemoryStore keys them, so
 * approvals stored by one run are honoured by the next.
 *
 * Use it from a definition: `store: ({ conversationId }) => new PostgresStore(pool, conversationId)`.
 */
import { permissionKey, type Message, type PermissionStatus, type StoreAdapter, type TokenConsumptionCounter } from "glove-core";
import type pg from "pg";

export class PostgresStore implements StoreAdapter {
  readonly identifier: string;

  constructor(private readonly pool: pg.Pool, private readonly conversationId: string) {
    this.identifier = `postgres:${conversationId}`;
  }

  async getMessages(): Promise<Message[]> {
    const result = await this.pool.query<{ doc: Message }>(
      "select doc from glove_messages where conversation_id = $1 order by seq", [this.conversationId]);
    return result.rows.map((row) => row.doc);
  }

  /** One statement: a batch is appended whole or not at all. */
  async appendMessages(messages: Message[]): Promise<void> {
    if (!messages.length) return;
    await this.pool.query(
      `insert into glove_messages (conversation_id, doc)
       select $1, value from json_array_elements($2::json) with ordinality as item(value, position) order by position`,
      [this.conversationId, JSON.stringify(messages)]);
  }

  async getTokenCount(): Promise<number> {
    const result = await this.pool.query<{ tokens: string }>("select tokens from glove_counters where conversation_id = $1", [this.conversationId]);
    return Number(result.rows[0]?.tokens ?? 0);
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    await this.pool.query(
      `insert into glove_counters (conversation_id, tokens) values ($1, $2)
       on conflict (conversation_id) do update set tokens = glove_counters.tokens + excluded.tokens`,
      [this.conversationId, args.tokens_in + args.tokens_out]);
  }

  async getTurnCount(): Promise<number> {
    const result = await this.pool.query<{ turns: number }>("select turns from glove_counters where conversation_id = $1", [this.conversationId]);
    return result.rows[0]?.turns ?? 0;
  }

  async incrementTurn(): Promise<void> {
    await this.pool.query(
      `insert into glove_counters (conversation_id, turns) values ($1, 1)
       on conflict (conversation_id) do update set turns = glove_counters.turns + 1`,
      [this.conversationId]);
  }

  async resetCounters(): Promise<void> {
    await this.pool.query("update glove_counters set tokens = 0, turns = 0 where conversation_id = $1", [this.conversationId]);
  }

  async getPermission(toolName: string, input?: unknown): Promise<PermissionStatus> {
    const result = await this.pool.query<{ status: PermissionStatus }>(
      "select status from glove_permissions where conversation_id = $1 and permission_key = $2",
      [this.conversationId, permissionKey(toolName, input)]);
    return result.rows[0]?.status ?? "unset";
  }

  async setPermission(toolName: string, status: PermissionStatus, input?: unknown): Promise<void> {
    const key = permissionKey(toolName, input);
    if (status === "unset") {
      await this.pool.query("delete from glove_permissions where conversation_id = $1 and permission_key = $2", [this.conversationId, key]);
      return;
    }
    await this.pool.query(
      `insert into glove_permissions (conversation_id, permission_key, status) values ($1, $2, $3)
       on conflict (conversation_id, permission_key) do update set status = excluded.status`,
      [this.conversationId, key, status]);
  }
}
