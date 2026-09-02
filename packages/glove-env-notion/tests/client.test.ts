import assert from "node:assert/strict";
import test from "node:test";
import { NotionApiError, NotionClient } from "../src/client";
import { createFake, DS_ID } from "./fake";

const noSleep = async () => {};

function clientOf(fake: ReturnType<typeof createFake>, extra = {}) {
  return new NotionClient({ token: "secret_x", fetch: fake.fetch, sleep: noSleep, ...extra });
}

test("every request carries the pinned API version and the bearer token", async () => {
  const fake = createFake();
  const seen: RequestInit[] = [];
  const client = new NotionClient({
    token: "secret_x",
    sleep: noSleep,
    fetch: async (url, init) => {
      seen.push(init);
      return fake.fetch(url, init);
    },
  });
  await client.request("GET", `/data_sources/${DS_ID}`);
  const headers = seen[0].headers as Record<string, string>;
  assert.equal(headers["Notion-Version"], "2025-09-03");
  assert.equal(headers.Authorization, "Bearer secret_x");
});

test("a token function is called per request, so a refreshing one works", async () => {
  const fake = createFake();
  let calls = 0;
  const client = clientOf(fake, { token: () => `token-${++calls}` });
  await client.request("GET", `/data_sources/${DS_ID}`);
  await client.request("GET", `/data_sources/${DS_ID}`);
  assert.equal(calls, 2);
});

test("pagination is exhausted, not exposed", async () => {
  const fake = createFake();
  const rows = await clientOf(fake).collect("POST", `/data_sources/${DS_ID}/query`, {});
  assert.equal(rows.length, 250);
  // 250 rows at 100 per page is three requests, and the third asked for the
  // cursor the second returned.
  const queries = fake.calls.filter((c) => c.path.endsWith("/query"));
  assert.equal(queries.length, 3);
  assert.equal((queries[2].body as { start_cursor: string }).start_cursor, "200");
});

test("a limit stops early and is honoured exactly", async () => {
  const fake = createFake();
  const rows = await clientOf(fake).collect("POST", `/data_sources/${DS_ID}/query`, {}, 5);
  assert.equal(rows.length, 5);
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/query")).length, 1);
});

test("running past the page cap throws rather than returning a prefix", async () => {
  // A truncated result set is the failure that reads as a correct answer.
  const fake = createFake();
  await assert.rejects(() => clientOf(fake, { maxPages: 2 }).collect("POST", `/data_sources/${DS_ID}/query`, {}), /Narrow it with a filter/);
});

test("429 is retried, and Retry-After is what decides the wait", async () => {
  const fake = createFake({
    script: [{ status: 429, body: { code: "rate_limited", message: "slow down" }, headers: { "retry-after": "2" } }],
  });
  const waits: number[] = [];
  const client = clientOf(fake, { sleep: async (ms: number) => void waits.push(ms) });
  const ds = await client.request<{ id: string }>("GET", `/data_sources/${DS_ID}`);
  assert.equal(ds.id, DS_ID);
  assert.deepEqual(waits, [2000]);
});

test("a 5xx is retried; a 400 is not", async () => {
  const transient = createFake({ script: [{ status: 503, body: { code: "service_unavailable", message: "later" } }] });
  assert.ok(await clientOf(transient).request("GET", `/data_sources/${DS_ID}`));

  const permanent = createFake({
    script: [
      { status: 400, body: { code: "validation_error", message: "body failed validation" } },
      { status: 200, body: { id: "would-have-worked" } },
    ],
  });
  await assert.rejects(() => clientOf(permanent).request("GET", `/data_sources/${DS_ID}`), NotionApiError);
  assert.equal(permanent.calls.length, 1);
});

test("retries are finite, and the last failure is the one reported", async () => {
  const fake = createFake({
    script: Array.from({ length: 5 }, () => ({ status: 502, body: { code: "bad_gateway", message: "nope" } })),
  });
  await assert.rejects(() => clientOf(fake, { maxRetries: 2 }).request("GET", "/pages/x"), /502 bad_gateway/);
  assert.equal(fake.calls.length, 3);
});

test("object_not_found explains the thing its message never says", async () => {
  const fake = createFake();
  await assert.rejects(
    () => clientOf(fake).request("GET", "/pages/00000000-0000-0000-0000-000000000000"),
    (e: NotionApiError) => {
      assert.equal(e.status, 404);
      assert.equal(e.code, "object_not_found");
      assert.match(e.message, /shared with it/);
      assert.match(e.message, /Connections/);
      return true;
    },
  );
});

test("a network failure names the host rather than the arguments", async () => {
  const client = new NotionClient({
    token: "t",
    sleep: noSleep,
    maxRetries: 1,
    fetch: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(() => client.request("GET", "/pages/x"), /could not reach api\.notion\.com after 2 attempts/);
});

test("a token that resolves to nothing fails before the request", async () => {
  const fake = createFake();
  await assert.rejects(() => clientOf(fake, { token: () => "  " }).request("GET", "/pages/x"), /empty value/);
  assert.equal(fake.calls.length, 0);
  assert.throws(() => new NotionClient({ token: "" } as never), /needs a token/);
});

test("a non-JSON body is reported as one", async () => {
  const client = new NotionClient({
    token: "t",
    sleep: noSleep,
    fetch: async () => new Response("<html>maintenance</html>", { status: 200 }),
  });
  await assert.rejects(() => client.request("GET", "/pages/x"), /not JSON/);
});
