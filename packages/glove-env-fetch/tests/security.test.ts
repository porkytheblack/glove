import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { LookupAddress, LookupOptions } from "node:dns";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { createWorkingEnvironment } from "glove-working-environment";
import { fetchFiles, type NetworkPolicy } from "../src/index";
import { createPolicy } from "../src/policy";
import { createTransport, guardedLookup, isPublicAddress } from "../src/network";

test("default policy blocks internal, metadata and disguised IP literals before transport", async () => {
  let calls = 0;
  const t = await createAdapterTestEnv(fetchFiles({ fetch: async () => { calls++; return new Response("unexpected"); } }));
  try {
    for (const host of ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "0.0.0.0", "10.0.0.1",
      "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "168.63.129.16", "224.0.0.1",
      "192.0.2.1", "[::]", "[::1]", "[::ffff:127.0.0.1]", "[::ffff:a00:1]", "[fc00::1]", "[fe80::1]",
      "[64:ff9b::a00:1]", "[2002:7f00:1::]", "[2001:db8::1]", "[4000::1]"]) {
      const result = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
        return request(${JSON.stringify(`http://${host}/`)}); }`);
      assert.equal(result.ok, false, host);
      assert.match(String(result.error), /blocked/, host);
    }
    assert.equal(calls, 0);
    assert.equal(isPublicAddress("8.8.8.8"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  } finally { await t.env.close(); }
});

test("network configuration fails closed and private grants are exact origins, not domain grants", async () => {
  for (const key of ["allowedDomains", "blockedDomains", "allowedOrigins", "privateNetworkOrigins"]) {
    for (const value of [null, false, "example.com", [42]]) {
      assert.throws(() => createPolicy({ [key]: value } as NetworkPolicy), /array of strings/);
    }
  }
  assert.throws(() => createPolicy({ authorize: false } as unknown as NetworkPolicy), /function/);
  const policy = createPolicy({ allowedDomains: ["127.0.0.1"], privateNetworkOrigins: ["http://127.0.0.1:8000"] });
  await policy("http://127.0.0.1:8000/file", "GET");
  await assert.rejects(policy("http://127.0.0.1:8001", "GET"), /blocked/);
  await assert.rejects(policy("https://127.0.0.1:8000", "GET"), /blocked/);
  await assert.rejects(createPolicy({ allowedDomains: ["127.0.0.1"] })("http://127.0.0.1", "GET"), /blocked/);
  await assert.rejects(createPolicy({ privateNetworkOrigins: ["http://127.0.0.1"], blockedDomains: ["127.0.0.1"] })("http://127.0.0.1", "GET"), /blocked/);
});

function resolveWith(answers: LookupAddress[], options: LookupOptions = { all: true }) {
  return new Promise<string | LookupAddress[]>((resolve, reject) => {
    guardedLookup(false, async () => answers)("example.test", options, (error, result) => error ? reject(error) : resolve(result));
  });
}

test("socket DNS lookup rejects every unsafe answer and does not re-resolve validated addresses", async () => {
  const publicAddress = { address: "8.8.8.8", family: 4 };
  for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }],
    [publicAddress, { address: "::1", family: 6 }], [publicAddress, { address: "10.0.0.1", family: 4 }],
    [{ address: "8.8.8.8", family: 6 }], [{ address: "not-an-ip", family: 4 }]]) {
    await assert.rejects(resolveWith(addresses), /blocked/);
  }
  let resolutions = 0;
  const lookup = guardedLookup(false, async () => ++resolutions === 1 ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }]);
  const call = () => new Promise<unknown>((resolve, reject) => lookup("rebind.test", { all: true },
    (error, result) => error ? reject(error) : resolve(result)));
  assert.deepEqual(await call(), [publicAddress]);
  assert.equal(resolutions, 1, "the socket receives the checked answer without a second lookup");
  await assert.rejects(call(), /blocked/, "a new connection must check fresh DNS answers");
  assert.deepEqual(await resolveWith([publicAddress], { all: false, family: 4 }), "8.8.8.8");
});

test("native transport enforces DNS policy before a socket connects, including redirect targets", async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/redirect") res.writeHead(302, { location: `http://blocked.test:${port}/` });
    res.end("ok");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const allowed = `http://allowed.test:${port}`;
  const localAnswers = async () => [{ address: "127.0.0.1", family: 4 }];
  const blocked = createTransport(new Set(), localAnswers);
  const scoped = createTransport(new Set([allowed]), localAnswers);
  const t = await createAdapterTestEnv(fetchFiles({ privateNetworkOrigins: [allowed], fetch: scoped.fetch }));
  try {
    await assert.rejects(blocked.fetch(allowed, { redirect: "manual" }));
    assert.equal(hits, 0);
    const good = await t.script(`import { request } from 'env:fetch'; export default async function main({url}) { return request(url); }`, { url: allowed });
    assert.ok(good);
    assert.equal(hits, 1);
    const redirected = await t.runScript(`import { request } from 'env:fetch'; export default async function main({url}) {
      return request(url, { output: '/tmp/refused' }); }`, { url: `${allowed}/redirect` });
    assert.equal(redirected.ok, false);
    assert.equal(hits, 2, "the redirect target must not receive a connection");
    assert.equal(await t.fs.exists("/tmp/refused"), false);
  } finally {
    await t.env.close(); await blocked.close(); await scoped.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("native sockets can be cancelled and destroyed while DNS resolution is stalled", { timeout: 2000 }, async () => {
  const transport = createTransport(new Set(), () => new Promise(() => {}));
  const controller = new AbortController();
  // A mocked resolver has no live DNS handle; keep the test's abort timer referenced.
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(transport.fetch("http://stalled.test", { signal: controller.signal }));
  } finally { clearTimeout(timer); await transport.close(); }
});

test("TLS downgrades, plaintext credential defaults and routing/framing headers are refused", async () => {
  assert.throws(() => fetchFiles({ credentials: { api: { origins: ["http://example.com"], headers: { Authorization: "secret" } } } }), /prefer HTTPS/);
  assert.doesNotThrow(() => fetchFiles({ credentials: { api: { origins: ["http://example.com"], headers: { Authorization: "secret" }, allowInsecureHttp: true } } }));
  let calls = 0;
  const t = await createAdapterTestEnv(fetchFiles({ fetch: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: "http://example.com" } });
  } }));
  try {
    const run = await t.runScript(`import { request } from 'env:fetch'; export default async function main() { return request('https://example.com'); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /downgrade/); assert.equal(calls, 1);
    for (const headers of [{ Host: "internal" }, { "Proxy-Authorization": "secret" }, { "Content-Length": "0" },
      { "Transfer-Encoding": "chunked" }, { Upgrade: "websocket" }, { Connection: "X-Secret" }, { "X-Huge": "x".repeat(65537) }]) {
      const result = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
        return request('https://example.com', { headers: ${JSON.stringify(headers)} }); }`);
      assert.equal(result.ok, false);
    }
    assert.equal(calls, 1);
  } finally { await t.env.close(); }
});

