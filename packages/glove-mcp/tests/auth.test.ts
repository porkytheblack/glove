import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, headers, adapterAuth } from "../src/auth";
import type { McpAdapter } from "../src/adapter";

test("bearer wraps a static token in an Authorization header", async () => {
  const h = await bearer("tok-123").headers();
  assert.deepEqual(h, { Authorization: "Bearer tok-123" });
});

test("bearer re-resolves a thunk on each call", async () => {
  let n = 0;
  const auth = bearer(() => `tok-${++n}`);
  assert.deepEqual(await auth.headers(), { Authorization: "Bearer tok-1" });
  assert.deepEqual(await auth.headers(), { Authorization: "Bearer tok-2" });
});

test("headers passes a static map through verbatim", async () => {
  const h = await headers({ "x-api-key": "k-abc" }).headers();
  assert.deepEqual(h, { "x-api-key": "k-abc" });
});

test("headers re-resolves a thunk on each call", async () => {
  let n = 0;
  const auth = headers(async () => ({ "x-api-key": `k-${++n}` }));
  assert.deepEqual(await auth.headers(), { "x-api-key": "k-1" });
  assert.deepEqual(await auth.headers(), { "x-api-key": "k-2" });
});

const baseAdapter = {
  identifier: "test",
  getActive: async () => [],
  activate: async () => {},
  deactivate: async () => {},
};

test("adapterAuth prefers getAuthHeaders over getAccessToken", async () => {
  const adapter: McpAdapter = {
    ...baseAdapter,
    getAccessToken: async () => "should-not-be-used",
    getAuthHeaders: async (id) => ({ "x-api-key": `key-for-${id}` }),
  };
  const auth = adapterAuth(adapter, "composio");
  assert.ok(auth);
  assert.deepEqual(await auth.headers(), { "x-api-key": "key-for-composio" });
});

test("adapterAuth falls back to bearer via getAccessToken", async () => {
  const adapter: McpAdapter = {
    ...baseAdapter,
    getAccessToken: async (id) => `tok-for-${id}`,
  };
  const auth = adapterAuth(adapter, "notion");
  assert.ok(auth);
  assert.deepEqual(await auth.headers(), { Authorization: "Bearer tok-for-notion" });
});

test("adapterAuth returns undefined when the adapter has no auth seam", () => {
  const adapter: McpAdapter = { ...baseAdapter };
  assert.equal(adapterAuth(adapter, "public"), undefined);
});
