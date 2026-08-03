/**
 * Acceptance: mount/export/snapshot/fromSnapshot round-trip (including
 * /scripts, .d.ts siblings, and /.env history); stdlib adapters materialize
 * under /std, bind through the VFS handle, and follow the describe()
 * convention; mountWorkingEnvironment folds the verb set and primes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkingEnvironment,
  fromSnapshot,
  mountWorkingEnvironment,
  type EnvFsHandle,
  type EnvTool,
  type StdlibAdapter,
} from "../src/index";
import { callErr, callOk, makeEnv, VALID_SCRIPT } from "./helpers";

/** A miniature format adapter following the §4 conventions (paths in, paths out, describe()). */
function textkit(): StdlibAdapter {
  return {
    name: "textkit",
    description: "Toy text-format adapter (upper-case 'rendering' + describe).",
    types: `export function render(path: string, text: string): Promise<{ output: string }>;\nexport function describe(path: string): Promise<{ chars: number; preview: string }>;\n`,
    docs: `# textkit\n\nRender text loudly: await render('/out/x.txt', 'hi')\n`,
    create(vfs: EnvFsHandle) {
      return {
        async render(path: string, text: string) {
          await vfs.writeFile(path, text.toUpperCase());
          return { output: path };
        },
        async describe(path: string) {
          const body = await vfs.readFile(path);
          return { chars: body.length, preview: body.slice(0, 20) };
        },
      };
    },
  };
}

test("adapters materialize under /std and are importable as env:<name>", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  assert.match(await callOk(env, "ls", { path: "/std" }), /textkit\/ — Toy text-format adapter/);
  assert.match(await callOk(env, "read_file", { path: "/std/textkit/index.d.ts" }), /function render/);
  assert.match(await callOk(env, "read_file", { path: "/std/textkit/README.md" }), /# textkit/);

  await callOk(env, "write_file", {
    path: "/scripts/shout.js",
    content: [
      `import { render, describe } from 'env:textkit';`,
      `export default async function shout(args) {`,
      `  const { output } = await render('/out/loud.txt', args.text);`,
      `  return describe(output);`,
      `}`,
    ].join("\n"),
  });
  const run = await env.runScript("/scripts/shout.js", { text: "quiet words" });
  assert.deepEqual(run.result, { chars: 11, preview: "QUIET WORDS" });

  const exported = await env.export("/out/**");
  assert.equal(new TextDecoder().decode(exported[0].bytes), "QUIET WORDS");
});

test("adapter I/O goes through the guarded gateway — /std stays read-only even for adapters", async () => {
  const sneaky: StdlibAdapter = {
    name: "sneaky",
    description: "tries to write into /std",
    types: "export function poke(): Promise<string>;\n",
    create(vfs: EnvFsHandle) {
      return {
        async poke() {
          try {
            await vfs.writeFile("/std/sneaky/own-docs.md", "self-modified");
            return "wrote";
          } catch (e) {
            return `blocked: ${(e as Error).message}`;
          }
        },
      };
    },
  };
  const env = await makeEnv({ stdlib: [sneaky] });
  await callOk(env, "write_file", {
    path: "/scripts/p.js",
    content: `import { poke } from 'env:sneaky';\nexport default async function p() { return poke(); }\n`,
  });
  const run = await env.runScript("/scripts/p.js");
  assert.match(String(run.result), /^blocked: .*read-only/);
});

test("duplicate or reserved adapter names are rejected at construction", async () => {
  await assert.rejects(
    () => createWorkingEnvironment({ stdlib: [{ name: "fs", description: "", types: "", create: () => ({}) }] }),
    /already registered/,
  );
  await assert.rejects(
    () => createWorkingEnvironment({ stdlib: [{ name: "Bad Name", description: "", types: "", create: () => ({}) }] }),
    /invalid stdlib adapter name/,
  );
});

test("mount accepts host bytes and literal text; refuses /std and /.env", async () => {
  const env = await makeEnv();
  await env.mount(new TextEncoder().encode("raw bytes"), "/inbox/raw.bin");
  await env.mount({ text: "typed text" }, "/inbox/typed.txt");
  assert.match(await callOk(env, "read_file", { path: "/inbox/typed.txt" }), /typed text/);
  await assert.rejects(() => env.mount({ text: "x" }, "/.env/hack"), /maintained by the environment/);
  await assert.rejects(() => env.mount({ text: "x" }, "/std/hack"), /maintained by the environment/);
});

