import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter, type PromptRequest } from "glove-core";
import { HostSandboxAdapter } from "station-sandbox";
import { stationBrowser, stationLocalSandbox, stationSandbox } from "../src/station";
import { createSandboxAdapter, ExecutionError, mountBrowser, mountSandbox } from "../src/index";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function model(seen: PromptRequest[] = []): ModelAdapter {
  return { name: "test", setSystemPrompt() {}, async prompt(request) { seen.push(request); return { messages: [{ sender: "agent", text: "done" }], tokens_in: 0, tokens_out: 0 }; } };
}
function agent(adapter = model()) { return new Glove({ model: adapter, store: new MemoryStore("execution-test"), displayManager: new Displaymanager(), systemPrompt: "test", compaction_config: { compaction_instructions: "preserve" } }).build(); }

test("browser script composes open, inspection, action, verification and close in one call", async () => {
  const calls: Record<string, unknown>[] = [];
  const adapter = stationBrowser({ client: { async request<T>(body: Record<string, unknown>) {
    calls.push(body);
    return (body.method === "open" ? { id: "owned" } : body.method === "execute" ? { elements: [{ text: "ready" }] } : null) as T;
  } } });
  const mounted = mountBrowser(agent(), { adapter });
  const result = await mounted.session.execute(`
    const page = browser.open({});
    browser.navigate({ sessionId: page.id, url: "https://example.com" });
    const view = browser.observe({ sessionId: page.id });
    if (view.elements[0].text === "ready") browser.interact({ sessionId: page.id, command: { op: "click", target: { by: "role", role: "button", name: "Submit" } } });
    const verified = browser.observe({ sessionId: page.id });
    browser.close({ sessionId: page.id });
    verified.elements[0].text;
  `);
  assert.equal(result.value, "ready");
  assert.equal(calls.length, 6);
  assert.deepEqual(mounted.resourceIds(), []);
  await mounted.close();
});

