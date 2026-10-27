import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Displaymanager, Glove, MemoryStore, type ModelAdapter } from "glove-core";
import { chromium } from "playwright-core";
import { mountBrowser, mountSandbox } from "../src/index";
import { kuiperBrowser, kuiperSandbox, type KuiperBrowserRequest, type KuiperHandOff } from "../src/kuiper";

const gloveFor = (model?: Partial<ModelAdapter>) => new Glove({
  model: { name: "test", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 }; }, ...model } as ModelAdapter,
  store: new MemoryStore("kuiper-test"), displayManager: new Displaymanager(), systemPrompt: "test",
  compaction_config: { compaction_instructions: "preserve" },
}).build();

const kuiperError = (status: number, code: string) => Object.assign(new Error(code), { status, code });

// ── Sandboxes, against an in-memory stand-in for kuiper.sandboxes ───────────

function fakeSandboxes() {
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const make = (id: string, status: string) => ({
    id, status, image: "kuiper/coding", size: "small", expiresAt: new Date("2026-11-01T00:00:00Z"), releaseReason: null,
    async refresh() { return this; },
    async resume() { calls.push(`resume ${id}`); this.status = "live"; return this; },
    async release() { calls.push(`release ${id}`); this.status = "released"; return this; },
    async exec(cmd: string[], opts: { cwd?: string } = {}) {
      calls.push(`exec ${id} ${JSON.stringify(cmd)} cwd=${opts.cwd ?? ""}`);
      return { id: "run1", exitCode: 0, stdout: "v22.0.0\n", stderr: "", durationMs: 12, timedOut: false, truncated: false };
    },
    files: {
      async write(path: string, data: Uint8Array) { files.set(path, data); return { path, size: data.byteLength }; },
      async read(path: string) { const bytes = files.get(path); if (!bytes) throw kuiperError(404, "no_such_file"); return bytes; },
      async list() { return [...files.keys()].map((path) => ({ name: path.split("/").pop()!, path, type: "file", size: files.get(path)!.byteLength, mode: null, modifiedAt: null })); },
    },
  });
  const boxes = new Map<string, ReturnType<typeof make>>([["sb_sleeping", make("sb_sleeping", "hibernated")], ["sb_gone", make("sb_gone", "released")]]);
  let next = 0;
  let failCreate: Error | undefined;
  return {
    calls, files, boxes,
    failNextCreate(error: Error) { failCreate = error; },
    api: {
      async create() {
        if (failCreate) { const error = failCreate; failCreate = undefined; throw error; }
        const box = make(`sb_${++next}`, "live");
        boxes.set(box.id, box);
        return box;
      },
      async get(id: string) { const box = boxes.get(id); if (!box) throw kuiperError(404, "not_found"); return box; },
    },
  };
}

test("kuiperSandbox runs commands and files in a Kuiper sandbox, resuming a hibernated one first", async () => {
  const kuiper = fakeSandboxes();
  const made: string[] = [];
  const adapter = kuiperSandbox({ sandboxes: kuiper.api as never, sandboxIds: ["sb_sleeping"], maxSandboxes: 2, onCreate: (box) => void made.push(box.id) });
  const sandbox = mountSandbox(gloveFor(), { adapter });
  try {
    const result = await sandbox.session.execute(`
      const fresh = sandbox.create({});
      const run = sandbox.exec({ id: fresh.id, command: "node --version", cwd: "app" });
      sandbox.writeText({ id: fresh.id, path: "notes/plan.md", text: "# Plan" });
      const read = sandbox.readFile({ id: fresh.id, path: "notes/plan.md" });
      const again = sandbox.command({ id: fresh.id, runId: run.id });
      sandbox.exec({ id: "sb_sleeping", command: "ls" });
      ({ fresh: fresh.id, status: run.status, stdout: run.stdout, again: again.status, read: read.totalBytes })
    `);
    assert.deepEqual(result.value, { fresh: "sb_1", status: "succeeded", stdout: "v22.0.0\n", again: "succeeded", read: 6 });
    assert.deepEqual(made, ["sb_1"]);
    assert.ok(kuiper.files.has("/workspace/notes/plan.md"), "relative paths land in /workspace");
    assert.ok(kuiper.calls.includes('exec sb_1 ["sh","-lc","node --version"] cwd=/workspace/app'));
    // The hibernated sandbox came back before the command ran in it.
    assert.ok(kuiper.calls.indexOf("resume sb_sleeping") < kuiper.calls.findIndex((call) => call.startsWith("exec sb_sleeping")));
    assert.deepEqual(adapter.resourceIds().sort(), ["sb_1", "sb_sleeping"]);
  } finally {
    await sandbox.close();
  }
  // Retained by default: closing the scope releases nothing.
  assert.equal(kuiper.calls.some((call) => call.startsWith("release")), false);
});

