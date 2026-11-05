/**
 * Foundry runtime data in PostgreSQL: a complete FoundryDataAdapter,
 * including the optional methods that make the event journal, approvals,
 * schedule occurrences and event delivery receipts durable.
 *
 * Every Foundry process builds its own adapter (and pool) from configuration
 * in foundry.application.ts: the controller, and each run's child process.
 * Nothing is passed between them but the database.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import pg from "pg";
import {
  createAgentInstance,
  reconstructAgentInstance,
  reconstructPlaybookSubscription,
  type AgentInstance,
  type Conversation,
  type EnvironmentValue,
  type FoundryActivationRecord,
  type FoundryApproval,
  type FoundryDataAdapter,
  type FoundryEventReceipt,
  type FoundryEventReceiptFilter,
  type FoundryEventRecord,
  type FoundryPendingInbound,
  type FoundryScheduleOccurrence,
  type FoundryScheduleOccurrenceFilter,
  type FoundryTask,
  type FoundryWorkingEnvironmentSnapshotOwner,
  type InboundDeliveryClaim,
  type PlaybookSubscription,
  type ProvisionAgentOptions,
  type SharedInboxItem,
  type WorkspaceEntry,
} from "glove-foundry";

type EnvSnapshot = Parameters<FoundryDataAdapter["putWorkingEnvironmentSnapshot"]>[1];
type Queryable = Pick<pg.Pool, "query">;

/** Run a query as an Effect with Foundry's `unknown` error channel. */
function run<A>(work: () => Promise<A>): Effect.Effect<A, unknown, never> {
  return Effect.tryPromise({ try: work, catch: (cause) => cause });
}

/** `json` keeps the document as written; the driver hands it back parsed. */
const doc = (value: unknown): string => JSON.stringify(value);

function statusList(status: string | ReadonlyArray<string> | undefined): string[] | null {
  if (!status) return null;
  return typeof status === "string" ? [status] : [...status];
}

function ownerKey(owner: FoundryWorkingEnvironmentSnapshotOwner): string {
  return [owner.scope, owner.workspaceId, owner.definitionId, owner.agentId, owner.scope === "conversation" ? owner.conversationId : ""].join("\u0000");
}

/** Create the tables if they do not exist. Safe to call on every start. */
export async function migrate(pool: Queryable): Promise<void> {
  await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
}

export interface PostgresFoundryDataAdapterOptions {
  readonly pool: pg.Pool;
  readonly identifier?: string;
}

export class PostgresFoundryDataAdapter implements FoundryDataAdapter {
  readonly identifier: string;
  private readonly pool: pg.Pool;

  constructor(options: PostgresFoundryDataAdapterOptions) {
    this.pool = options.pool;
    this.identifier = options.identifier ?? "foundry-postgres";
  }

