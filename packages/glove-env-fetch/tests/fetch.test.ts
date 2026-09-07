import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { createMemorySecretStore, secretRef } from "glove-env-secret";
import { fetchFiles, type FetchOptions, type FetchResult } from "../src/index";
import { createPolicy } from "../src/policy";

function stub(reply: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: NonNullable<FetchOptions["fetch"]> = async (url, init) => {
    calls.push({ url, init: { ...init, headers: new Headers(init.headers) } });
    return reply(url, init, calls.length);
  };
  return { calls, fetch };
}

test("downloads preserve binary content and expose the documented bindings", async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const http = stub(() => new Response(bytes, { headers: { "content-type": "application/pdf", "set-cookie": "private-session" } }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch }));
  try {
    assertAdapterOk(await t.audit());
    const result = await t.script<FetchResult>(`import { download } from 'env:fetch';
      export default async function main() { return download('https://files.example/report', '/inbox/report.pdf'); }`);
    assert.equal(result.status, 200); assert.equal(result.bytes, 256);
    assert.equal(result.contentType, "application/pdf");
    assert.deepEqual(await t.fs.readBytes(result.path), bytes);
    assert.ok(!JSON.stringify(result).includes("private-session"));
  } finally { await t.env.close(); }
});

test("curl-like JSON requests, HTTP error bodies, HEAD and file uploads", async () => {
  const http = stub((_url, init) => init.method === "HEAD"
    ? new Response(null, { headers: { "content-length": "99999999999" } })
    : new Response('{"message":"inspect me"}', { status: 422, headers: { "content-type": "application/json" } }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch }));
  try {
    const result = await t.script<FetchResult>(`import { request } from 'env:fetch';
      export default async function main() { return request('https://api.example/items', { method: 'PATCH', json: { active: true } }); }`);
    assert.equal(result.ok, false); assert.equal(result.status, 422);
    assert.deepEqual(JSON.parse(await t.fs.readFile(result.path)), { message: "inspect me" });
    assert.equal(new TextDecoder().decode(http.calls[0].init.body as Uint8Array), '{"active":true}');
    assert.equal(new Headers(http.calls[0].init.headers).get("content-type"), "application/json");
    await t.fs.writeFile("/out/data.bin", new Uint8Array([0, 255, 128]));
    const uploaded = await t.runScript(`import { upload } from 'env:fetch';
      export default async function main() { return upload('/out/data.bin', 'https://api.example/items', { method: 'POST' }); }`);
    assert.equal(uploaded.ok, false); // wrapper requires successful status
    assert.deepEqual(http.calls[1].init.body, new Uint8Array([0, 255, 128]));
    const head = await t.script<FetchResult>(`import { request } from 'env:fetch';
      export default async function main() { return request('https://api.example/items', { method: 'HEAD' }); }`);
    assert.equal(head.bytes, 0);
  } finally { await t.env.close(); }
});

