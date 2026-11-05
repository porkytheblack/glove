/**
 * A real Foundry runtime on PostgreSQL: the controller and every run's child
 * process build their own adapter and pool from DATABASE_URL. What one
 * runtime wrote, a second runtime on the same database picks up.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { Effect } from "effect";
import pg from "pg";
import { activationScheduleRevision, defineApplication, discoverAgents, FoundryRuntime, type FoundryActivationRecord } from "glove-foundry";
import { startDatabase } from "./database.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = await startDatabase();
if (database) process.env.DATABASE_URL = database.url;
const pools: pg.Pool[] = [];
after(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await database?.stop();
});

async function eventually<T>(read: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value as T;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

test("runtime data, transcripts, the event journal and schedule occurrences survive a restart on PostgreSQL",
  { skip: database ? false : "PostgreSQL is not available: set DATABASE_URL or install initdb", timeout: 180_000 }, async () => {
    const { migrate, PostgresFoundryDataAdapter } = await import("../src/postgres-data.js");
    const { PostgresStore } = await import("../src/postgres-store.js");
    const pool = new pg.Pool({ connectionString: database!.url });
    pools.push(pool);
    await migrate(pool);
    const agents = await discoverAgents({ agentsDir: resolve(root, "agents") });
    // Each runtime gets a fresh adapter and pool, as a restarted host would;
    // run children load foundry.application.ts and build their own.
    const start = async () => {
      const own = new pg.Pool({ connectionString: database!.url });
      pools.push(own);
      const data = new PostgresFoundryDataAdapter({ pool: own });
      const runtime = new FoundryRuntime({
        rootDir: root, agents,
        application: defineApplication({ name: "Foundry on PostgreSQL", data }),
        applicationFilePath: resolve(root, "foundry.application.ts"),
        config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
      });
      await runtime.start();
      return { runtime, data };
    };

    const first = await start();
    const agent = await first.runtime.createAgent("assistant", { id: "agent_pg", workspaceId: "acme" });
    const conversation = await first.runtime.createConversation(agent.id, { id: "conversation_pg" });
    const run = await first.runtime.request("assistant", { agentId: agent.id, conversationId: conversation.id, workspaceId: "acme", message: "hello from the first runtime" });
    assert.equal((await first.runtime.waitForRun(run.id, { timeoutMs: 30_000 }))?.status, "completed");

    await first.runtime.emitEvent({ agentId: agent.id, conversationId: conversation.id },
      { id: "notice_1", source: "acme:notices", content: "a durable notice" }, { whenIdle: "wake" });
    await eventually(async () => (await Effect.runPromise(first.data.listEvents())).find((record) => record.event.id === "notice_1")?.status === "acknowledged", "the event acknowledgement");

    // An hourly schedule whose cursor is already due: it fires on this runtime.
    const due = new Date(Date.now() - 60_000).toISOString();
    const base = {
      id: "activation_pg", kind: "scheduled" as const, definitionId: "assistant", agentId: agent.id, conversationId: conversation.id,
      workspaceId: "acme", message: "hourly check", timing: { kind: "every" as const, intervalMs: 3_600_000 }, origin: "agent-tool" as const,
      status: "active" as const, createdByRunId: "run_setup", createdAt: due, updatedAt: due,
    };
    const activation: FoundryActivationRecord = { ...base, scheduleRevision: activationScheduleRevision(base), nextOccurrenceAt: due };
    await Effect.runPromise(first.data.putActivation(activation));
    await first.runtime.stop();

    const second = await start();
    const [occurrence] = await eventually(async () => {
      const items = await second.runtime.listScheduleOccurrences({ activationId: "activation_pg" });
      return items[0]?.status === "completed" ? items : undefined;
    }, "the due occurrence");
    assert.equal(occurrence!.scheduledFor, due, "the original scheduled time");
    assert.ok(Date.parse((await Effect.runPromise(second.data.getActivation("activation_pg")))!.nextOccurrenceAt!) > Date.now());

    assert.equal((await Effect.runPromise(second.data.getAgent(agent.id)))?.workspaceId, "acme");
    const again = await second.runtime.request("assistant", { agentId: agent.id, conversationId: conversation.id, workspaceId: "acme", message: "hello from the second runtime" });
    assert.equal((await second.runtime.waitForRun(again.id, { timeoutMs: 30_000 }))?.status, "completed");
    const transcript = (await new PostgresStore(pool, conversation.id).getMessages()).map((message) => message.text);
    assert.ok(transcript.includes("hello from the first runtime"), "the first runtime's turn is still there");
    assert.ok(transcript.includes("hello from the second runtime"));
    assert.ok(transcript.some((text) => /a durable notice/.test(text)), "the event reached the transcript");
    assert.ok(transcript.some((text) => /hourly check/.test(text)), "the occurrence's run wrote to the same transcript");
    await second.runtime.stop();
  });
