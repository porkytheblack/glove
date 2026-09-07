/**
 * The toolkit is optional — base never calls it — but a provider author who
 * uses it inherits its bugs, so it is tested like anything else.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHttpClient, HttpError, type FetchLike } from "../src/http";

const noSleep = async () => {};

interface Stub {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit }>;
}

function stub(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>): Stub {
  const queue = [...responses];
  const calls: Stub["calls"] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json", ...(next.headers ?? {}) },
      });
    },
  };
}

function clientOf(s: Stub, extra = {}) {
  return createHttpClient({ baseUrl: "https://api.example.com/v1", fetch: s.fetch, sleep: noSleep, ...extra });
}

test("headers are resolved per request, so a refreshing token needs no rebuild", async () => {
  const s = stub([{ body: { ok: true } }, { body: { ok: true } }]);
  let n = 0;
  const client = clientOf(s, { headers: () => ({ Authorization: `Bearer t${++n}` }) });
  await client.request("GET", "/docs/1");
  await client.request("GET", "/docs/2");
  assert.equal((s.calls[0].init.headers as Record<string, string>).Authorization, "Bearer t1");
  assert.equal((s.calls[1].init.headers as Record<string, string>).Authorization, "Bearer t2");
});

test("a body makes it a JSON request; a query string is appended", async () => {
  const s = stub([{ body: {} }]);
  await clientOf(s).request("POST", "/docs", { title: "x" }, { draft: "true" });
  assert.equal(s.calls[0].url, "https://api.example.com/v1/docs?draft=true");
  assert.equal((s.calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(s.calls[0].init.body, JSON.stringify({ title: "x" }));
});

test("collect walks every page and stops when the cursor runs out", async () => {
  const s = stub([
    { body: { results: [1, 2], next: "a" } },
    { body: { results: [3, 4], next: "b" } },
    { body: { results: [5], next: null } },
  ]);
  const all = await clientOf(s).collect<number>("GET", "/docs", {
    items: (body) => body.results,
    next: (body) => body.next ?? undefined,
  });
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  assert.equal(s.calls[2].url, "https://api.example.com/v1/docs?cursor=b");
});

test("a limit stops early", async () => {
  const s = stub([{ body: { results: [1, 2, 3], next: "a" } }]);
  const all = await clientOf(s).collect<number>("GET", "/docs", {
    items: (b) => b.results,
    next: (b) => b.next ?? undefined,
    limit: 2,
  });
  assert.deepEqual(all, [1, 2]);
  assert.equal(s.calls.length, 1);
});

test("running past the page cap throws rather than returning a prefix", async () => {
  // A truncated result set is the failure that reads as a correct answer.
  const s = stub(Array.from({ length: 10 }, () => ({ body: { results: [1], next: "more" } })));
  await assert.rejects(
    () =>
      clientOf(s, { maxPages: 3 }).collect("GET", "/docs", {
        items: (b: any) => b.results,
        next: (b: any) => b.next ?? undefined,
      }),
    /Narrow it with a filter/,
  );
});

test("a POST-style list endpoint carries its cursor in the body", async () => {
  const s = stub([{ body: { rows: [1], cursor: "n" } }, { body: { rows: [2] } }]);
  await clientOf(s).collect("POST", "/query", {
    items: (b: any) => b.rows,
    next: (b: any) => b.cursor,
    body: { filter: "open" },
  });
  assert.deepEqual(JSON.parse(String(s.calls[1].init.body)), { filter: "open", cursor: "n" });
});

test("429 is retried, and Retry-After is what decides the wait", async () => {
  const s = stub([{ status: 429, body: { message: "slow down" }, headers: { "retry-after": "2" } }, { body: { ok: 1 } }]);
  const waits: number[] = [];
  const client = clientOf(s, { sleep: async (ms: number) => void waits.push(ms) });
  assert.deepEqual(await client.request("GET", "/docs/1"), { ok: 1 });
  assert.deepEqual(waits, [2000]);
});

test("a 5xx is retried; a 400 is not", async () => {
  const transient = stub([{ status: 503, body: { message: "later" } }, { body: { ok: 1 } }]);
  assert.deepEqual(await clientOf(transient).request("GET", "/x"), { ok: 1 });

  const permanent = stub([{ status: 400, body: { code: "bad_request", message: "no" } }, { body: { ok: 1 } }]);
  await assert.rejects(() => clientOf(permanent).request("GET", "/x"), HttpError);
  assert.equal(permanent.calls.length, 1);
});

test("retries are finite and the last failure is the one reported", async () => {
  const s = stub(Array.from({ length: 5 }, () => ({ status: 502, body: { message: "nope" } })));
  await assert.rejects(() => clientOf(s, { maxRetries: 2 }).request("GET", "/x"), /502 http_502: nope/);
  assert.equal(s.calls.length, 3);
});

test("describeError turns a backend's own error vocabulary into something readable", async () => {
  const s = stub([{ status: 404, body: { code: "not_found", message: "Could not find it." } }]);
  const client = clientOf(s, {
    describeError: (status: number, body: any) =>
      status === 404 ? `${body.message} The integration may not have been given access.` : undefined,
  });
  await assert.rejects(() => client.request("GET", "/x"), /may not have been given access/);
});

test("a network failure names the host rather than the arguments", async () => {
  const client = createHttpClient({
    baseUrl: "https://api.example.com/v1",
    sleep: noSleep,
    maxRetries: 1,
    fetch: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(() => client.request("GET", "/x"), /could not reach api\.example\.com after 2 attempts/);
});

test("a non-JSON body is reported as one", async () => {
  const client = createHttpClient({
    baseUrl: "https://api.example.com/v1",
    sleep: noSleep,
    fetch: async () => new Response("<html>maintenance</html>", { status: 200 }),
  });
  await assert.rejects(() => client.request("GET", "/x"), /was not JSON/);
});