test("snapshot → fromSnapshot round-trips scripts, .d.ts siblings, history, and undo state", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/add.js", content: VALID_SCRIPT });
  await callOk(env, "edit_file", { path: "/scripts/add.js", old_str: "addNumbers", new_str: "addBoth" });
  await callOk(env, "run_script", { path: "/scripts/add.js", args: { a: 4, b: 5 } });
  await env.mount({ text: "hello" }, "/inbox/in.txt");

  const snap = await env.snapshot();
  assert.equal(snap.version, 1);
  const json = JSON.stringify(snap); // must be plainly serializable
  const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(JSON.parse(json)) });

  // scripts + derived state
  assert.match(await callOk(env2, "read_file", { path: "/scripts/add.js" }), /addBoth/);
  assert.match(await callOk(env2, "read_file", { path: "/scripts/add.d.ts" }), /addBoth/);
  // inputs
  assert.match(await callOk(env2, "read_file", { path: "/inbox/in.txt" }), /hello/);
  // run history
  assert.match(await callOk(env2, "history", {}), /\/scripts\/add\.js args=\{"a":4,"b":5\}/);
  // scripts still run
  const rerun = await env2.runScript("/scripts/add.js", { a: 1, b: 1 });
  assert.deepEqual(rerun.result, { sum: 2 });
  // undo state carried across the snapshot
  await callOk(env2, "undo", { path: "/scripts/add.js" });
  assert.match(await callOk(env2, "read_file", { path: "/scripts/add.js" }), /addNumbers/);
  assert.match(await callOk(env2, "read_file", { path: "/scripts/add.d.ts" }), /addNumbers/);
});

test("a stored script that depends on an adapter still runs after a restore", async () => {
  // The realistic persistence case: an agent's saved script imports a stdlib
  // module, so restoring it means re-binding a live host capability — not
  // just replaying bytes.
  const env = await makeEnv({ stdlib: [textkit()] });
  await callOk(env, "write_file", {
    path: "/scripts/shout.js",
    content: `import { render, describe } from 'env:textkit';

/**
 * Renders text loudly to a path and reports what landed.
 * @param {{ out: string, text: string }} args
 */
export default async function shout(args) {
  await render(args.out, args.text);
  return describe(args.out);
}
`,
  });

  const snap = await env.snapshot();
  const restored = await createWorkingEnvironment({
    filesystem: fromSnapshot(JSON.parse(JSON.stringify(snap))),
    stdlib: [textkit()],
  });

  const rerun = await restored.runScript("/scripts/shout.js", { out: "/out/loud.txt", text: "still here" });
  assert.equal(rerun.ok, true, rerun.error);
  assert.deepEqual(rerun.result, { chars: 10, preview: "STILL HERE" });
  assert.equal(await restored.fs.readFile("/out/loud.txt"), "STILL HERE");
});

test("a restored script whose adapter is gone fails with a message naming the module", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  await callOk(env, "write_file", {
    path: "/scripts/shout.js",
    content: `import { render } from 'env:textkit';\n\n/** Shouts. */\nexport default async function shout(a) { return render(a.out, a.text); }\n`,
  });
  const snap = await env.snapshot();

  // Host forgot to register the adapter this time — the script is intact but
  // its capability is not. The failure has to say which module is missing.
  const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
  const rerun = await restored.runScript("/scripts/shout.js", { out: "/out/x.txt", text: "hi" });
  assert.equal(rerun.ok, false);
  assert.match(rerun.error ?? "", /textkit/);
});

test("restoring a snapshot re-materializes /std from the CURRENT adapter set", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const snap = await env.snapshot();
  const env2 = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) }); // no textkit this time
  // The stale docs are gone, and the message says why rather than leaving the
  // model to conclude the file was merely misplaced.
  const err = await callErr(env2, "read_file", { path: "/std/textkit/index.d.ts" });
  assert.match(err, /no module named "textkit"/);
  assert.match(err, /Registered modules: env:fs, env:std, env:assert/);
  assert.match(await callOk(env2, "ls", { path: "/std" }), /fs\//);
});

test("mountWorkingEnvironment folds the closed verb set and primes the system prompt", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  const folded: EnvTool[] = [];
  let prompt = "BASE PROMPT";
  const fakeGlove = {
    fold: (t: EnvTool) => folded.push(t),
    getSystemPrompt: () => prompt,
    setSystemPrompt: (p: string) => {
      prompt = p;
    },
  };
  mountWorkingEnvironment(fakeGlove, { env });
  assert.deepEqual(
    folded.map((t) => t.name).sort(),
    ["checkpoint", "cp", "describe", "edit_file", "grep", "history", "ls", "mv", "read_file", "redo", "rm", "run_script", "run_tests", "undo", "write_file"],
  );
  assert.match(prompt, /WORKING ENVIRONMENT/);
  assert.match(prompt, /env:textkit \(Toy text-format adapter/);
  assert.match(prompt, /BASE PROMPT$/);

  // every verb carries a JSON schema (structurally foldable without zod)
  for (const t of folded) {
    assert.equal(typeof t.description, "string");
    assert.equal((t.jsonSchema as { type: string }).type, "object");
  }
});

test("toolPrefix namespaces the verbs for collision-averse hosts", async () => {
  const env = await makeEnv();
  const folded: EnvTool[] = [];
  mountWorkingEnvironment({ fold: (t: EnvTool) => folded.push(t) }, { env, toolPrefix: "env_", prime: false });
  assert.ok(folded.every((t) => t.name.startsWith("env_")));
  const write = folded.find((t) => t.name === "env_write_file")!;
  const r = await write.do({ path: "/tmp/x.txt", content: "hi" });
  assert.equal(r.status, "success");
});

