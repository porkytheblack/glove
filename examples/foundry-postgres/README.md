# Foundry on PostgreSQL

A reference implementation of Glove Foundry persistence on PostgreSQL:

- `src/postgres-data.ts`: a complete `FoundryDataAdapter`, including the optional
  methods that make the event journal, pending inbound events, approvals,
  schedule occurrences and event delivery receipts durable.
- `src/postgres-store.ts`: a Glove `StoreAdapter` for conversation transcripts.
- `src/schema.sql`: the tables, indexes and constraints. The constraints are
  where the atomic guarantees come from.
- `foundry.application.ts`, `lib/db.ts` and `agents/assistant`: an app wired to them.

Read [Durability](https://glove.dterminal.net/foundry/docs/durability) for what
each method must guarantee and why, and
[Persistence](https://glove.dterminal.net/foundry/docs/persistence) for the setup.

## Run the tests

```bash
pnpm --filter glove-foundry-postgres-example test
```

The tests need a PostgreSQL server:

- **With `DATABASE_URL` set:** the tests create a fresh database on that server and drop it afterwards.
- **Otherwise:** they start a throwaway cluster with the local `initdb`/`pg_ctl` (as the `postgres` user when run as root).
- **With neither:** they skip.

What they check:

- **`tests/data-adapter.test.ts`, the adapter contract.**
  - Documents round-trip exactly, key order included.
  - Provisioning and every claim are atomic under concurrent connections.
  - Compare-and-set lets exactly one writer win.
  - Inbound claims complete and release correctly.
  - Occurrences and receipts filter and order as Foundry reads them.
  - Purging an archived worker is transactional.
  - The transcript store keeps order, counters and permissions.
- **`tests/runtime.test.ts`, a real Foundry runtime** whose controller and run processes all use PostgreSQL. It is restarted on the same database, and the agent, conversation, transcript, event journal and a due schedule occurrence all survive.

## Use it in your app

1. **Copy the files.** Take `src/` and `lib/db.ts`, and adjust the table names if you like.
2. **Create the tables at deploy time,** not in `foundry.application.ts`: run `migrate(pool)` from `src/postgres-data.ts`, or apply `src/schema.sql` with your migration tool.
3. **Give every Foundry process its own pool.** Set `DATABASE_URL` for the controller and for run processes; they inherit its environment. Each process builds its own pool from it.
4. **Size the database for those pools.** Allow `(1 + execution.maxConcurrent) × DATABASE_POOL_MAX` connections, plus anything else that connects.

Records are stored whole in `json` columns, exactly as Foundry wrote them, with the queried fields projected into columns beside them. Use `json` rather than `jsonb` for the document column: `jsonb` reorders keys. Foundry compares documents by value, but your own code shouldn't have to care.
