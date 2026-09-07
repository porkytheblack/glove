import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { secret, createMemorySecretStore } from "../src/index";

test("metadata and references work without persisting or revealing host secrets", async () => {
  const value = "private-token-not-for-the-vfs";
  const store = createMemorySecretStore({ bank: value, empty: "", hidden: "other" });
  const t = await createAdapterTestEnv(secret({ store, names: ["bank", "empty"] }));
  try {
    assertAdapterOk(await t.audit());
    assert.deepEqual(await t.script(`import { list, has, ref } from 'env:secret';
      export default async function main() { return { names: await list(), exists: await has('empty'), ref: await ref('bank') }; }`),
    { names: ["bank", "empty"], exists: true, ref: { kind: "env:secret", name: "bank" } });
    for (const expression of ["get('bank')", "set('bank', 'new')", "remove('bank')", "has('hidden')"]) {
      const run = await t.runScript(`import { get, set, remove, has } from 'env:secret';
        export default async function main() { return ${expression}; }`);
      assert.equal(run.ok, false);
      assert.ok(!JSON.stringify(run).includes(value));
    }
    assert.equal(await store.get("bank"), value);
    const snapshot = await t.env.snapshot();
    for (const file of snapshot.files) assert.ok(!Buffer.from(file.data, "base64").toString().includes(value));
  } finally { await t.env.close(); }
});

test("opt-in CRUD supports replacement, deletion, missing keys and empty values", async () => {
  const t = await createAdapterTestEnv(secret({ allowReveal: true, allowWrite: true }));
  try {
    assert.deepEqual(await t.script(`import { get, set, remove, has } from 'env:secret';
      export default async function main() {
        await set('token', 'first'); await set('token', '');
        const result = [await get('token'), await has('token'), await remove('token'), await remove('token'), await get('token')];
        return result;
      }`), ["", true, true, false, null]);
    const run = await t.runScript(`import { ref } from 'env:secret'; export default async function main() { return ref('absent'); }`);
    assert.equal(run.ok, false);
    assert.match(String(run.error), /does not exist/);
  } finally { await t.env.close(); }
});

test("default storage is isolated even when the same adapter definition is reused", async () => {
  const adapter = secret({ allowWrite: true, allowReveal: true });
  const a = await createAdapterTestEnv(adapter);
  const b = await createAdapterTestEnv(adapter);
  try {
    await a.script(`import { set } from 'env:secret'; export default async function main() { await set('only-a', 'value'); }`);
    assert.equal(await b.script(`import { has } from 'env:secret'; export default async function main() { return has('only-a'); }`), false);
  } finally { await a.env.close(); await b.env.close(); }
});

test("validation does not access or mutate an external store; provider errors are sanitized", async () => {
  let calls = 0;
  const store = createMemorySecretStore();
  const t = await createAdapterTestEnv(secret({
    store: { ...store, async get() { calls++; throw new Error("backend failed: secret-password"); } },
    allowWrite: true,
  }));
  try {
    const run = await t.runScript(`import { has } from 'env:secret'; const exists = await has('key');
      export default function main() { return exists; }`);
    assert.equal(run.ok, false);
    assert.equal(calls, 0);
    const failed = await t.runScript(`import { has } from 'env:secret';
      export default async function main() { return has('key'); }`);
    assert.equal(calls, 1);
    assert.match(String(failed.error), /Secret store operation failed/);
    assert.ok(!JSON.stringify(failed).includes("secret-password"));
  } finally { await t.env.close(); }
});

test("a supplied store survives environment reconstruction without using VFS snapshots", async () => {
  const store = createMemorySecretStore({ token: "seed" });
  const first = await createAdapterTestEnv(secret({ store, allowWrite: true }));
  await first.script(`import { set } from 'env:secret'; export default async function main() { await set('token', 'rotated'); }`);
  await first.env.close();
  const next = await createAdapterTestEnv(secret({ store, allowReveal: true }));
  try {
    assert.equal(await next.script(`import { get } from 'env:secret'; export default async function main() { return get('token'); }`), "rotated");
  } finally { await next.env.close(); }
});
