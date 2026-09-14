import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectedMcpServerConnection } from "../src/connect.js";
import { recyclableMcpConnection, validateMcpRecyclePolicy } from "../src/recycle.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeConnection(
  id: number,
  closed: number[],
  call?: () => Promise<string>,
  emitters?: Map<number, () => Promise<void>>,
): ConnectedMcpServerConnection {
  const toolChangeHandlers = new Set<() => void | Promise<void>>();
  emitters?.set(id, async () => {
    await Promise.all([...toolChangeHandlers].map((handler) => handler()));
  });
  return {
    namespace: "fixture",
    capabilities: { resources: false, prompts: false },
    async listTools() { return [{ name: `tool_${id}`, inputSchema: { type: "object" } }]; },
    async callTool() {
      const text = call ? await call() : `call_${id}`;
      return { content: [{ type: "text", text }] };
    },
    async listResources() { return { resources: [] }; },
    async readResource() { return { contents: [] }; },
    async listPrompts() { return { prompts: [] }; },
    async getPrompt() { return { messages: [] }; },
    onToolsChanged(handler) {
      toolChangeHandlers.add(handler);
      return () => toolChangeHandlers.delete(handler);
    },
    async close() { closed.push(id); },
    raw: {} as never,
  };
}

test("idle recycling proactively closes and transparently reopens a connection", async () => {
  const closed: number[] = [];
  let opened = 1;
  let clock = 0;
  const connection = recyclableMcpConnection({
    initial: fakeConnection(1, closed),
    open: async () => fakeConnection(++opened, closed),
    idleTimeoutMs: 20,
    now: () => clock,
  });

  assert.deepEqual((await connection.listTools()).map((tool) => tool.name), ["tool_1"]);
  clock = 21;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(closed, [1]);
  assert.deepEqual((await connection.listTools()).map((tool) => tool.name), ["tool_2"]);
  await connection.close();
  assert.deepEqual(closed, [1, 2]);
});

test("maximum lifetime recycles lazily when a clock passes the deadline", async () => {
  const closed: number[] = [];
  let opened = 1;
  let clock = 0;
  const connection = recyclableMcpConnection({
    initial: fakeConnection(1, closed),
    open: async () => fakeConnection(++opened, closed),
    maxLifetimeMs: 1_000,
    now: () => clock,
  });

  clock = 1_001;
  assert.deepEqual((await connection.listTools()).map((tool) => tool.name), ["tool_2"]);
  assert.deepEqual(closed, [1]);
  await connection.close();
});

test("tool-list subscriptions follow a recycled stdio connection", async () => {
  const closed: number[] = [];
  const emitters = new Map<number, () => Promise<void>>();
  let opened = 1;
  let changes = 0;
  const connection = recyclableMcpConnection({
    initial: fakeConnection(1, closed, undefined, emitters),
    open: async () => fakeConnection(++opened, closed, undefined, emitters),
    idleTimeoutMs: 20,
  });
  connection.onToolsChanged?.(() => { changes += 1; });

  await emitters.get(1)?.();
  assert.equal(changes, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await connection.listTools();
  await emitters.get(2)?.();
  assert.equal(changes, 2);
  await connection.close();
});

test("an in-flight operation holds a lease across the idle deadline", async () => {
  const closed: number[] = [];
  const pending = deferred<string>();
  const connection = recyclableMcpConnection({
    initial: fakeConnection(1, closed, () => pending.promise),
    open: async () => fakeConnection(2, closed),
    idleTimeoutMs: 15,
  });

  const running = connection.callTool("wait", {});
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(closed, []);
  pending.resolve("done");
  await running;
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(closed, [1]);
  await connection.close();
});

test("close waits for an in-flight lease and permanently rejects new work", async () => {
  const closed: number[] = [];
  const pending = deferred<string>();
  const started = deferred<void>();
  const connection = recyclableMcpConnection({
    initial: fakeConnection(1, closed, () => {
      started.resolve(undefined);
      return pending.promise;
    }),
    open: async () => fakeConnection(2, closed),
  });

  const running = connection.callTool("wait", {});
  await started.promise;
  const closing = connection.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(closed, []);
  pending.resolve("done");
  await Promise.all([running, closing]);
  assert.deepEqual(closed, [1]);
  await assert.rejects(connection.listTools(), /connection is closed/i);
});

test("invalid recycle policy fails deterministically", () => {
  assert.throws(() => validateMcpRecyclePolicy({ idleTimeoutMs: -1 }), /idleTimeoutMs/);
  assert.throws(() => validateMcpRecyclePolicy({ maxLifetimeMs: 1.5 }), /maxLifetimeMs/);
});
