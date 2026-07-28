import { test } from "node:test";
import assert from "node:assert/strict";
import { callOk, makeEnv, VALID_SCRIPT } from "./helpers";

test("write a valid script, run it, get the result", async () => {
  const env = await makeEnv();
  const msg = await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  assert.match(msg, /created \/scripts\/add\.js/);
  assert.match(msg, /\.d\.ts regenerated/);

  const out = await callOk(env, "run_script", { path: "/scripts/add.js", args: { a: 2, b: 3 } });
  assert.match(out, /ok \(\d+ms\)/);
  assert.match(out, /"sum": 5/);

  const run = await env.runScript("/scripts/add.js", { a: 10, b: 20 });
  assert.equal(run.ok, true);
  assert.deepEqual(run.result, { sum: 30 });
});
