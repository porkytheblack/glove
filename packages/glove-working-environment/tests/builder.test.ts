/**
 * The builder primitive, against a synthetic library.
 *
 * The real consumers (pptxgenjs, exceljs, docx) each exercise one shape of
 * this; the mechanism itself is easier to pin against a library small enough
 * to read, and it belongs where the mechanism lives rather than in whichever
 * adapter happened to need it first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapterTestEnv, type AdapterTestEnv } from "../src/testing";
import { defineAdapter, defineBuilder, defineBuilders, methodsOf } from "../src/index";
import type { EnvFsHandle } from "../src/index";

// --------------------------------------------------------- the fake library

/** A run of text. Constructed and handed to a Memo — never called on. */
class Chunk {
  constructor(readonly text: string) {}
}

class Memo {
  readonly parts: string[] = [];
  title = "";
  /** A property that is read through rather than called: `memo.file.save()`. */
  readonly file: { render(): string };

  constructor(title = "") {
    this.title = title;
    const self = this;
    this.file = { render: () => `${self.title}\n${self.parts.join("\n")}` };
  }

  add(...items: Array<string | Chunk>): this {
    for (const item of items) this.parts.push(item instanceof Chunk ? item.text : String(item));
    return this;
  }

  /** Returns a NEW object, so a ref must track it rather than `this`. */
  section(name: string): Section {
    const s = new Section(name);
    this.parts.push(`## ${name}`);
    return s;
  }

  /** Reads a path — the reason `rewrite` exists. */
  attach(opts: { path?: string; data?: string }): this {
    this.parts.push(`[attached ${opts.data ?? opts.path}]`);
    return this;
  }
}

class Section {
  readonly notes: string[] = [];
  constructor(readonly name: string) {}
  note(text: string): this {
    this.notes.push(text);
    return this;
  }
}

// ------------------------------------------------------------- the adapter

function memoAdapter(opts: { family?: boolean } = {}) {
  return defineAdapter({
    name: "memo",
    description: "A synthetic builder library, for testing the primitive.",
    types: `export const Memo: unknown;\nexport const Chunk: unknown;\nexport const Printer: unknown;`,
    create: (vfs: EnvFsHandle) => {
      const probe = new Memo();
      const allow = [...new Set([...methodsOf(probe), ...methodsOf(probe.section("p")), "file"])];

      const single = defineBuilder<Memo>({
        name: "Memo",
        construct: (args) => new Memo(String(args[0] ?? "")),
        allow,
        rewrite: {
          async attach(args) {
            const o = { ...((args[0] ?? {}) as Record<string, unknown>) };
            if (typeof o.path === "string") {
              o.data = await vfs.readFile(o.path);
              delete o.path;
            }
            return [o];
          },
        },
        finish: {
          async save(target: Memo | { render(): string }, args) {
            const path = String(args[0] ?? "");
            const text = "render" in target ? target.render() : "";
            await vfs.writeFile(path, text);
            return path;
          },
          async render(target: Memo | { render(): string }) {
            return "render" in target ? target.render() : "";
          },
        },
      });

      if (!opts.family) return { Memo: single, Chunk: undefined, Printer: undefined };

      const built = defineBuilders({
        family: "memo",
        members: {
          Memo: { construct: (args) => new Memo(String(args[0] ?? "")) },
          Chunk: { construct: (args) => new Chunk(String(args[0] ?? "")) },
          Printer: { singleton: { stamp: (m: Memo) => `<<${m.parts.join("|")}>>` }, methods: ["print"] },
        },
        allow,
        finish: {
          async save(target: Memo, args) {
            await vfs.writeFile(String(args[0] ?? ""), target.file.render());
            return String(args[0] ?? "");
          },
          async print(target: { stamp(m: Memo): string }, args) {
            return target.stamp(args[0] as Memo);
          },
        },
      });
      return built;
    },
  });
}

async function env(family = false): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(memoAdapter({ family }));
}

// ------------------------------------------------------------------- tests

test("a chained recording replays in order and the terminal writes through the VFS", async () => {
  const t = await env();
  const out = await t.script<string>(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('Weekly');
       m.add('first').add('second');
       return m.file.save('/out/memo.txt');
     }`,
  );
  assert.equal(out, "/out/memo.txt");
  assert.equal(await t.fs.readFile("/out/memo.txt"), "Weekly\nfirst\nsecond");
});

test("a property is read through rather than called — `memo.file.save(...)`", async () => {
  // The ambiguity the recorder has to resolve: at `memo.file` it cannot know
  // whether the script will call it or read through it, so neither can be
  // recorded eagerly.
  const t = await env();
  const text = await t.script<string>(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('T');
       m.add('x');
       return m.file.render();
     }`,
  );
  assert.equal(text, "T\nx");
});

test("assigning a property assigns it on the live object", async () => {
  const t = await env();
  await t.script(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo();
       m.title = 'Set afterwards';
       m.add('body');
       return m.file.save('/out/set.txt');
     }`,
  );
  assert.equal(await t.fs.readFile("/out/set.txt"), "Set afterwards\nbody");
});

test("a call that returns a new object gets its own ref", async () => {
  const t = await env();
  await t.script(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('Doc');
       const s = m.section('Risks');
       s.note('supplier concentration');   // on the Section, not on the Memo
       m.add('after');
       return m.file.save('/out/sections.txt');
     }`,
  );
  assert.equal(await t.fs.readFile("/out/sections.txt"), "Doc\n## Risks\nafter");
});

