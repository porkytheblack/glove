import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { demoSecret, withDemoEnv } from "../src/demo-env.mjs";
import { bearer, hubSignature, mockLog, sameSignature, slackSignature } from "../src/server/demo";

test("signatures match the providers' schemes", () => {
  const body = '{"object":"whatsapp_business_account"}';
  assert.equal(hubSignature(body, "s"), `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`);
  assert.equal(slackSignature(body, "1700000000", "s"), `v0=${createHmac("sha256", "s").update(`v0:1700000000:${body}`).digest("hex")}`);
  assert.ok(sameSignature(hubSignature(body, "s"), hubSignature(body, "s")));
  assert.ok(!sameSignature(hubSignature(body, "s"), hubSignature(body, "t")));
  assert.ok(!sameSignature("short", hubSignature(body, "s")));
});

test("a mock's API takes only the app's token", () => {
  const request = (authorization?: string) => new Request("http://x/", authorization ? { headers: { authorization } } : {});
  assert.ok(bearer(request("Bearer tok"), "tok"));
  assert.ok(!bearer(request("Bearer other"), "tok"));
  assert.ok(!bearer(request(), "tok"));
  assert.ok(!bearer(request("Bearer "), undefined), "no token configured means no access");
});

test("demo secrets come from the session secret, one per mock", () => {
  assert.equal(demoSecret("whatsapp-app", "a"), demoSecret("whatsapp-app", "a"));
  assert.notEqual(demoSecret("whatsapp-app", "a"), demoSecret("whatsapp-app", "b"));
  assert.notEqual(demoSecret("whatsapp-app", "a"), demoSecret("slack-signing", "a"));
});

test("withDemoEnv adds the mocks' values only when DEMO_CONNECTORS=1", () => {
  const vars = (secret: (name: string) => string, web: string) => ({ WHATSAPP_TOKEN: secret("token"), WHATSAPP_GRAPH_URL: `${web}/mock/whatsapp` });
  const off = { WEB_SESSION_SECRET: "a", PORT: "4000" };
  assert.deepEqual(withDemoEnv(off, vars), off);
  const on = withDemoEnv({ ...off, DEMO_CONNECTORS: "1", WHATSAPP_TOKEN: "real" }, vars);
  assert.equal(on.WHATSAPP_GRAPH_URL, "http://127.0.0.1:4000/mock/whatsapp");
  assert.equal(on.WHATSAPP_TOKEN, demoSecret("token", "a"), "the mocks replace the providers");
});

test("the log keeps entries in order, filters them and skips a torn line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-demo-"));
  const log = mockLog(dir);
  assert.deepEqual(await log.list(), []);
  await log.append({ connector: "whatsapp", direction: "in", person: "rosa", text: "hi" });
  await appendFile(join(dir, "demo-connectors.jsonl"), '{"cut sho');
  await appendFile(join(dir, "demo-connectors.jsonl"), "\n");
  await log.append({ connector: "whatsapp", direction: "out", person: "sam", text: "yo" });
  await log.append({ connector: "mail", direction: "in", person: "rosa", subject: "s" });
  const rosa = await log.list((entry) => entry.person === "rosa");
  assert.deepEqual(rosa.map((entry) => entry.connector), ["whatsapp", "mail"]);
  assert.equal((await log.list(undefined, 1)).length, 1);
  assert.match(rosa[0]!.id, /^[0-9a-f-]{36}$/);
});