test("allow/deny domain rules match boundaries, normalized hosts and redirect targets", async () => {
  const policy = createPolicy({ allowedDomains: ["example.com", "*.example.com"], blockedDomains: ["bad.example.com"] });
  assert.equal((await policy("https://EXAMPLE.COM./a", "GET")).hostname, "example.com");
  await policy("https://sub.example.com", "GET");
  for (const url of ["https://bad.example.com", "https://example.com.evil.test", "https://notexample.com", "file:///etc/passwd", "https://u:p@example.com"]) {
    await assert.rejects(policy(url, "GET"));
  }
  await assert.rejects(createPolicy({ allowedDomains: [] })("https://example.com", "GET"));
  await assert.rejects(createPolicy({ allowedOrigins: ["https://example.com"] })("http://example.com", "GET"));
  const http = stub(() => new Response(null, { status: 302, headers: { location: "https://blocked.test/file" } }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch, allowedDomains: ["example.com"] }));
  try {
    const run = await t.runScript(`import { download } from 'env:fetch';
      export default async function main() { return download('https://example.com', '/tmp/file'); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /blocked/);
    assert.equal(http.calls.length, 1); assert.equal(await t.fs.exists("/tmp/file"), false);
  } finally { await t.env.close(); }
});

test("host credentials resolve current secrets and never follow cross-origin redirects", async () => {
  const store = createMemorySecretStore({ bank: "first-token" });
  const http = stub((_url, _init, n) => n === 1
    ? new Response(null, { status: 302, headers: { location: "https://cdn.example/data" } }) : new Response("ok"));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch, secretStore: store,
    credentials: { bank: { origins: ["https://bank.example"], headers: { Authorization: { ref: secretRef("bank"), prefix: "Bearer " } } } },
  }));
  const source = `import { request } from 'env:fetch'; export default async function main() {
    return request('https://bank.example/statement', { credential: 'bank', headers: { 'X-Private': 'private' } }); }`;
  try {
    const result = await t.script<FetchResult>(source);
    assert.equal(new Headers(http.calls[0].init.headers).get("authorization"), "Bearer first-token");
    assert.equal([...new Headers(http.calls[1].init.headers)].length, 0);
    assert.ok(!JSON.stringify(result).includes("first-token"));
    await store.set("bank", "rotated-token");
    await t.script(source);
    assert.equal(new Headers(http.calls[2].init.headers).get("authorization"), "Bearer rotated-token");
    const rejected = await t.runScript(`import { request } from 'env:fetch';
      export default async function main() { return request('https://other.example', { credential: 'bank' }); }`);
    assert.equal(rejected.ok, false); assert.equal(http.calls.length, 3);
  } finally { await t.env.close(); }
});

test("307 redirects never replay uploaded bytes to another origin", async () => {
  const http = stub(() => new Response(null, { status: 307, headers: { location: "https://other.example" } }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch }));
  try {
    const run = await t.runScript(`import { request } from 'env:fetch';
      export default async function main() { return request('https://first.example', { method: 'POST', body: 'private data' }); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /across origins/); assert.equal(http.calls.length, 1);
  } finally { await t.env.close(); }
});

test("response limits count streamed bytes, cancel expansion and leave no partial file", async () => {
  let cancelled = false;
  const http = stub(() => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "1" } }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch, maxResponseBytes: 20 }));
  try {
    const run = await t.runScript(`import { download } from 'env:fetch';
      export default async function main() { return download('https://example.com', '/tmp/large'); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /size limit/);
    assert.equal(cancelled, true); assert.equal(await t.fs.exists("/tmp/large"), false);
  } finally { await t.env.close(); }
});

test("validation, missing uploads, existing outputs and invalid body options perform no request", async () => {
  const http = stub(() => new Response("ok"));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch }));
  try {
    const top = await t.runScript(`import { request } from 'env:fetch'; const x = await request('https://example.com');
      export default function main() { return x; }`);
    assert.equal(top.ok, false);
    await t.fs.writeFile("/tmp/existing", "keep");
    for (const options of [{ bodyPath: "/missing", method: "POST" }, { output: "/tmp/existing" }, { body: "x", json: {} }, { method: "GET", body: "x" }, { headers: { Host: "bad.example" } }]) {
      const run = await t.runScript(`import { request } from 'env:fetch';
        export default async function main() { return request('https://example.com', ${JSON.stringify(options)}); }`);
      assert.equal(run.ok, false);
    }
    assert.equal(http.calls.length, 0);
    assert.equal(await t.fs.readFile("/tmp/existing"), "keep");
  } finally { await t.env.close(); }
});

test("timeouts abort the transport and redact sensitive failure details", async () => {
  let signal: AbortSignal | undefined;
  const t = await createAdapterTestEnv(fetchFiles({ timeoutMs: 20, fetch: async (_url, init) => {
    signal = init.signal!;
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("token-in-backend-url")), { once: true }));
  } }));
  try {
    const run = await t.runScript(`import { request } from 'env:fetch';
      export default async function main() { return request('https://example.com?token=private'); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /timed out/);
    assert.equal(signal?.aborted, true);
    assert.ok(!JSON.stringify(run).includes("token-in-backend-url"));
  } finally { await t.env.close(); }
});