test("kuiperSandbox keeps to its grants and fences an uncertain create", async () => {
  const kuiper = fakeSandboxes();
  const adapter = kuiperSandbox({ sandboxes: kuiper.api as never, sandboxIds: ["sb_gone"] });
  const op = (name: string) => adapter.operations.find((operation) => operation.name === name)!;
  const foreign = await op("exec").execute({ id: "sb_other", command: "ls" });
  assert.equal(foreign.error?.code, "forbidden");
  const ended = await op("exec").execute({ id: "sb_gone", command: "ls" });
  assert.equal(ended.error?.code, "ended");
  // A refusal from the gateway is definitive: nothing was made.
  kuiper.failNextCreate(kuiperError(402, "budget_exceeded"));
  assert.equal((await op("create").execute({})).error?.code, "budget_exceeded");
  assert.equal(adapter.uncertainCreations(), 0);
  // No answer at all may have made one: no more creates until the host reconciles.
  kuiper.failNextCreate(kuiperError(0, "network_error"));
  assert.equal((await op("create").execute({})).error?.outcome, "unknown");
  assert.equal(adapter.uncertainCreations(), 1);
  assert.equal((await op("create").execute({})).error?.code, "unresolved_sandboxes");
  await assert.rejects(adapter.close());
});

// ── Browsers: grants and admission, no browser needed ───────────────────────

test("kuiperBrowser keeps to its grants, its capacity and its uncertain openings", async () => {
  const sessions = new Map<string, any>([["s_ended", { id: "s_ended", status: "released", releaseReason: "timeout" }]]);
  let fail: Error | undefined;
  const browsers = {
    async create() { if (fail) throw fail; throw new Error("not reached"); },
    async get(id: string) { const session = sessions.get(id); if (!session) throw kuiperError(404, "not_found"); return session; },
  };
  const connect = async () => { throw new Error("no browser in this test"); };
  const scoped = (options: Partial<Parameters<typeof kuiperBrowser>[0]> = {}) => kuiperBrowser({ browsers: browsers as never, connect, ...options });
  const op = (adapter: ReturnType<typeof kuiperBrowser>, name: string) => adapter.operations.find((operation) => operation.name === name)!;

  const plain = scoped();
  assert.deepEqual(plain.operations.map((operation) => operation.name), ["open", "sessions", "navigate", "back", "observe", "interact", "screenshot", "close"]);
  assert.equal((await op(plain, "navigate").execute({ sessionId: "s_other", url: "https://example.com" })).error?.code, "forbidden");
  assert.equal((await op(plain, "navigate").execute({ sessionId: "s_other", url: "file:///etc/passwd" })).error?.code, "invalid_input");

  const full = scoped({ onHandOff() {}, allowEvaluate: true });
  assert.ok(["handOff", "evaluate"].every((name) => full.operations.some((operation) => operation.name === name)));

  // A granted session that ended is dropped, and says why.
  const granted = scoped({ sessionIds: ["s_ended"] });
  const ended = await op(granted, "observe").execute({ sessionId: "s_ended" });
  assert.equal(ended.error?.code, "ended");
  assert.match(ended.error?.message ?? "", /timeout/);
  assert.deepEqual(granted.resourceIds(), []);

  // One browser per scope by default.
  const full1 = scoped({ sessionIds: ["s_live"] });
  assert.equal((await op(full1, "open").execute({})).error?.code, "capacity");

  // A refusal is definitive; no answer is not.
  const opener = scoped();
  fail = kuiperError(429, "too_many_sessions");
  assert.equal((await op(opener, "open").execute({})).error?.code, "too_many_sessions");
  assert.equal(opener.uncertainCreations(), 0);
  fail = kuiperError(0, "network_error");
  assert.equal((await op(opener, "open").execute({})).error?.outcome, "unknown");
  assert.equal((await op(opener, "open").execute({})).error?.code, "uncertain");
  await assert.rejects(opener.close(), /unknown outcome/);
});

// ── Browsers: a real Chromium over CDP, standing in for a Kuiper session ─────