test("concurrency limits reject excess work before contacting the transport", async () => {
  let release!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const adapter = fetchFiles({ maxConcurrentRequests: 1, fetch: async () => {
    entered(); return new Promise<Response>(resolve => { release = resolve; });
  } });
  const t = await createAdapterTestEnv(adapter);
  try {
    const bindings = adapter.create(t.fs);
    const first = bindings.request("https://example.com");
    await started;
    await assert.rejects(bindings.request("https://example.com"), /concurrent request limit/);
    release(new Response("ok"));
    await first;
  } finally { await t.env.close(); }
});

for (const end of ["cancel", "timeout", "close"] as const) {
  test(`run ${end} aborts an adapter request without a separately configured fetch signal`, async () => {
    let entered!: () => void;
    let sawAbort = false;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const env = await createWorkingEnvironment({ stdlib: [fetchFiles({ fetch: async (_url, init) => {
      entered();
      return new Promise<Response>(resolve => init.signal!.addEventListener("abort", () => {
        sawAbort = true; resolve(new Response("late"));
      }, { once: true }));
    } })] });
    try {
      await env.fs.writeFile("/scripts/request.js", `import { request } from 'env:fetch'; export default async function main() {
        return request('https://example.com', { output: '/tmp/late' }); }`);
      const controller = new AbortController();
      const running = env.runScript("/scripts/request.js", {}, end === "cancel" ? { signal: controller.signal } : end === "timeout" ? { timeoutMs: 200 } : {});
      await started;
      if (end === "cancel") controller.abort();
      if (end === "close") await env.close({ graceMs: 0 });
      const run = await running;
      assert.equal(run.ok, false);
      assert.equal(sawAbort, true, end);
      if (end !== "close") assert.equal(await env.fs.exists("/tmp/late"), false);
    } finally { await env.close({ graceMs: 0 }); }
  });
}
