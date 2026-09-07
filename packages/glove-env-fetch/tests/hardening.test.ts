import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { secretRef } from "glove-env-secret";
import { fetchFiles, type FetchResult } from "../src/index";
import { createPolicy } from "../src/policy";

test("invalid domain rules fail closed; IDNA and IPv6 are normalized", async () => {
  for (const rule of ["example.com/path", "example.com?x", "example.com#x", "user@example.com", "example.com:443", "example.com..", "*.127.0.0.1", "*", "example.com\\evil"]) {
    assert.throws(() => createPolicy({ blockedDomains: [rule] }), /rule|hostname/);
  }
  const policy = createPolicy({ allowedDomains: ["bücher.example", "[::1]"], privateNetworkOrigins: ["http://[::1]"] });
  await policy("https://xn--bcher-kva.example", "GET");
  await policy("http://[0:0:0:0:0:0:0:1]", "GET");
  await assert.rejects(createPolicy({ authorize: async () => { throw new Error("private-provider-detail"); } })("https://example.com", "GET"), /blocked/);
});

for (const phase of ["policy", "credentials"] as const) {
  test(`timeout includes ${phase} resolution; a late callback never sends a request`, async () => {
    let resolve!: (value: any) => void;
    let calls = 0;
    const pending = new Promise<any>(done => { resolve = done; });
    const t = await createAdapterTestEnv(fetchFiles({ timeoutMs: 20,
      ...(phase === "policy" ? { authorize: () => pending } : {
        secretStore: { get: () => pending },
        credentials: { token: { origins: ["https://example.com"], headers: { Authorization: { ref: secretRef("token") } } } },
      }),
      fetch: async () => { calls++; return new Response("unexpected"); },
    }));
    try {
      const run = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
        return request('https://example.com', { output: '/tmp/late', ${phase === "credentials" ? "credential: 'token'" : ""} }); }`);
      assert.equal(run.ok, false); assert.match(String(run.error), /timed out/);
      resolve(phase === "policy" ? true : "late-secret");
      await new Promise<void>(done => setImmediate(done));
      assert.equal(calls, 0); assert.equal(await t.fs.exists("/tmp/late"), false);
    } finally { await t.env.close(); }
  });
}

test("host cancellation stops requests even when a custom transport ignores abort", async () => {
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  const t = await createAdapterTestEnv(fetchFiles({ signal: controller.signal, fetch: async () => {
    setImmediate(() => controller.abort());
    return new Promise<Response>(resolve => { finish = resolve; });
  } }));
  try {
    const run = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
      return request('https://example.com', { output: '/tmp/cancelled' }); }`);
    assert.equal(run.ok, false); assert.match(String(run.error), /aborted by the host/);
    finish(new Response("late"));
    await new Promise<void>(done => setImmediate(done));
    assert.equal(await t.fs.exists("/tmp/cancelled"), false);
  } finally { await t.env.close(); }
});

test("form and multipart bodies round-trip repeated fields and binary VFS files", async () => {
  const t = await createAdapterTestEnv(fetchFiles({ fetch: async (_url, init) => {
    const parsed = await new Response(init.body, { headers: init.headers }).formData();
    const file = parsed.get("attachment") as File | null;
    return Response.json({ tags: parsed.getAll("tag"), file: file && {
      name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())],
    } });
  } }));
  try {
    await t.fs.writeFile("/out/source.bin", new Uint8Array([0, 255, 128]));
    const result = await t.script<FetchResult[]>(`import { request } from 'env:fetch'; export default async function main() {
      return [await request('https://example.com', { method: 'POST', form: { tag: ['hello world', 'a&b'] } }),
        await request('https://example.com', { method: 'POST', multipart: [
          { name: 'tag', value: 'one' }, { name: 'tag', value: 'two' },
          { name: 'attachment', path: '/out/source.bin', filename: 'statement.bin' }
        ] })]; }`);
    assert.deepEqual(JSON.parse(await t.fs.readFile(result[0].path)), { tags: ["hello world", "a&b"], file: null });
    assert.deepEqual(JSON.parse(await t.fs.readFile(result[1].path)), { tags: ["one", "two"], file: {
      name: "statement.bin", type: "application/octet-stream", bytes: [0, 255, 128],
    } });
  } finally { await t.env.close(); }
});

test("manual/error redirects and custom methods retain their HTTP semantics", async () => {
  const methods: string[] = [];
  const t = await createAdapterTestEnv(fetchFiles({ responseHeaders: ["location"], fetch: async (_url, init) => {
    methods.push(init.method!);
    return new Response("redirect body", { status: 302, headers: { location: "/next" } });
  } }));
  try {
    const result = await t.script<FetchResult>(`import { request } from 'env:fetch'; export default async function main() {
      return request('https://example.com', { method: 'Custom2', redirect: 'manual' }); }`);
    assert.equal(result.status, 302); assert.equal(result.headers.location, "/next");
    assert.equal(await t.fs.readFile(result.path), "redirect body"); assert.deepEqual(methods, ["Custom2"]);
    const error = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
      return request('https://example.com', { redirect: 'error', output: '/tmp/no' }); }`);
    assert.equal(error.ok, false); assert.match(String(error.error), /redirect refused/);
    assert.equal(await t.fs.exists("/tmp/no"), false);
  } finally { await t.env.close(); }
});

test("concurrent requests cannot race over the same output path", async () => {
  let calls = 0;
  const adapter = fetchFiles({ fetch: async () => { calls++; return new Response("winner"); } });
  const t = await createAdapterTestEnv(adapter);
  try {
    // Worker RPC serializes host calls. Exercise actual overlapping calls to
    // the public adapter bindings against the same guarded filesystem.
    const bindings = adapter.create(t.fs);
    const results = await Promise.allSettled([
      bindings.request("https://example.com", { output: "/tmp/same", overwrite: true }),
      bindings.request("https://example.com", { output: "/tmp/same", overwrite: true }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(calls, 1); assert.equal(await t.fs.readFile("/tmp/same"), "winner");
  } finally { await t.env.close(); }
});

test("malformed inputs and multipart encoding overhead cannot bypass upload limits", async () => {
  let calls = 0;
  const t = await createAdapterTestEnv(fetchFiles({ maxUploadBytes: 10, fetch: async () => { calls++; return new Response("bad"); } }));
  try {
    for (const options of [null, [], { method: "TRACE" }, { overwrite: "false" }, { redirect: "anything" },
      { timeoutMs: 0 }, { headers: [] }, { method: "POST", form: { a: 42 } },
      { method: "POST", multipart: [{ name: "field", value: "ok" }] },
      { method: "POST", multipart: [{ name: "field", path: "/missing", value: "x" }] },
    ]) {
      const run = await t.runScript(`import { request } from 'env:fetch'; export default async function main() {
        return request('https://example.com', ${JSON.stringify(options)}); }`);
      assert.equal(run.ok, false);
    }
    assert.equal(calls, 0);
  } finally { await t.env.close(); }
});
