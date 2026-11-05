import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Durability",
  description:
    "What Foundry guarantees when a process dies, how it keeps those guarantees (journal first, claims, stable ids, at-least-once delivery), what you must make idempotent, and how to back it with PostgreSQL, Redis, MongoDB or DynamoDB.",
};

export default function DurabilityPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Durability</span>
      <h1>Durability</h1>
      <p className="blog-lede">
        Foundry is built so that a process can die at any moment (the controller, the execution
        daemon, a run) and nothing it accepted is lost or silently done twice. It gets there by
        writing what it owes before it acts, and by delivering again, under the same identity, anything
        it cannot prove finished. That only holds if the stores underneath are durable: in
        production that means a real database, not the in-memory or file adapters the examples use.
      </p>
      <p>
        This page covers what Foundry guarantees, how it keeps those guarantees, what your code
        must do in return, and what a database needs to provide. For configuring each store, see{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h2 id="model">The model</h2>
      <ol>
        <li>
          <strong>Journal first.</strong> Foundry records an obligation before it acts on it: an
          inbound event before its run is queued, a schedule occurrence before the schedule moves
          past it, a voice notice&apos;s receipt before the provider is asked. A crash leaves either
          nothing (so the cause fires again) or a stored obligation (so the restart delivers it).
        </li>
        <li>
          <strong>Claims decide races.</strong> Wherever two processes, retries or webhooks could do the
          same thing twice, the first atomic insert-if-absent wins and the rest see the existing
          record. These claims are the operations a database adapter must get exactly right.
        </li>
        <li>
          <strong>Stable identities.</strong> Every obligation has an id derived from what it is, not
          from when it ran: the same webhook event, schedule occurrence or late-chat effect has the
          same id on every retry.
        </li>
        <li>
          <strong>At least once.</strong> When Foundry cannot prove something finished, it delivers it
          again. A crash after a side effect but before its acknowledgement repeats the work, so
          side effects must be idempotent on those stable ids. Nothing in Foundry makes an
          arbitrary external effect exactly-once.
        </li>
        <li>
          <strong>Recover on startup.</strong> A starting controller reads the journal and finishes what
          was left: pending inbound events, delegated tasks, the event journal, approvals,
          schedule occurrences, then activations from their stored cursors.
        </li>
      </ol>

      <h2 id="what-is-durable">What is durable, and where</h2>
      <table>
        <thead><tr><th>State</th><th>Stored by</th><th>After a crash</th><th>Stable identity</th></tr></thead>
        <tbody>
          <tr><td>Agent instances, conversations, subscriptions, workspace entries, inbox, tasks</td><td>Data adapter</td><td>Kept.</td><td>Instance id; <code>provisioningKey</code> for provisioned instances</td></tr>
          <tr><td>Inbound events (webhooks, channels)</td><td>Data adapter: delivery claim, pending inbound record</td><td>A retried webhook is ignored; an event no run finished is delivered again at startup, in arrival order.</td><td>Delivery claim key (route, provider event id, agent)</td></tr>
          <tr><td>Addressed events (<code>emitEvent</code>, agent messages, durable-worker mail)</td><td>Data adapter: event journal</td><td>Pending events are delivered again; acknowledged ids stay for deduplication.</td><td>Journal id (<code>handled.id</code>), from target and event id</td></tr>
          <tr><td>Delegated tasks and their results</td><td>Data adapter: the task&apos;s conversation and pending inbound record</td><td>A task queued or running is started again; an undelivered result or question is delivered again.</td><td>Delegation id</td></tr>
          <tr><td>Approvals</td><td>Data adapter, with the event journal</td><td>Stay open (7 days by default); a later decision resumes the conversation at the waiting call.</td><td>Approval id</td></tr>
          <tr><td>Schedules and sleeps</td><td>Data adapter: activation with cursor, occurrence journal</td><td>Re-armed from the stored cursor; an occurrence that came due is delivered under its original id and time.</td><td><code>source.occurrenceId</code></td></tr>
          <tr><td>Voice-call notices</td><td>Data adapter: delivery receipts</td><td>Never told twice; an uncertain dispatch is held; a late-chat effect is retried.</td><td>Journal id, <code>effectId</code></td></tr>
          <tr><td>Transcripts</td><td>Your <code>StoreAdapter</code></td><td>Kept. A run that is replayed appends its turn again after what the interrupted attempt wrote.</td><td>Message ids where Foundry sets them</td></tr>
          <tr><td>Structured memory, goals, facts, forms</td><td>Memory adapters</td><td>Kept.</td><td>Your keys</td></tr>
          <tr><td>Agent files (VFS)</td><td>Environment persistence</td><td>The last saved snapshot; work since then is lost.</td><td>Owner scope</td></tr>
          <tr><td>The run queue, run status, live turns</td><td>Memory in the execution daemon</td><td>Lost. Work that a journal holds is delivered again; a direct API request must be sent again by its caller.</td><td>None</td></tr>
          <tr><td>Event history (<code>/api/events</code>)</td><td>Memory (or your observability adapter)</td><td>Lost by default.</td><td>None</td></tr>
        </tbody>
      </table>
      <p>
        An interrupted model turn is never resumed mid-instruction: the work is delivered again as a
        new run, which starts from the conversation as stored.
      </p>

      <h2 id="idempotency">What your code must make idempotent</h2>
      <p>
        Anything that leaves Foundry (a message sent, a card charged, a ticket filed) can happen
        twice when a crash lands between doing it and recording it. Key each effect on the id
        Foundry gives you, and let the receiving system refuse a repeat:
      </p>
      <table>
        <thead><tr><th>Work started by</th><th>Key the effect on</th><th>Where to read it</th></tr></thead>
        <tbody>
          <tr><td>A schedule or sleep</td><td><code>occurrenceId</code></td><td><code>context.request.source.occurrenceId</code> (and <code>scheduledFor</code>)</td></tr>
          <tr><td>An addressed event in your handler</td><td>The journal id</td><td><code>handled.id</code> in <code>context.onEvent</code></td></tr>
          <tr><td>An inbound webhook or channel event</td><td>The provider&apos;s event id</td><td><code>context.request.source.eventId</code></td></tr>
          <tr><td>A delegated task</td><td>The delegation id</td><td><code>context.delegation.id</code></td></tr>
          <tr><td>A voice notice&apos;s late-chat fallback</td><td><code>effectId</code></td><td>The <code>afterCall</code> context</td></tr>
        </tbody>
      </table>
      <p>
        Most providers accept an idempotency key (Stripe, most email and messaging APIs). Where one
        does not, record the effect yourself under that key before acting, or check for it first,
        in the same database.
      </p>

      <h2 id="crashes">What a crash does, step by step</h2>
      <table>
        <thead><tr><th>Killed while…</th><th>On restart</th></tr></thead>
        <tbody>
          <tr><td>a webhook was being accepted, before its claim</td><td>Nothing was recorded; the provider&apos;s retry is accepted.</td></tr>
          <tr><td>a run handling an inbound event was queued or running</td><td>The pending record survives, so the event is delivered again.</td></tr>
          <tr><td>a schedule had come due but its occurrence was not stored yet</td><td>The cursor did not move, so it comes due again: same id, same <code>scheduledFor</code>.</td></tr>
          <tr><td>an occurrence was stored but not yet handed to a run</td><td>Delivered at startup under its id.</td></tr>
          <tr><td>a run finished its side effect but its result was not recorded</td><td>Delivered again: the effect repeats unless it was idempotent.</td></tr>
          <tr><td>an approval was waiting</td><td>Still open; the decision resumes the conversation.</td></tr>
          <tr><td>a voice notice had been handed to the provider</td><td>Never told again; a missing transcript line is written once.</td></tr>
          <tr><td>a direct request (<code>runtime.request</code>, the API, WebChat) was running</td><td>Lost: the caller sends it again.</td></tr>
        </tbody>
      </table>
      <p>
        These guarantees assume an acknowledged write is durable. If your database can lose writes it
        already confirmed (an unflushed Redis append-only file, an asynchronous replica that takes
        over), a crash can undo a claim or a journal entry and the guarantee goes with it.
      </p>

      <h2 id="database-requirements">What the database must provide</h2>
      <ul>
        <li><strong>Durable acknowledged writes.</strong> When a write returns, it survives a crash of the database process and of the host.</li>
        <li><strong>Atomic insert-if-absent</strong> for claims, and a <strong>unique constraint</strong> for provisioning keys.</li>
        <li><strong>An atomic conditional update</strong> for workspace compare-and-set.</li>
        <li><strong>Multi-record atomicity</strong> (a transaction, or an idempotent sequence) for purging a worker&apos;s data.</li>
        <li><strong>Read-your-writes.</strong> Startup lists the journal; it must see everything already acknowledged, so read from the primary or with strong consistency.</li>
        <li><strong>Lossless documents.</strong> Foundry treats records as opaque JSON. Store them whole and hand them back unchanged; index only the fields the adapter queries.</li>
      </ul>

      <h3 id="atomic-operations">The atomic operations, by database</h3>
      <table>
        <thead><tr><th>Adapter method</th><th>PostgreSQL</th><th>Redis</th><th>MongoDB</th><th>DynamoDB</th></tr></thead>
        <tbody>
          <tr>
            <td><code>claimInboundDelivery</code>, <code>claimEvent</code>, <code>claimScheduleOccurrence</code>, <code>claimEventReceipt</code>: insert if absent, <code>true</code> only for the first caller</td>
            <td><code>insert … on conflict (id) do nothing</code>; won when a row was inserted</td>
            <td><code>SET key value NX</code>; won on <code>OK</code></td>
            <td><code>insertOne</code> on <code>_id</code>; a duplicate-key error (11000) means lost</td>
            <td><code>PutItem</code> with <code>attribute_not_exists(pk)</code>; <code>ConditionalCheckFailedException</code> means lost</td>
          </tr>
          <tr>
            <td><code>provisionAgent</code>: one instance per key; every caller gets the winner</td>
            <td>Unique index on the key; insert, and on conflict read the row by key</td>
            <td>A Lua script that checks the key index and writes both keys</td>
            <td>Unique index on <code>provisioningKey</code>; on a duplicate, find by key</td>
            <td><code>TransactWriteItems</code>: a key item with <code>attribute_not_exists</code> plus the agent item; on failure, read by key</td>
          </tr>
          <tr>
            <td><code>compareAndSetWorkspaceEntry</code>: replace only if <code>updatedAt</code> is still the one you read</td>
            <td><code>update … where updated_at = $expected</code>; insert-if-absent for <code>null</code></td>
            <td>A Lua script comparing the stored <code>updatedAt</code></td>
            <td><code>updateOne({"{ _id, updatedAt: expected }"})</code>; won when <code>matchedCount</code> is 1</td>
            <td><code>UpdateItem</code> with <code>updatedAt = :expected</code></td>
          </tr>
          <tr>
            <td><code>purgeAgentData</code>: every owned record or none</td>
            <td>One transaction</td>
            <td><code>MULTI</code>/<code>EXEC</code> or a Lua script</td>
            <td>A multi-document transaction (needs a replica set)</td>
            <td><code>TransactWriteItems</code> (100 items per call), or delete in an order that is safe to repeat</td>
          </tr>
          <tr>
            <td>Durable acknowledgement</td>
            <td>Default (<code>synchronous_commit = on</code>)</td>
            <td><code>appendonly yes</code>, <code>appendfsync always</code></td>
            <td><code>writeConcern: {"{ w: \"majority\", j: true }"}</code></td>
            <td>Durable by default</td>
          </tr>
          <tr>
            <td>Reads that see every acknowledged write</td>
            <td>Default, on the primary</td>
            <td>The primary</td>
            <td>Primary reads, <code>readConcern: &quot;majority&quot;</code></td>
            <td><code>ConsistentRead: true</code> on base-table queries (global secondary indexes are only eventually consistent)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="postgres">PostgreSQL (recommended)</h2>
      <p>
        PostgreSQL gives every guarantee above with its defaults, and every adapter method is a
        single statement except the purge. A complete, tested implementation of the data adapter and
        a transcript store is in{" "}
        <a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-postgres"><code>examples/foundry-postgres</code></a>.
        Its tests run the adapter contract against a real server, including concurrent claims from
        separate connections, and restart a real Foundry runtime on the same database. Every claim
        has the same shape:
      </p>
      <CodeBlock filename="src/postgres-data.ts" language="typescript" code={`/** Insert-if-absent: the obligation exists before the activation's cursor moves past it. */
claimScheduleOccurrence(occurrence: FoundryScheduleOccurrence) {
  return run(async () => {
    const result = await this.pool.query(
      \`insert into foundry_occurrences (id, activation_id, workspace_id, agent_id, status, scheduled_for, doc)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing\`,
      [occurrence.id, occurrence.activationId, occurrence.workspaceId, occurrence.agentId,
       occurrence.status, occurrence.scheduledFor, JSON.stringify(occurrence)]);
    return (result.rowCount ?? 0) > 0;
  });
}`} />
      <ul>
        <li>Store each record in a <code>json</code> column, which keeps the text as written, with the queried fields in their own columns. <code>jsonb</code> reorders keys; that is fine for an index, not for a document you hand back.</li>
        <li>The default isolation level (read committed) is enough: each method is one statement whose constraint decides the race.</li>
        <li>Create tables in a deploy step or migration, not when <code>foundry.application.ts</code> loads: that module loads in every run&apos;s process.</li>
        <li>Back it up like any production database (point-in-time recovery). A restore rewinds everything Foundry owes to that point.</li>
      </ul>

      <h2 id="redis">Redis</h2>
      <p>
        Redis can back the data adapter, but only when it is configured to keep what it acknowledges.
        With <code>appendfsync everysec</code> (the common default) a crash can lose about a
        second of confirmed writes: claims and journal entries included. Use{" "}
        <code>appendonly yes</code> with <code>appendfsync always</code>, and remember that
        replication is asynchronous, so a promoted replica can be missing the newest writes.
        Many teams keep the record of truth in PostgreSQL and use Redis only for caches.
      </p>
      <p>
        Keep one key per record (<code>foundry:event:&lt;id&gt;</code>, holding the JSON) and a set
        per listing (<code>foundry:events</code>), written together in <code>MULTI</code>/
        <code>EXEC</code>. Claims are <code>SET … NX</code>. Provisioning and compare-and-set need
        a script, so the check and the write happen together. These scripts were checked against a
        real server:
      </p>
      <CodeBlock filename="provision.lua" language="lua" code={`-- KEYS[1] = provisioning key index, KEYS[2] = the new agent's record key
-- ARGV[1] = the new agent id, ARGV[2] = the new agent document
local existing = redis.call('GET', KEYS[1])
if existing then return redis.call('GET', 'foundry:agent:' .. existing) end
if redis.call('EXISTS', KEYS[2]) == 1 then return redis.error_reply('agent id taken by another provisioning key') end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return ARGV[2]`} />
      <CodeBlock filename="compare-and-set.lua" language="lua" code={`-- KEYS[1] = workspace entry key
-- ARGV[1] = expected updatedAt ('' = must be absent), ARGV[2] = new updatedAt, ARGV[3] = new document
local current = redis.call('HGET', KEYS[1], 'updatedAt')
if ARGV[1] == '' then
  if current then return 0 end
elseif current ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[2], 'doc', ARGV[3])
return 1`} />
      <p>
        On Redis Cluster, every key one script touches must share a hash slot: wrap the common part in
        braces (<code>foundry:{"{agent}"}:…</code>).
      </p>

      <h2 id="mongodb">MongoDB</h2>
      <ul>
        <li>One collection per record kind, with the record id as <code>_id</code>. A claim is <code>insertOne</code>; a duplicate-key error (code 11000) means another caller won.</li>
        <li>A unique index on <code>provisioningKey</code> (sparse or partial, since most agents have none) makes provisioning atomic.</li>
        <li>Compare-and-set is <code>updateOne({"{ _id, updatedAt: expected }"}, {"{ $set: … }"})</code>; it won when <code>matchedCount</code> is 1.</li>
        <li>Write with <code>{"{ w: \"majority\", j: true }"}</code> and read from the primary. A purge in one transaction needs a replica set, which production deployments have anyway.</li>
        <li>Documents are limited to 16 MB: keep large VFS snapshots in object storage and store a reference.</li>
      </ul>
      <CodeBlock filename="mongo-claim.ts" language="typescript" code={`async function claim(collection: Collection, record: { id: string }): Promise<boolean> {
  try {
    await collection.insertOne({ _id: record.id, doc: record }, { writeConcern: { w: "majority", j: true } });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false; // someone else claimed it
    throw error;
  }
}`} />

      <h2 id="dynamodb">DynamoDB</h2>
      <ul>
        <li>Claims are <code>PutItem</code> with <code>ConditionExpression: &quot;attribute_not_exists(pk)&quot;</code>; a <code>ConditionalCheckFailedException</code> means another caller won.</li>
        <li>Compare-and-set is <code>UpdateItem</code> with <code>ConditionExpression: &quot;updatedAt = :expected&quot;</code>.</li>
        <li>Provisioning writes a key item (<code>pk = &quot;provisioning#&lt;key&gt;&quot;</code>) and the agent in one <code>TransactWriteItems</code>, conditioned on the key item not existing.</li>
        <li>Listings Foundry reads at startup (the event journal, pending inbound events, open occurrences) must see every acknowledged write. Model them as queries on the base table (one partition per kind, for instance) with <code>ConsistentRead: true</code>. Global secondary indexes are eventually consistent and can miss a write made a moment before a crash.</li>
        <li>Items are limited to 400 KB: store VFS snapshots, and very long records, in S3 with a reference.</li>
      </ul>

      <h2 id="single-host">SQLite and files</h2>
      <p>
        <code>FileFoundryDataAdapter</code> and the SQLite memory adapters are durable on one host
        (atomic rename and fsync, SQLite&apos;s write-ahead log) and are what the examples use, because
        they need no server. They suit development, demos and single-machine deployments with a
        persistent disk. They are not for several hosts, and the file adapter rewrites its whole
        state on every change, so it slows as state grows. See{" "}
        <Link href="/foundry/docs/persistence#single-host">Persistence</Link>.
      </p>

      <h2 id="processes">Processes and connections</h2>
      <ul>
        <li>
          Every run executes in its own process, which loads <code>foundry.application.ts</code> and
          the agent module again. Build the database client there, from configuration (an
          environment variable). Never pass a live connection or pool from the controller: each
          process opens its own.
        </li>
        <li>
          Size the database for it: the controller plus up to <code>execution.maxConcurrent</code>{" "}
          run processes, each with its own pool. Keep per-process pools small, and let idle
          connections close (<code>pg</code>&apos;s <code>allowExitOnIdle</code>) so a finished run&apos;s process can exit.
        </li>
        <li>
          Run one Foundry controller per data store. Two controllers on one store would each re-arm
          every schedule and replay every pending obligation. For availability, restart the
          controller (a supervisor, a container platform); it recovers from the store.
        </li>
      </ul>

      <h2 id="checklist">Production checklist</h2>
      <ul>
        <li>A database-backed data adapter with all the optional durability methods: event journal, pending inbound, approvals, schedule occurrences, delivery receipts, purge.</li>
        <li>A database-backed transcript <code>StoreAdapter</code>, with permissions if you use approvals.</li>
        <li>Durable memory adapters and VFS persistence if your agents use them.</li>
        <li>The database configured for durable acknowledged writes and read from the primary.</li>
        <li>Side effects keyed on the ids above.</li>
        <li>One controller per store, restarted automatically.</li>
        <li>Backups, and a restore you have tried.</li>
        <li>The adapter contract tests from <code>examples/foundry-postgres</code>, run against your adapter.</li>
        <li>A kill test: <code>kill -9</code> the controller while work is due or running, restart it, and check that nothing was lost and every repeat carried the same id.</li>
      </ul>
    </article>
  );
}
