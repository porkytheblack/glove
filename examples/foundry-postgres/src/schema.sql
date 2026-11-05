-- Glove Foundry runtime data and transcripts in PostgreSQL.
--
-- Every record is stored whole in a `doc json` column, exactly as Foundry
-- wrote it. `json` keeps the text as written; `jsonb` reorders keys and
-- drops duplicates, which is fine for querying but not for a record Foundry
-- reads back and compares. The columns beside it are projections the
-- adapter filters on, and the constraints are where the atomic guarantees
-- come from: a primary key or unique index turns INSERT ... ON CONFLICT DO
-- NOTHING into Foundry's insert-if-absent "claim".
--
-- Idempotent: safe to run on every start.

create table if not exists foundry_agents (
  id text primary key,
  definition_id text not null,
  -- provisionAgent returns the existing instance for a known key: unique.
  provisioning_key text unique,
  doc json not null
);
create index if not exists foundry_agents_definition on foundry_agents (definition_id);

create table if not exists foundry_subscriptions (
  id text primary key,
  workspace_id text not null,
  doc json not null
);

-- Inbound delivery claims: one per provider event, insert-if-absent.
create table if not exists foundry_inbound_deliveries (
  key text primary key,
  status text not null,
  doc json not null
);

-- The durable event journal: insert-if-absent by event record id.
create table if not exists foundry_events (
  id text primary key,
  agent_id text not null,
  doc json not null
);
create index if not exists foundry_events_agent on foundry_events (agent_id);

create table if not exists foundry_pending_inbound (
  id text primary key,
  agent_id text not null,
  doc json not null
);

create table if not exists foundry_approvals (
  id text primary key,
  agent_id text,
  doc json not null
);

create table if not exists foundry_activations (
  id text primary key,
  workspace_id text not null,
  agent_id text not null,
  doc json not null
);
create index if not exists foundry_activations_workspace on foundry_activations (workspace_id);

-- Schedule occurrences: claimed before the activation's cursor moves.
create table if not exists foundry_occurrences (
  id text primary key,
  activation_id text not null,
  workspace_id text not null,
  agent_id text not null,
  status text not null,
  scheduled_for timestamptz not null,
  doc json not null
);
create index if not exists foundry_occurrences_activation on foundry_occurrences (activation_id, scheduled_for);
create index if not exists foundry_occurrences_open on foundry_occurrences (status) where status in ('pending', 'accepted');

-- Event delivery receipts, apart from workspace entries.
create table if not exists foundry_event_receipts (
  id text primary key,
  agent_id text not null,
  conversation_id text not null,
  status text not null,
  doc json not null
);

create table if not exists foundry_conversations (
  id text primary key,
  agent_id text not null,
  doc json not null
);
create index if not exists foundry_conversations_agent on foundry_conversations (agent_id);

-- Workspace entries: compare-and-set on updated_at.
create table if not exists foundry_workspace_entries (
  workspace_id text not null,
  key text not null,
  updated_at text not null,
  doc json not null,
  primary key (workspace_id, key)
);

-- Working-environment (VFS) snapshots, one per owner.
create table if not exists foundry_vfs_snapshots (
  owner_key text primary key,
  agent_id text not null,
  doc json not null
);

create table if not exists foundry_inbox (
  id text primary key,
  workspace_id text not null,
  agent_id text,
  conversation_id text,
  doc json not null
);

create table if not exists foundry_tasks (
  id text primary key,
  workspace_id text not null,
  agent_id text,
  conversation_id text,
  doc json not null
);

-- Environment values are configuration: Foundry only reads them. Never store secrets here.
create table if not exists foundry_environment (
  workspace_id text not null,
  scope text not null check (scope in ('workspace', 'agent', 'conversation')),
  agent_id text,
  conversation_id text,
  key text not null,
  value json not null
);

-- Conversation transcripts for the Glove StoreAdapter.
create table if not exists glove_messages (
  conversation_id text not null,
  seq bigint generated always as identity,
  doc json not null,
  primary key (conversation_id, seq)
);
create table if not exists glove_counters (
  conversation_id text primary key,
  tokens bigint not null default 0,
  turns integer not null default 0
);
create table if not exists glove_permissions (
  conversation_id text not null,
  permission_key text not null,
  status text not null,
  primary key (conversation_id, permission_key)
);