// ─────────────────────────────── orientation and restore compatibility

test("/.env/orientation.md answers 'where am I' in one read", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  await env.mount({ text: "a,b\n1,2\n" }, "/inbox/data.csv");
  await callOk(env, "write_file", {
    path: "/scripts/tally.js",
    content: `import { readFile } from 'env:fs';\n\n/** Counts the rows in a CSV. */\nexport default async function tally(args) { return (await readFile(args.path)).split("\\n").length; }\n`,
  });
  await callOk(env, "run_script", { path: "/scripts/tally.js", args: { path: "/inbox/data.csv" } });
  await env.fs.writeFile("/out/report.txt", "done");

  const text = await callOk(env, "read_file", { path: "/.env/orientation.md" });
  assert.match(text, /\/inbox` — 1 file/);
  assert.match(text, /\/scripts\/tally\.js` — Counts the rows in a CSV\./);
  assert.match(text, /env:fs.*used by 1 script/);
  assert.match(text, /env:textkit/, "a registered but unused module is still listed");
  assert.match(text, /\/out\/report\.txt/);
  assert.match(text, /ok `\/scripts\/tally\.js`/);
});

test("orientation is rebuilt on every read, so deletes cannot leave it stale", async () => {
  // The case a maintained-on-mutation file gets wrong.
  const env = await makeEnv();
  await callOk(env, "write_file", { path: "/scripts/doomed.js", content: VALID_SCRIPT });
  assert.match(await callOk(env, "read_file", { path: "/.env/orientation.md" }), /doomed\.js/);

  await callOk(env, "rm", { path: "/scripts/doomed.js" });
  const after = await callOk(env, "read_file", { path: "/.env/orientation.md" });
  assert.doesNotMatch(after, /doomed\.js/);
  assert.match(after, /None yet/);
});

test("orientation stays bounded as the script library grows", async () => {
  const env = await makeEnv();
  for (let i = 0; i < 25; i++) {
    await callOk(env, "write_file", { path: `/scripts/s${i}.js`, content: VALID_SCRIPT });
  }
  const text = await callOk(env, "read_file", { path: "/.env/orientation.md" });
  assert.match(text, /… 10 more — `ls \/scripts` for the full catalogue/);
  assert.ok(text.length < 4000, `orientation should stay small, got ${text.length} chars`);
});

test("the environment is not charged for an orientation file nobody reads", async () => {
  const env = await makeEnv();
  assert.equal(await env.fs.exists("/.env/orientation.md"), false);
  await callOk(env, "read_file", { path: "/.env/orientation.md" });
  assert.equal(await env.fs.exists("/.env/orientation.md"), true, "and it persists once asked for");
});

test("restoring without a required adapter warns the host, naming the scripts", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  await callOk(env, "write_file", {
    path: "/scripts/uses_it.js",
    content: `import { render } from 'env:textkit';\n\n/** Shouts. */\nexport default async function main() { return render('/out/a.txt', 'hi'); }\n`,
  });
  const snap = await env.snapshot();

  // Same tree, host forgot the adapter.
  const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
  assert.equal(restored.warnings.length, 1);
  assert.match(restored.warnings[0], /"env:textkit", which is not registered/);
  assert.match(restored.warnings[0], /\/scripts\/uses_it\.js/);

  // With the adapter back, no warning — and the script still runs.
  const healthy = await createWorkingEnvironment({ filesystem: fromSnapshot(snap), stdlib: [textkit()] });
  assert.deepEqual(healthy.warnings, []);
  await healthy.fs.writeFile("/inbox/a.txt", "hi");
  assert.equal((await healthy.runScript("/scripts/uses_it.js")).ok, true);
});

test("strictAdapters turns the warning into a startup failure", async () => {
  const env = await makeEnv({ stdlib: [textkit()] });
  await callOk(env, "write_file", {
    path: "/scripts/uses_it.js",
    content: `import { render } from 'env:textkit';\n\n/** Shouts. */\nexport default async function main() { return render('/out/a.txt', 'hi'); }\n`,
  });
  const snap = await env.snapshot();
  await assert.rejects(
    () => createWorkingEnvironment({ filesystem: fromSnapshot(snap), strictAdapters: true }),
    /env:textkit/,
  );
});

test("the adapter scan reads imports, not text that looks like one", async () => {
  const env = await makeEnv();
  await callOk(env, "write_file", {
    path: "/scripts/decoys.js",
    content:
      `// import { x } from 'env:ghost';\n` +
      `const doc = \`see env:phantom for details\`;\n` +
      `import { readFile } from 'env:fs';\n\n` +
      `/** Reads. */\nexport default async function main(args) { return readFile(args.path) + doc; }\n`,
  });
  const snap = await env.snapshot();
  const restored = await createWorkingEnvironment({ filesystem: fromSnapshot(snap) });
  assert.deepEqual(restored.warnings, [], "a commented-out or quoted specifier is not an import");
});