test("browser ownership, abort and human-control failures stop a script before subsequent effects", async () => {
  const calls: Record<string, unknown>[] = [];
  const { BrowserUseClientError } = await import("station-browser-use/client");
  const adapter = stationBrowser({ sessionIds: ["owned"], client: { async request<T>(body: Record<string, unknown>) {
    calls.push(body);
    if (body.method === "execute") throw new BrowserUseClientError("busy", "Human control is active.", 409);
    return null as T;
  } } });
  const mounted = mountBrowser(agent(), { adapter });
  await assert.rejects(mounted.session.execute('browser.observe({sessionId:"foreign"})'), /not owned/);
  assert.equal(calls.length, 0);
  await assert.rejects(mounted.session.execute('browser.observe({sessionId:"owned"}); browser.close({sessionId:"owned"})'), /Human control/);
  assert.equal(calls.length, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(mounted.session.execute('browser.close({sessionId:"owned"})', { signal: abort.signal }));
  assert.equal(calls.length, 1);
  await mounted.close();
});

test("browser mounts preserve model ownership and deliver images after tool results alongside memory", async () => {
  const seen: PromptRequest[] = [];
  const original = model();
  const glove = agent(original);
  glove.addContextProvider(() => "Pinned memory: keep working on the user's task.");
  const mounted = mountBrowser(glove, { adapter: stationBrowser({ sessionIds: ["owned"], client: { async request<T>(body: Record<string, unknown>) {
    return (body.action === "screenshot" ? { mimeType: "image/png", base64: png } : null) as T;
  } } }) });
  assert.equal(glove.model, original, "mount must not replace or wrap the model");
  // The owner can also change models after mounting without losing images.
  const replacement: ModelAdapter = { name: "replacement", setSystemPrompt() {}, async prompt(request) {
    seen.push({ ...request, messages: structuredClone(request.messages) });
    if (seen.length === 1) return { messages: [{ sender: "agent", text: "", tool_calls: [{
      id: "capture", tool_name: "execute_browser", input_args: { code: 'browser.screenshot({sessionId:"owned"})' },
    }] }], tokens_in: 1, tokens_out: 1 };
    return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
  } };
  glove.setModel(replacement);
  await glove.processRequest("Look at the page");
  assert.equal(seen.length, 2);
  const messages = seen[1].messages;
  assert.equal(messages.at(-1)?.content?.[1].source?.data, png);
  assert.ok(messages.at(-2)?.text?.startsWith("Pinned memory:"));
  assert.equal(messages.at(-3)?.tool_results?.[0].call_id, "capture");
  assert.ok(!JSON.stringify(messages.at(-3)).includes(png));
  assert.ok(!JSON.stringify(await glove.store.getMessages()).includes(png));
  assert.equal((await glove.getRuntimeContext()).length, 1, "successful iteration consumes the image only");
  await mounted.session.execute('browser.screenshot({sessionId:"owned"})');
  await mounted.close();
  assert.equal(glove.model, replacement);
  assert.equal((await glove.getRuntimeContext()).length, 1, "cleanup unregisters only the browser provider");
  await assert.rejects(mounted.session.execute('browser.screenshot({sessionId:"owned"})'), /closed/);
});

test("a failed model call retains its screenshot for retry", async () => {
  let fail = true;
  const seen: PromptRequest[] = [];
  const glove = agent({ name: "retry", setSystemPrompt() {}, async prompt(request) {
    seen.push({ ...request, messages: structuredClone(request.messages) });
    if (fail) throw new Error("provider unavailable");
    return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
  } });
  const mounted = mountBrowser(glove, { adapter: stationBrowser({ sessionIds: ["owned"], client: { async request<T>(body: Record<string, unknown>) {
    return (body.action === "screenshot" ? { mimeType: "image/png", base64: png } : null) as T;
  } } }) });
  await mounted.session.execute('browser.screenshot({sessionId:"owned"})');
  await assert.rejects(glove.processRequest("Look"), /provider unavailable/);
  fail = false;
  await glove.processRequest("Retry");
  assert.ok(seen.every(request => request.messages.at(-1)?.content?.[1].source?.data === png));
  assert.deepEqual(await glove.getRuntimeContext(), []);
  await mounted.close();
});

test("sandbox grants, concurrent capacity and unknown creates are enforced", async () => {
  let release!: (value: unknown) => void;
  const adapter = createSandboxAdapter({ maxSandboxes: 1, backend: {
    name: "test", methods: ["create", "get", "destroy"], async invoke(method) {
      if (method === "create") return new Promise(resolve => { release = resolve; });
      return null;
    },
  } });
  const op = (name: string) => adapter.operations.find(op => op.name === name)!;
  const pending = op("create").execute({});
  assert.equal((await op("create").execute({})).error?.code, "capacity");
  assert.equal((await op("get").execute({ id: "foreign" })).error?.code, "forbidden");
  release({ id: "mine" }); await pending;
  assert.deepEqual(adapter.resourceIds(), ["mine"]);
  await adapter.close();
  assert.equal((await op("get").execute({ id: "mine" })).error?.code, "closed");
  const unknown = createSandboxAdapter({ backend: { name: "test", methods: ["create"], async invoke() { throw new ExecutionError("timeout", "Timeout", "unknown"); } } });
  const create = unknown.operations.find(op => op.name === "create")!;
  assert.equal((await create.execute({})).error?.outcome, "unknown");
  assert.equal((await create.execute({})).error?.code, "unresolved_sandboxes");
  await assert.rejects(unknown.close(), /cleanup incomplete/);
});

test("real Station sandbox retains files across scopes and owns command lifecycle", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "glove-execution-test-"));
  const host = new HostSandboxAdapter({ rootDir });
  try {
    const adapter = await stationLocalSandbox(host);
    const mounted = mountSandbox(agent(), { adapter });
    const created = await mounted.session.execute('const box = sandbox.create({}); box.id;');
    const id = created.value as string;
    const command = await mounted.session.execute('sandbox.exec({ id: box.id, command: "printf hello > greeting.txt" });');
    const runId = (command.value as { id: string }).id;
    let run = await host.command(id, runId);
    for (let i = 0; !run.finishedAt && i < 100; i++) { await new Promise(resolve => setTimeout(resolve, 10)); run = await host.command(id, runId); }
    assert.equal(run.status, "completed");
    await mounted.close();
    const resumed = await stationLocalSandbox(host, { sandboxIds: [id] });
    const read = await resumed.operations.find(op => op.name === "readFile")!.execute({ id, path: "greeting.txt" });
    assert.equal(Buffer.from((read.data as { base64: string }).base64, "base64").toString(), "hello");
    await resumed.operations.find(op => op.name === "destroy")!.execute({ id });
    assert.deepEqual(await host.list(), []);
    await resumed.close();
  } finally { await host.close(); await rm(rootDir, { recursive: true, force: true }); }
});