test("kuiperBrowser drives a real browser over CDP, guards its requests, hands it off and keeps it for the next run", { skip: process.env.GLOVE_BROWSER_INTEGRATION !== "1" }, async () => {
  const site = createServer((request, response) => {
    const host = request.headers.host ?? "";
    response.setHeader("content-type", "text/html");
    if (host === "shop.example" && request.method === "POST") return void response.end("<title>Booked</title><p>Booked: BL-2041</p>");
    if (host === "shop.example") return void response.end('<title>Shop</title><form method="post" action="/book"><label>Name<input name="name"></label><button>Book</button></form>');
    response.end("<title>Elsewhere</title><p>elsewhere</p>");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const port = (site.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), "glove-kuiper-"));
  // Every *.example host reaches the local site through it as a proxy.
  const chrome = await chromium.launchPersistentContext(dir, {
    headless: true, executablePath: process.env.GLOVE_BROWSER_EXECUTABLE,
    args: ["--remote-debugging-port=0", `--proxy-server=http://127.0.0.1:${port}`],
  });
  const [devtoolsPort, devtoolsPath] = (await readFile(join(dir, "DevToolsActivePort"), "utf8")).trim().split("\n");
  const calls: string[] = [];
  const session = {
    id: "s_1", status: "live", releaseReason: null, profileId: "p_1",
    websocketUrl: `ws://127.0.0.1:${devtoolsPort}${devtoolsPath}`,
    debugUrl: "https://gateway.example/browsers/live/s_1?token=view",
    interactiveDebugUrl: "https://gateway.example/browsers/live/s_1?token=control",
    async refresh() { return this; },
    async release() { calls.push("release"); this.status = "released"; return this; },
    async hibernate() { calls.push("hibernate"); this.status = "hibernated"; return this; },
  };
  const browsers = { async create(options: unknown) { calls.push(`create ${JSON.stringify(options)}`); return session; }, async get() { return session; } };
  const seen: KuiperBrowserRequest[] = [];
  const handOffs: KuiperHandOff[] = [];
  const guard = (request: KuiperBrowserRequest) => {
    seen.push(request);
    if (request.url.host === "blocked.example") return false;
    return request.method === "GET";
  };
  let sawImage = false;
  const glove = gloveFor({ async prompt(request) {
    sawImage = request.messages.some((message) => message.content?.some((part) => part.type === "image"));
    return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 };
  } });
  try {
    const first = mountBrowser(glove, { adapter: kuiperBrowser({
      browsers: browsers as never, session: { persistProfile: true }, cleanup: "keep", guard,
      onHandOff: (handOff) => void handOffs.push(handOff), onOpen: (opened) => void calls.push(`opened ${opened.id}`),
    }) });
    try {
      const result = await first.session.execute(`
        const b = browser.open({});
        const shop = browser.navigate({ sessionId: b.id, url: "http://shop.example/" });
        const tree = browser.observe({ sessionId: b.id });
        let blocked;
        try { browser.navigate({ sessionId: b.id, url: "http://blocked.example/c?email=rosa@example.com" }); } catch (error) { blocked = String(error.message); }
        browser.navigate({ sessionId: b.id, url: "http://shop.example/" });
        browser.interact({ sessionId: b.id, command: { op: "fill", target: { by: "label", value: "Name" }, value: "Rosa" } });
        const posted = browser.interact({ sessionId: b.id, command: { op: "click", target: { by: "role", role: "button", name: "Book" } } });
        browser.back({ sessionId: b.id });
        browser.screenshot({ sessionId: b.id });
        browser.handOff({ sessionId: b.id, reason: "Sign in to the shop" });
        let refused;
        try { browser.navigate({ sessionId: b.id, url: "http://shop.example/" }); } catch (error) { refused = String(error.message); }
        ({ id: b.id, status: shop.status, tree: tree.content, blocked, posted: posted.blocked, refused })
      `);
      const value = result.value as Record<string, any>;
      assert.equal(value.id, "s_1");
      assert.equal(value.status, 200);
      assert.match(value.tree, /textbox "Name"/);
      assert.match(value.blocked, /^blocked: Blocked by the host network policy: blocked\.example\/c/);
      // The form's POST never left: the guard said no, and the result says so.
      assert.deepEqual(value.posted, [{ method: "POST", target: "shop.example/book" }]);
      assert.match(value.refused, /^handed_off/);
      assert.ok(seen.some((request) => request.navigation && request.method === "POST"));
      assert.deepEqual(handOffs.map((handOff) => [handOff.reason, handOff.url, handOff.page.url]), [["Sign in to the shop", session.interactiveDebugUrl, "http://shop.example/"]]);
      assert.deepEqual(calls.slice(0, 2), ['create {"persistProfile":true}', "opened s_1"]);
      await glove.processRequest("Look at the screenshot");
      assert.equal(sawImage, true);
    } finally {
      await first.close();
    }
    // Kept: the browser is still there, on the same page.
    assert.equal(calls.includes("release"), false);
    assert.deepEqual(chrome.pages().map((page) => page.url()), ["http://shop.example/"]);

    // The next run is granted the same session and picks up where it was.
    const second = kuiperBrowser({ browsers: browsers as never, sessionIds: ["s_1"] });
    const observed = await second.operations.find((operation) => operation.name === "observe")!.execute({ sessionId: "s_1" });
    assert.match(String((observed.data as { content: string }).content), /textbox "Name"/);
    await second.close();
    assert.ok(calls.includes("release"));
  } finally {
    await chrome.close();
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => site.close((error) => error ? reject(error) : resolve()));
  }
});
