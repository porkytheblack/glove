/**
 * Host-configured read-only zones (`readOnlyPaths`).
 *
 * The promise under test: a zone is readable through every surface and
 * mutable through none — model verbs, scripts going through `env:fs`, and
 * undo alike — while the host's `mount()` door stays open, because seeding
 * content the agent can only read is the entire point of the option.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, rm as rmDir, writeFile as hostWrite, mkdir as hostMkdir, readFile as hostRead } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorkingEnvironment, hostDirectory } from "../src/index";

type Tool = { name: string; do: (input: unknown) => Promise<{ status: string; data?: unknown; message?: string }> };
const verb = (env: { tools: Array<{ name: string }> }, name: string) =>
  env.tools.find((t) => t.name === name) as unknown as Tool;
const text = (s: string) => new TextEncoder().encode(s);

async function corpusEnv() {
  const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
  await env.mount(text("alpha handbook line one\nline two"), "/corpus/handbook.txt");
  await env.mount(text("beta"), "/corpus/nested/beta.txt");
  return env;
}

test("every mutating verb is refused inside the zone, with the zone and the fix named", async () => {
  const env = await corpusEnv();
  try {
    const cases: Array<[string, unknown]> = [
      ["write_file", { path: "/corpus/new.txt", content: "x" }],
      ["write_file", { path: "/corpus/handbook.txt", content: "overwrite" }],
      ["edit_file", { path: "/corpus/handbook.txt", old_str: "alpha", new_str: "omega" }],
      ["rm", { path: "/corpus/handbook.txt" }],
      ["rm", { path: "/corpus" }],
      ["mv", { from: "/corpus/handbook.txt", to: "/tmp/stolen.txt" }],
      ["mv", { from: "/tmp/x.txt", to: "/corpus/planted.txt" }],
      ["cp", { from: "/tmp/x.txt", to: "/corpus/planted.txt" }],
    ];
    await env.fs.writeFile("/tmp/x.txt", "payload");
    for (const [name, input] of cases) {
      const r = await verb(env, name).do(input);
      assert.equal(r.status, "error", `${name} ${JSON.stringify(input)} must be refused`);
      assert.match(String(r.message), /\/corpus is read-only/, `${name} must name the zone`);
      assert.match(String(r.message), /cp .* \/tmp\//, `${name} must carry the copy-out fix`);
    }
    // Nothing above may have changed the tree.
    const back = await verb(env, "read_file").do({ path: "/corpus/handbook.txt" });
    assert.equal(back.status, "success");
    assert.match(String(back.data), /alpha handbook/);
  } finally {
    await env.close();
  }
});

test("reading stays fully open: read_file, ls, grep, cp OUT of the zone", async () => {
  const env = await corpusEnv();
  try {
    assert.equal((await verb(env, "read_file").do({ path: "/corpus/handbook.txt" })).status, "success");
    const ls = await verb(env, "ls").do({ path: "/corpus", depth: 2 });
    assert.equal(ls.status, "success");
    assert.match(String(ls.data), /handbook\.txt/);
    const grep = await verb(env, "grep").do({ pattern: "line two", path: "/corpus" });
    assert.equal(grep.status, "success");
    assert.match(String(grep.data), /handbook\.txt/);

    // Copying OUT is the documented workflow, so it must work.
    const cp = await verb(env, "cp").do({ from: "/corpus/handbook.txt", to: "/tmp/copy.txt" });
    assert.equal(cp.status, "success", cp.message);
    assert.equal(await env.fs.readFile("/tmp/copy.txt"), "alpha handbook line one\nline two");
  } finally {
    await env.close();
  }
});

test("scripts hit the same wall through env:fs — and can still read", async () => {
  const env = await corpusEnv();
  try {
    const write = verb(env, "write_file");
    const run = verb(env, "run_script");

    await write.do({
      path: "/scripts/attack.js",
      content:
        `import { writeFile } from 'env:fs';\n` +
        `export default async function main() { await writeFile('/corpus/planted.txt', 'x'); }\n`,
    });
    const attacked = await run.do({ path: "/scripts/attack.js" });
    assert.equal(attacked.status, "error");
    assert.match(String(attacked.message), /\/corpus is read-only/);

    await write.do({
      path: "/scripts/summarise.js",
      content:
        `import { readFile, glob } from 'env:fs';\n` +
        `export default async function main() {\n` +
        `  const files = await glob('/corpus/**');\n` +
        `  const first = await readFile('/corpus/handbook.txt');\n` +
        `  return { files: files.length, startsWith: first.slice(0, 5) };\n` +
        `}\n`,
    });
    const read = await run.do({ path: "/scripts/summarise.js" });
    assert.equal(read.status, "success", read.message);
    assert.match(String(read.data), /alpha/);
  } finally {
    await env.close();
  }
});

test("undo cannot be used as a side door into the zone", async () => {
  const env = await corpusEnv();
  try {
    const r = await verb(env, "undo").do({ path: "/corpus/handbook.txt" });
    assert.equal(r.status, "error");
    assert.match(String(r.message), /read-only/);
  } finally {
    await env.close();
  }
});

test("the host door stays open: mount seeds a zone the agent cannot touch", async () => {
  const env = await createWorkingEnvironment({ readOnlyPaths: ["/corpus"] });
  try {
    await env.mount(text("seeded later"), "/corpus/late.txt");
    const read = await verb(env, "read_file").do({ path: "/corpus/late.txt" });
    assert.equal(read.status, "success");
    assert.match(String(read.data), /seeded later/);

    // env.fs is the GUARDED host handle — it obeys the same rules as the
    // model, so mount() is the one door, on purpose.
    await assert.rejects(() => env.fs.writeFile("/corpus/via-fs.txt", "x"), /read-only/);
  } finally {
    await env.close();
  }
});

test("orientation announces the zone before the model ever tries", async () => {
  const env = await corpusEnv();
  try {
    const r = await verb(env, "read_file").do({ path: "/.env/orientation.md" });
    assert.equal(r.status, "success");
    assert.match(String(r.data), /\/corpus/);
    assert.match(String(r.data), /READ-ONLY/);
  } finally {
    await env.close();
  }
});

test("the zone directory exists from creation, even before anything is mounted", async () => {
  const env = await createWorkingEnvironment({ readOnlyPaths: ["/reference"] });
  try {
    const ls = await verb(env, "ls").do({});
    assert.equal(ls.status, "success");
    assert.match(String(ls.data), /reference/);
  } finally {
    await env.close();
  }
});

test("bad configurations fail at creation, to the host", async () => {
  await assert.rejects(() => createWorkingEnvironment({ readOnlyPaths: ["/"] }), /cannot contain "\/"/);
  await assert.rejects(
    () => createWorkingEnvironment({ readOnlyPaths: ["corpus"] as string[] }),
    /absolute VFS paths/,
  );
});

test("combines with hostDirectory: a real directory the agent reads but never edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "glove-rozone-"));
  try {
    await hostMkdir(join(dir, "src"));
    await hostWrite(join(dir, "src", "main.ts"), "export const answer = 42;\n");

    const disk = hostDirectory(dir);
    const env = await createWorkingEnvironment({ filesystem: disk, readOnlyPaths: ["/src"] });
    try {
      // Reads reach the real files.
      const read = await verb(env, "read_file").do({ path: "/src/main.ts" });
      assert.equal(read.status, "success");
      assert.match(String(read.data), /answer = 42/);

      // Writes into the fenced subtree are refused; elsewhere they work.
      const denied = await verb(env, "write_file").do({ path: "/src/main.ts", content: "sabotage" });
      assert.equal(denied.status, "error");
      assert.match(String(denied.message), /\/src is read-only/);
      const allowed = await verb(env, "write_file").do({ path: "/notes.md", content: "observations" });
      assert.equal(allowed.status, "success", allowed.message);

      // And the real file on disk never changed.
      assert.equal(await hostRead(join(dir, "src", "main.ts"), "utf8"), "export const answer = 42;\n");
    } finally {
      await env.close();
    }
  } finally {
    await rmDir(dir, { recursive: true, force: true });
  }
});