test("remote sandbox pins worker, forwards abort and publishes only supported capabilities", async () => {
  const requests: unknown[] = [];
  const adapter = await stationSandbox({ stationId: "worker", client: {
    async executionStations() { return [{ stationId: "worker", name: "worker", available: true, capabilities: { sandbox: true, browser: false }, backends: { sandbox: "container" }, features: { sandbox: { files: true } } }]; },
    async execution<T>(...args: Parameters<import("station-client").StationClient["execution"]>) { requests.push(args); return { id: "mine" } as T; },
  } });
  assert.ok(!adapter.operations.some(op => op.name === "openTerminal"));
  const signal = new AbortController().signal;
  await adapter.operations.find(op => op.name === "create")!.execute({}, { signal });
  assert.deepEqual(requests[0], ["worker", "sandbox", { method: "create" }, signal]);
  await adapter.close();
});

test("page evaluation is an explicit grant and closes only after in-flight evaluation settles", async () => {
  let finish!: (value: unknown) => void;
  const calls: Record<string, unknown>[] = [];
  const client = { async request<T>(body: Record<string, unknown>) {
    calls.push(body);
    return (body.action === "evaluate" ? await new Promise<unknown>(resolve => { finish = resolve; }) : null) as T;
  } };
  assert.ok(!stationBrowser({ client }).operations.some(op => op.name === "evaluate"));
  const adapter = stationBrowser({ client, allowEvaluate: true, sessionIds: ["owned"] });
  const evaluate = adapter.operations.find(op => op.name === "evaluate")!;
  assert.equal((await evaluate.execute({ sessionId: "foreign", expression: "document.title" })).error?.code, "forbidden");
  const pending = evaluate.execute({ sessionId: "owned", expression: "document.title" });
  const closing = adapter.close();
  assert.equal((await evaluate.execute({ sessionId: "owned", expression: "document.title" })).error?.code, "closed");
  assert.equal(calls.length, 1);
  finish("Title");
  assert.equal((await pending).data, "Title");
  await closing;
  assert.deepEqual(calls[1], { method: "close", id: "owned" });
});

test("retained Station browser scopes settle work without closing sessions, but explicit close still works", async () => {
  const calls: Record<string, unknown>[] = [];
  const adapter = stationBrowser({ cleanup: "retain", sessionIds: ["personal"], client: { async request<T>(body: Record<string, unknown>) { calls.push(body); return null as T; } } });
  await adapter.close();
  assert.equal(calls.length, 0);
  assert.deepEqual(adapter.resourceIds(), ["personal"]);
  assert.equal((await adapter.operations.find(op => op.name === "observe")!.execute({ sessionId: "personal" })).error?.code, "closed");
  const next = stationBrowser({ cleanup: "retain", sessionIds: ["personal"], client: { async request<T>(body: Record<string, unknown>) { calls.push(body); return null as T; } } });
  assert.equal((await next.operations.find(op => op.name === "close")!.execute({ sessionId: "personal" })).status, "success");
  await next.close();
  assert.equal(calls.length, 1);
  assert.deepEqual(next.resourceIds(), []);
});

test("text writes encode Unicode without REPL globals and preserve scoped file grants", async () => {
  const writes: unknown[] = [];
  const adapter = createSandboxAdapter({ sandboxIds: ["owned"], backend: {
    name: "text-test", methods: ["writeFile"], async invoke(_method, input) { writes.push(input); return { written: true }; },
  } });
  const write = adapter.operations.find(op => op.name === "writeText")!;
  assert.equal((await write.execute({ id: "foreign", path: "server.mjs", text: "bad" })).error?.code, "forbidden");
  assert.equal(writes.length, 0);
  const text = "console.log('Hello, 世界 👋');\n";
  assert.equal((await write.execute({ id: "owned", path: "server.mjs", text })).status, "success");
  assert.equal(Buffer.from((writes[0] as { options: { base64: string } }).options.base64, "base64").toString("utf8"), text);
  await adapter.close();
  assert.equal((await write.execute({ id: "owned", path: "server.mjs", text })).error?.code, "closed");
});