test("timeouts cancel stalled response streams and cannot write late results", async () => {
  let cancelled = false;
  const t = await createAdapterTestEnv(fetchFiles({ timeoutMs: 20, fetch: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })) }));
  try {
    const run = await t.runScript(`import { download } from 'env:fetch';
      export default async function main() { return download('https://example.com', '/tmp/stalled'); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /timed out/);
    assert.equal(cancelled, true); assert.equal(await t.fs.exists("/tmp/stalled"), false);
  } finally { await t.env.close(); }
});

test("303 follows as GET, custom policy observes both hops, and redirect loops stop", async () => {
  const methods: string[] = [];
  const http = stub((_url, _init, n) => n === 1
    ? new Response(null, { status: 303, headers: { location: "/result" } }) : new Response("done"));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch, authorize: (_url, method) => {
    methods.push(method); return true;
  } }));
  try {
    await t.script(`import { request } from 'env:fetch'; export default async function main() {
      return request('https://example.com/submit', { method: 'POST', body: 'form', headers: { Authorization: 'same-origin' } }); }`);
    assert.deepEqual(methods, ["POST", "GET"]);
    assert.equal(http.calls[1].init.body, undefined);
    assert.equal(new Headers(http.calls[1].init.headers).get("authorization"), "same-origin");
  } finally { await t.env.close(); }
  const loop = stub(() => new Response(null, { status: 302, headers: { location: "/again" } }));
  const bounded = await createAdapterTestEnv(fetchFiles({ fetch: loop.fetch, maxRedirects: 1 }));
  try {
    const run = await bounded.runScript(`import { request } from 'env:fetch';
      export default async function main() { return request('https://example.com', { output: '/tmp/loop' }); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /redirect limit/);
    assert.equal(loop.calls.length, 2); assert.equal(await bounded.fs.exists("/tmp/loop"), false);
  } finally { await bounded.env.close(); }
});

test("HTTP errors and VFS write guards preserve files; upload caps prevent sending", async () => {
  const http = stub((_url, _init, n) => new Response("remote-private-detail", { status: n === 1 ? 403 : 200 }));
  const t = await createAdapterTestEnv(fetchFiles({ fetch: http.fetch, maxUploadBytes: 2 }));
  try {
    await t.fs.writeFile("/tmp/existing", "keep");
    const failure = await t.runScript(`import { download } from 'env:fetch'; export default async function main() {
      return download('https://example.com', '/tmp/existing', { overwrite: true }); }`);
    assert.equal(failure.ok, false); assert.match(String(failure.error), /403/);
    assert.ok(!String(failure.error).includes("remote-private-detail"));
    assert.equal(await t.fs.readFile("/tmp/existing"), "keep");
    const protectedWrite = await t.runScript(`import { download } from 'env:fetch'; export default async function main() {
      return download('https://example.com', '/std/remote'); }`);
    assert.equal(protectedWrite.ok, false); assert.equal(await t.fs.exists("/std/remote"), false);
    const oversized = await t.runScript(`import { upload } from 'env:fetch'; export default async function main() {
      return upload('/tmp/existing', 'https://example.com'); }`);
    assert.equal(oversized.ok, false); assert.match(String(oversized.error), /upload limit/);
    assert.equal(http.calls.length, 2);
  } finally { await t.env.close(); }
});

test("native HTTP transport uploads VFS bytes and saves response bytes end to end", async () => {
  const server = createServer(async (req, res) => {
    if (req.url === "/gzip") {
      const compressed = gzipSync("x".repeat(1000));
      res.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": compressed.length });
      res.end(compressed);
      return;
    }
    if (req.url === "/truncated") {
      res.writeHead(200, { "Content-Length": 20 });
      res.write("partial");
      setImmediate(() => res.destroy());
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Request-Method", req.method ?? "");
    res.end(Buffer.concat(chunks));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const t = await createAdapterTestEnv(fetchFiles({ allowedOrigins: [url], privateNetworkOrigins: [url], responseHeaders: ["x-request-method"], maxResponseBytes: 64 }));
  try {
    const bytes = new Uint8Array([0, 128, 255, 10]);
    await t.fs.writeFile("/out/upload.bin", bytes);
    const result = await t.script<FetchResult>(`import { upload } from 'env:fetch';
      export default async function main({ url }) { return upload('/out/upload.bin', url, { method: 'POST' }); }`, { url });
    assert.equal(result.headers["x-request-method"], "POST");
    assert.deepEqual(await t.fs.readBytes(result.path), bytes);
    for (const path of ["gzip", "truncated"]) {
      const run = await t.runScript(`import { download } from 'env:fetch';
        export default async function main({ url }) { return download(url, '/tmp/failed'); }`, { url: `${url}/${path}` });
      assert.equal(run.ok, false);
      assert.match(String(run.error), path === "gzip" ? /size limit/ : /could not be read|transport failed/);
      assert.equal(await t.fs.exists("/tmp/failed"), false);
    }
  } finally {
    await t.env.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