  private async rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<{ doc: T }>(text, values)).rows.map((row) => row.doc);
  }

  private async one<T>(text: string, values: unknown[]): Promise<T | null> {
    return (await this.rows<T>(text, values))[0] ?? null;
  }

  private async purged(agentId: string): Promise<boolean> {
    const result = await this.pool.query(
      "select 1 from foundry_agents where id = $1 and doc->'durableSubagent'->>'status' = 'purged'", [agentId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ── Agent instances ───────────────────────────────────────────────────────

  getAgent(id: string) {
    return run(async () => {
      const agent = await this.one<AgentInstance>("select doc from foundry_agents where id = $1", [id]);
      return agent ? reconstructAgentInstance(agent) : null;
    });
  }

  putAgent(agent: AgentInstance) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_agents (id, definition_id, provisioning_key, doc) values ($1, $2, $3, $4)
         on conflict (id) do update set definition_id = excluded.definition_id,
           provisioning_key = excluded.provisioning_key, doc = excluded.doc`,
        [agent.id, agent.definitionId, agent.provisioningKey ?? null, doc(agent)]);
    });
  }

  listAgents(definitionId?: string) {
    return run(async () => (await this.rows<AgentInstance>(
      "select doc from foundry_agents where $1::text is null or definition_id = $1 order by id", [definitionId ?? null]))
      .map(reconstructAgentInstance));
  }

  /**
   * Atomic on `provisioningKey`: concurrent calls with one key return one
   * instance. The unique index decides; the loser reads the winner's row.
   */
  provisionAgent(input: ProvisionAgentOptions) {
    return run(async () => {
      const created = createAgentInstance(input.definitionId, { ...input, id: input.id ?? `agent_${randomUUID()}` }, input.provisioningKey);
      const inserted = await this.pool.query(
        `insert into foundry_agents (id, definition_id, provisioning_key, doc) values ($1, $2, $3, $4)
         on conflict do nothing returning id`,
        [created.id, created.definitionId, input.provisioningKey, doc(created)]);
      if (inserted.rowCount) return created;
      const existing = await this.one<AgentInstance>("select doc from foundry_agents where provisioning_key = $1", [input.provisioningKey]);
      if (!existing) throw new Error(`Agent instance "${created.id}" already exists with another provisioning key.`);
      return reconstructAgentInstance(existing);
    });
  }

  /** Remove an archived worker's owned records in one transaction; keep a tombstone. */
  purgeAgentData(agentId: string) {
    return run(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const agent = (await client.query<{ doc: AgentInstance }>("select doc from foundry_agents where id = $1 for update", [agentId])).rows[0]?.doc;
        if (!agent?.durableSubagent || agent.durableSubagent.status !== "archived") throw new Error("Only archived durable workers can be purged.");
        const conversations = (await client.query<{ id: string }>("select id from foundry_conversations where agent_id = $1", [agentId])).rows.map((row) => row.id);
        for (const table of ["foundry_events", "foundry_pending_inbound", "foundry_approvals", "foundry_activations", "foundry_occurrences", "foundry_event_receipts", "foundry_vfs_snapshots"]) {
          await client.query(`delete from ${table} where agent_id = $1`, [agentId]);
        }
        for (const table of ["foundry_inbox", "foundry_tasks"]) {
          await client.query(`delete from ${table} where agent_id = $1 or conversation_id = any($2)`, [agentId, conversations]);
        }
        await client.query("delete from foundry_environment where scope <> 'workspace' and (agent_id = $1 or conversation_id = any($2))", [agentId, conversations]);
        await client.query("delete from foundry_conversations where agent_id = $1", [agentId]);
        const tombstone = reconstructAgentInstance({
          ...agent, context: {}, installations: [], playbooks: [],
          durableSubagent: { ...agent.durableSubagent, status: "purged" }, updatedAt: new Date().toISOString(),
        });
        await client.query("update foundry_agents set doc = $2 where id = $1", [agentId, doc(tombstone)]);
        await client.query("commit");
      } catch (cause) {
        await client.query("rollback").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    });
  }

  // ── Playbook subscriptions ────────────────────────────────────────────────

  getPlaybookSubscription(id: string) {
    return run(async () => {
      const subscription = await this.one<PlaybookSubscription>("select doc from foundry_subscriptions where id = $1", [id]);
      return subscription ? reconstructPlaybookSubscription(subscription) : null;
    });
  }

  putPlaybookSubscription(subscription: PlaybookSubscription) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_subscriptions (id, workspace_id, doc) values ($1, $2, $3)
         on conflict (id) do update set workspace_id = excluded.workspace_id, doc = excluded.doc`,
        [subscription.id, subscription.workspaceId, doc(subscription)]);
    });
  }

  deletePlaybookSubscription(id: string) {
    return run(async () => ((await this.pool.query("delete from foundry_subscriptions where id = $1", [id])).rowCount ?? 0) > 0);
  }

  listPlaybookSubscriptions(workspaceId?: string) {
    return run(async () => (await this.rows<PlaybookSubscription>(
      "select doc from foundry_subscriptions where $1::text is null or workspace_id = $1 order by id", [workspaceId ?? null]))
      .map(reconstructPlaybookSubscription));
  }

  // ── Inbound delivery claims ───────────────────────────────────────────────

  getInboundDelivery(key: string) {
    return run(() => this.one<InboundDeliveryClaim>("select doc from foundry_inbound_deliveries where key = $1", [key]));
  }

  /** Insert-if-absent: true only for the first caller. */
  claimInboundDelivery(key: string) {
    return run(async () => {
      const claim: InboundDeliveryClaim = { key, status: "pending", runIds: [], claimedAt: new Date().toISOString() };
      const result = await this.pool.query(
        "insert into foundry_inbound_deliveries (key, status, doc) values ($1, 'pending', $2) on conflict (key) do nothing", [key, doc(claim)]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  completeInboundDelivery(key: string, runIds: ReadonlyArray<string>) {
    return run(async () => {
      const prior = await this.one<InboundDeliveryClaim>("select doc from foundry_inbound_deliveries where key = $1", [key]);
      if (!prior) throw new Error(`Inbound delivery claim "${key}" does not exist.`);
      const completed: InboundDeliveryClaim = { ...prior, status: "completed", runIds: [...runIds], completedAt: new Date().toISOString() };
      await this.pool.query("update foundry_inbound_deliveries set status = 'completed', doc = $2 where key = $1", [key, doc(completed)]);
    });
  }

  /** Remove only a pending claim, so a failed dispatch can be retried. */
  releaseInboundDelivery(key: string) {
    return run(async () => { await this.pool.query("delete from foundry_inbound_deliveries where key = $1 and status = 'pending'", [key]); });
  }

  // ── Event journal ─────────────────────────────────────────────────────────

  /** Insert-if-absent by event record id. */
  claimEvent(record: FoundryEventRecord) {
    return run(async () => {
      if (await this.purged(record.target.agentId)) throw new Error("Cannot deliver an event to a purged worker.");
      const result = await this.pool.query(
        "insert into foundry_events (id, agent_id, doc) values ($1, $2, $3) on conflict (id) do nothing",
        [record.id, record.target.agentId, doc(record)]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  putEvent(record: FoundryEventRecord) {
    return run(async () => {
      if (await this.purged(record.target.agentId)) return;
      await this.pool.query(
        "insert into foundry_events (id, agent_id, doc) values ($1, $2, $3) on conflict (id) do update set doc = excluded.doc",
        [record.id, record.target.agentId, doc(record)]);
    });
  }

  listEvents() {
    return run(() => this.rows<FoundryEventRecord>("select doc from foundry_events order by id"));
  }

  // ── Pending inbound events ────────────────────────────────────────────────

  putPendingInbound(record: FoundryPendingInbound) {
    return run(async () => {
      await this.pool.query(
        "insert into foundry_pending_inbound (id, agent_id, doc) values ($1, $2, $3) on conflict (id) do update set doc = excluded.doc",
        [record.id, record.request.agentId, doc(record)]);
    });
  }

  deletePendingInbound(id: string) {
    return run(async () => { await this.pool.query("delete from foundry_pending_inbound where id = $1", [id]); });
  }

  listPendingInbound() {
    return run(() => this.rows<FoundryPendingInbound>("select doc from foundry_pending_inbound order by id"));
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  putApproval(approval: FoundryApproval) {
    return run(async () => {
      await this.pool.query(
        "insert into foundry_approvals (id, agent_id, doc) values ($1, $2, $3) on conflict (id) do update set doc = excluded.doc",
        [approval.id, approval.agentId ?? null, doc(approval)]);
    });
  }

  getApproval(id: string) {
    return run(() => this.one<FoundryApproval>("select doc from foundry_approvals where id = $1", [id]));
  }

  listApprovals() {
    return run(() => this.rows<FoundryApproval>("select doc from foundry_approvals order by id"));
  }

  // ── Activations and schedule occurrences ──────────────────────────────────

  getActivation(id: string) {
    return run(() => this.one<FoundryActivationRecord>("select doc from foundry_activations where id = $1", [id]));
  }

  putActivation(activation: FoundryActivationRecord) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_activations (id, workspace_id, agent_id, doc) values ($1, $2, $3, $4)
         on conflict (id) do update set workspace_id = excluded.workspace_id, agent_id = excluded.agent_id, doc = excluded.doc`,
        [activation.id, activation.workspaceId, activation.agentId, doc(activation)]);
    });
  }

  listActivations(workspaceId?: string) {
    return run(() => this.rows<FoundryActivationRecord>(
      "select doc from foundry_activations where $1::text is null or workspace_id = $1 order by id", [workspaceId ?? null]));
  }

  /** Insert-if-absent: the obligation exists before the activation's cursor moves past it. */
  claimScheduleOccurrence(occurrence: FoundryScheduleOccurrence) {
    return run(async () => {
      const result = await this.pool.query(
        `insert into foundry_occurrences (id, activation_id, workspace_id, agent_id, status, scheduled_for, doc)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
        [occurrence.id, occurrence.activationId, occurrence.workspaceId, occurrence.agentId, occurrence.status, occurrence.scheduledFor, doc(occurrence)]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  putScheduleOccurrence(occurrence: FoundryScheduleOccurrence) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_occurrences (id, activation_id, workspace_id, agent_id, status, scheduled_for, doc)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set status = excluded.status, doc = excluded.doc`,
        [occurrence.id, occurrence.activationId, occurrence.workspaceId, occurrence.agentId, occurrence.status, occurrence.scheduledFor, doc(occurrence)]);
    });
  }

  getScheduleOccurrence(id: string) {
    return run(() => this.one<FoundryScheduleOccurrence>("select doc from foundry_occurrences where id = $1", [id]));
  }

  listScheduleOccurrences(filter: FoundryScheduleOccurrenceFilter = {}) {
    return run(() => this.rows<FoundryScheduleOccurrence>(
      `select doc from foundry_occurrences
       where ($1::text is null or activation_id = $1) and ($2::text is null or workspace_id = $2)
         and ($3::text is null or agent_id = $3) and ($4::text[] is null or status = any($4))
       order by scheduled_for, id`,
      [filter.activationId ?? null, filter.workspaceId ?? null, filter.agentId ?? null, statusList(filter.status)]));
  }

  // ── Event delivery receipts ───────────────────────────────────────────────

  claimEventReceipt(receipt: FoundryEventReceipt) {
    return run(async () => {
      const result = await this.pool.query(
        `insert into foundry_event_receipts (id, agent_id, conversation_id, status, doc) values ($1, $2, $3, $4, $5)
         on conflict (id) do nothing`,
        [receipt.id, receipt.agentId, receipt.conversationId, receipt.status, doc(receipt)]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  putEventReceipt(receipt: FoundryEventReceipt) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_event_receipts (id, agent_id, conversation_id, status, doc) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set status = excluded.status, doc = excluded.doc`,
        [receipt.id, receipt.agentId, receipt.conversationId, receipt.status, doc(receipt)]);
    });
  }

  getEventReceipt(id: string) {
    return run(() => this.one<FoundryEventReceipt>("select doc from foundry_event_receipts where id = $1", [id]));
  }

  listEventReceipts(filter: FoundryEventReceiptFilter = {}) {
    return run(() => this.rows<FoundryEventReceipt>(
      `select doc from foundry_event_receipts
       where ($1::text is null or agent_id = $1) and ($2::text is null or conversation_id = $2) and ($3::text[] is null or status = any($3))
       order by id`,
      [filter.agentId ?? null, filter.conversationId ?? null, statusList(filter.status)]));
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  getConversation(id: string) {
    return run(() => this.one<Conversation>("select doc from foundry_conversations where id = $1", [id]));
  }

  putConversation(conversation: Conversation) {
    return run(async () => {
      await this.pool.query(
        "insert into foundry_conversations (id, agent_id, doc) values ($1, $2, $3) on conflict (id) do update set agent_id = excluded.agent_id, doc = excluded.doc",
        [conversation.id, conversation.agentId, doc(conversation)]);
    });
  }

  listConversations(agentId: string) {
    return run(() => this.rows<Conversation>("select doc from foundry_conversations where agent_id = $1 order by id", [agentId]));
  }

  // ── Workspace entries ─────────────────────────────────────────────────────

  getWorkspaceEntry(workspaceId: string, key: string) {
    return run(() => this.one<WorkspaceEntry>("select doc from foundry_workspace_entries where workspace_id = $1 and key = $2", [workspaceId, key]));
  }

  putWorkspaceEntry(entry: WorkspaceEntry) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_workspace_entries (workspace_id, key, updated_at, doc) values ($1, $2, $3, $4)
         on conflict (workspace_id, key) do update set updated_at = excluded.updated_at, doc = excluded.doc`,
        [entry.workspaceId, entry.key, entry.updatedAt, doc(entry)]);
    });
  }

  /**
   * Atomic optimistic update: succeeds only when the stored `updatedAt` is
   * `expectedUpdatedAt` (null: the entry must not exist), and must advance it.
   */
  compareAndSetWorkspaceEntry(entry: WorkspaceEntry, expectedUpdatedAt: string | null) {
    return run(async () => {
      if (!Number.isFinite(Date.parse(entry.updatedAt)) || (expectedUpdatedAt !== null && Date.parse(entry.updatedAt) <= Date.parse(expectedUpdatedAt))) {
        throw new Error("An atomic workspace update must advance updatedAt.");
      }
      const result = expectedUpdatedAt === null
        ? await this.pool.query(
            `insert into foundry_workspace_entries (workspace_id, key, updated_at, doc) values ($1, $2, $3, $4)
             on conflict (workspace_id, key) do nothing`,
            [entry.workspaceId, entry.key, entry.updatedAt, doc(entry)])
        : await this.pool.query(
            `update foundry_workspace_entries set updated_at = $3, doc = $4
             where workspace_id = $1 and key = $2 and updated_at = $5`,
            [entry.workspaceId, entry.key, entry.updatedAt, doc(entry), expectedUpdatedAt]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  listWorkspaceEntries(workspaceId: string) {
    return run(() => this.rows<WorkspaceEntry>("select doc from foundry_workspace_entries where workspace_id = $1 order by key", [workspaceId]));
  }

  // ── Working-environment snapshots ─────────────────────────────────────────

  getWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner) {
    return run(() => this.one<EnvSnapshot>("select doc from foundry_vfs_snapshots where owner_key = $1", [ownerKey(owner)]));
  }

  putWorkingEnvironmentSnapshot(owner: FoundryWorkingEnvironmentSnapshotOwner, snapshot: EnvSnapshot) {
    return run(async () => {
      await this.pool.query(
        "insert into foundry_vfs_snapshots (owner_key, agent_id, doc) values ($1, $2, $3) on conflict (owner_key) do update set doc = excluded.doc",
        [ownerKey(owner), owner.agentId, doc(snapshot)]);
    });
  }

  // ── Shared inbox, tasks and environment ───────────────────────────────────

  putInboxItem(item: SharedInboxItem) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_inbox (id, workspace_id, agent_id, conversation_id, doc) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set doc = excluded.doc`,
        [item.id, item.workspaceId, item.agentId ?? null, item.conversationId ?? null, doc(item)]);
    });
  }

  listInboxItems(workspaceId: string) {
    return run(() => this.rows<SharedInboxItem>("select doc from foundry_inbox where workspace_id = $1 order by id", [workspaceId]));
  }

  putTask(task: FoundryTask) {
    return run(async () => {
      await this.pool.query(
        `insert into foundry_tasks (id, workspace_id, agent_id, conversation_id, doc) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set doc = excluded.doc`,
        [task.id, task.workspaceId, task.agentId ?? null, task.conversationId ?? null, doc(task)]);
    });
  }

  listTasks(workspaceId: string) {
    return run(() => this.rows<FoundryTask>("select doc from foundry_tasks where workspace_id = $1 order by id", [workspaceId]));
  }

  listEnvironment(scope: { readonly workspaceId: string; readonly agentId?: string; readonly conversationId?: string }) {
    return run(async () => (await this.pool.query<{ key: string; value: unknown; scope: EnvironmentValue["scope"]; workspace_id: string; agent_id: string | null; conversation_id: string | null }>(
      `select key, value, scope, workspace_id, agent_id, conversation_id from foundry_environment
       where workspace_id = $1 and (scope = 'workspace' or (scope = 'agent' and agent_id = $2) or (scope = 'conversation' and conversation_id = $3))`,
      [scope.workspaceId, scope.agentId ?? null, scope.conversationId ?? null])).rows.map((row): EnvironmentValue => ({
        key: row.key, value: row.value, scope: row.scope, workspaceId: row.workspace_id,
        ...(row.agent_id ? { agentId: row.agent_id } : {}), ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      })));
  }
}