test("a constructed value passed as an argument survives the boundary", async () => {
  // Without ref substitution a recorder proxy deep-copies to `{}` — the
  // argument would arrive empty and the failure would be silent.
  const t = await env(true);
  await t.script(
    `import { Memo, Chunk } from 'env:memo';
     export default async function main() {
       const m = new Memo('Refs');
       m.add(new Chunk('alpha'), new Chunk('beta'));
       return m.save('/out/refs.txt');
     }`,
  );
  assert.equal(await t.fs.readFile("/out/refs.txt"), "Refs\nalpha\nbeta");
});

test("a constructed value nested deep inside an argument is found too", async () => {
  const t = await env(true);
  const printed = await t.script<string>(
    `import { Memo, Chunk, Printer } from 'env:memo';
     export default async function main() {
       const m = new Memo('Deep');
       m.add(...['one', 'two'].map((w) => new Chunk(w)));
       return Printer.print(m);
     }`,
  );
  assert.equal(printed, "<<one|two>>");
});

test("a singleton is used without new, and is not a constructor", async () => {
  const t = await env(true);
  const run = await t.runScript(
    `import { Printer } from 'env:memo';
     export default async function main() { return new Printer(); }`,
  );
  assert.equal(run.ok, false);
  // It is a plain object with its methods on it, so `new` fails as `new {}`
  // would — and reading a name it does not have says what it does have.
  const missing = await t.runScript(
    `import { Printer } from 'env:memo';
     export default async function main() { return Printer.emboss(); }`,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? "", /no such export "emboss"/);
  assert.match(missing.error ?? "", /print/);
});

test("each terminal spends its recording — two documents do not bleed", async () => {
  const t = await env();
  await t.script(
    `import { Memo } from 'env:memo';
     export default async function main() {
       for (const name of ['first', 'second']) {
         const m = new Memo(name);
         m.add(name + ' body');
         await m.file.save('/out/' + name + '.txt');
       }
     }`,
  );
  assert.equal(await t.fs.readFile("/out/first.txt"), "first\nfirst body");
  assert.equal(await t.fs.readFile("/out/second.txt"), "second\nsecond body");
});

test("a method the library does not have is refused, and the refusal lists what it does", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo();
       m.append('wrong name');
       return m.file.save('/out/x.txt');
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /Memo has no method "append"/);
  assert.match(run.error ?? "", /\badd\b/);
  // And which call it was, since the whole recording replays at once.
  assert.match(run.error ?? "", /call #2/);
  assert.equal(await t.fs.exists("/out/x.txt"), false);
});

test("a property read that is not allowlisted is refused the same way", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo();
       return m.secrets.save('/out/x.txt');
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /Memo has no property "secrets"/);
});

test("a path argument is rewritten through the guarded handle before the library sees it", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/note.txt", "from the tree");
  await t.script(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('Attach');
       m.attach({ path: '/inbox/note.txt' });
       return m.file.save('/out/attached.txt');
     }`,
  );
  assert.equal(await t.fs.readFile("/out/attached.txt"), "Attach\n[attached from the tree]");
});

test("a recording that never reaches a terminal produces nothing, and says so if asked to", async () => {
  const t = await env();
  // Building without finishing is not an error — it is simply inert.
  await t.script(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('never saved');
       m.add('x');
       return 'built';
     }`,
  );
  assert.deepEqual(await t.fs.readdir("/out"), []);
});

test("the prototype chain is not a route out of the sandbox", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo();
       return typeof m.constructor.constructor('return process')();
     }`,
  );
  assert.equal(run.ok, false);
  assert.doesNotMatch(String(run.result ?? ""), /object/);
});

test("assigning through the prototype is refused at replay", async () => {
  const t = await env();
  const run = await t.runScript(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo();
       m.__proto__ = { add: () => {} };
       return m.file.save('/out/x.txt');
     }`,
  );
  assert.equal(run.ok, false);
  assert.equal(await t.fs.exists("/out/x.txt"), false);
});

test("an allowlist containing an inherited name is refused at definition time", () => {
  // An allowlist that includes `constructor` is not an allowlist, and the
  // failure has to be at definition rather than at the call it lets through.
  assert.throws(
    () =>
      defineBuilder({
        name: "Bad",
        construct: () => ({}),
        allow: ["add", "constructor"],
        finish: { async save() { return null; } },
      }),
    /constructor/,
  );
  assert.throws(
    () =>
      defineBuilder({
        name: "Bad",
        construct: () => ({}),
        allow: ["__proto__"],
        finish: { async save() { return null; } },
      }),
    /allowlist/,
  );
});

test("a family member with neither construct nor singleton is refused", () => {
  assert.throws(
    () =>
      defineBuilders({
        family: "broken",
        members: { Thing: {} },
        allow: ["add"],
        finish: { async save() { return null; } },
      }),
    /neither construct\(\) nor singleton/,
  );
});

test("logging or interpolating a builder says what it is instead of throwing", async () => {
  // Measured six times in one eval run: a model building a debug string hit
  // "Cannot convert object to primitive value", because a recorder had no
  // toString, no valueOf and no Symbol.toPrimitive. Nothing about that is
  // the model's mistake.
  const t = await env();
  const seen = await t.script<{ interpolated: string; stringified: string }>(
    `import { Memo } from 'env:memo';
     export default async function main() {
       const m = new Memo('T');
       const s = m.section('Risks');
       return { interpolated: \`\${m}\`, stringified: String(s) };
     }`,
  );
  assert.match(seen.interpolated, /^\[Memo \(recording/);
  assert.match(seen.stringified, /^\[Memo \(recording/);
  // And it says why it has nothing to show.
  assert.match(seen.interpolated, /nothing is built until you await a terminal call/);
});
