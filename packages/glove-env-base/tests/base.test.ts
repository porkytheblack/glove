/**
 * The adapter, exercised the only way it is ever used: from inside a script,
 * across the realm bridge, against the guarded VFS. Calling `create()` and
 * poking the returned functions would test an object the model never touches.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertAdapterOk, createAdapterTestEnv } from "glove-working-environment/testing";
import { base } from "../src/index";
import { COLLECTION, CHILD, createFake, FILE_URL, PAGE, ROW, TODO_BLOCK, type FakeOptions } from "./fake-provider";

async function envWith(fakeOptions: FakeOptions = {}, adapterOptions = {}) {
  const fake = createFake(fakeOptions);
  const adapter = base({ provider: fake, ...adapterOptions });
  const t = await createAdapterTestEnv(adapter);
  return { t, fake, adapter };
}

test("the module describes itself accurately", async () => {
  const { t, adapter } = await envWith();
  try {
    const audit = await t.audit();
    assertAdapterOk(audit);
    assert.deepEqual(audit.bindings.sort(), [
      "blocks",
      "capabilities",
      "collections",
      "describe",
      "download",
      "pages",
      "request",
      "search",
    ]);
    assert.equal(adapter.skills?.length, 5);
    assert.match(adapter.description, /"fake" provider/);
  } finally {
    await t.env.close();
  }
});

test("base refuses a provider that cannot be read from", () => {
  assert.throws(() => base({ provider: { name: "thin" } as never }), /must implement getPage\(\)/);
  assert.throws(() => base({ provider: undefined as never }), /needs a provider/);
});

test("describe answers what a reference actually is", async () => {
  const { t } = await envWith();
  try {
    const [page, collection] = await t.script<Array<Record<string, unknown>>>(
      `
      import { describe } from 'env:base';
      export default async function main({ page, collection }) {
        return [await describe(page), await describe(collection)];
      }
    `,
      { page: "https://example.com/pages/page-launch", collection: COLLECTION },
    );

    assert.equal(page.kind, "page");
    assert.equal(page.title, "Launch plan");
    assert.equal(page.blocks, 10);

    assert.equal(collection.kind, "collection");
    assert.equal((collection.schema as Record<string, string>).Status, "status");
    // The columns the backend owns, named up front rather than discovered by
    // having a write refused.
    assert.deepEqual(collection.computed, ["Key", "Total"]);
  } finally {
    await t.env.close();
  }
});

test("a page reads as markdown, and an unknown block does not stop it", async () => {
  const { t } = await envWith();
  try {
    const page = await t.script<{ markdown: string; title: string; blocks: Array<{ type: string }> }>(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.read(id); }
    `,
      { id: PAGE },
    );

    assert.equal(page.title, "Launch plan");
    assert.match(page.markdown, /^# Overview/m);
    assert.match(page.markdown, /\[the spec\]\(https:\/\/example\.com\/spec\) — \*\*urgent\*\*/);
    assert.match(page.markdown, /- Parent bullet\n {2}- Nested bullet/);
    assert.match(page.markdown, /- \[ \] Port the fix/);
    assert.match(page.markdown, /```javascript\nconst x = 1;\n```/);
    assert.match(page.markdown, /<!-- unsupported block blk-u/);
    assert.match(page.markdown, /<!-- sticker_wall block blk-new: shipped last tuesday -->/);
    assert.match(page.markdown, /\| Region \| Revenue \|/);
    assert.ok(page.blocks.some((b) => b.type === "child_page"));
  } finally {
    await t.env.close();
  }
});

test("base paginates a block listing without the caller knowing", async () => {
  const { t, fake } = await envWith({ pageSize: 3 });
  try {
    const blocks = await t.script<unknown[]>(
      `
      import { blocks } from 'env:base';
      export default async function main({ id }) { return blocks.children(id, { depth: 1 }); }
    `,
      { id: PAGE },
    );
    assert.equal(blocks.length, 10);
    assert.equal(fake.calls.filter((c) => c.method === "listBlocks" && c.args[0] === PAGE).length, 4);
  } finally {
    await t.env.close();
  }
});

test("a walk that stops early says so rather than looking complete", async () => {
  const { t } = await envWith();
  try {
    const shallow = await t.script<{ truncated?: boolean }>(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.read(id, { depth: 1 }); }
    `,
      { id: PAGE },
    );
    assert.equal(shallow.truncated, true);

    const deep = await t.script<{ truncated?: boolean; markdown: string }>(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.read(id, { depth: 3 }); }
    `,
      { id: PAGE },
    );
    assert.equal(deep.truncated, undefined);
    assert.match(deep.markdown, /Nested bullet/);
  } finally {
    await t.env.close();
  }
});

test("rows come back as plain values, every page of them", async () => {
  const { t } = await envWith({ pageSize: 100 });
  try {
    const result = await t.script<{ count: number; first: Record<string, unknown>; done: number }>(
      `
      import { collections } from 'env:base';
      export default async function main({ id }) {
        const rows = await collections.query(id);
        return {
          count: rows.length,
          first: rows[0].properties,
          done: rows.filter((r) => r.properties.Status === 'Done').length,
        };
      }
    `,
      { id: COLLECTION },
    );

    assert.equal(result.count, 251);
    assert.equal(result.done, 84);
    assert.equal(result.first.Status, "Done");
    assert.deepEqual(result.first.Tags, ["infra", "urgent"]);
    assert.equal(result.first.Key, "BUG-42");
  } finally {
    await t.env.close();
  }
});

test("a filter the backend cannot apply is applied here, so the answer is still right", async () => {
  const { t, fake } = await envWith({ pageSize: 100 });
  try {
    const rows = await t.script<Array<{ properties: Record<string, unknown> }>>(
      `
      import { collections } from 'env:base';
      export default async function main({ id }) {
        return collections.query(id, {
          where: [{ property: 'Status', op: 'is', value: 'Done' }],
          sort: [{ property: 'Estimate', direction: 'desc' }],
          limit: 3,
        });
      }
    `,
      { id: COLLECTION },
    );

    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.properties.Status === "Done"));
    assert.deepEqual(
      rows.map((row) => row.properties.Estimate),
      [249, 246, 243],
    );
    // The limit was not pushed down: it cannot be, until the filter has been
    // applied to every row.
    const queries = fake.calls.filter((c) => c.method === "queryCollection");
    assert.ok(queries.length > 1, "every page was fetched before the filter ran");
  } finally {
    await t.env.close();
  }
});

test("a backend that can filter for itself is not second-guessed", async () => {
  const { t, fake } = await envWith({ pageSize: 100, pushDown: { where: true, sort: true } });
  try {
    await t.script(
      `
      import { collections } from 'env:base';
      export default async function main({ id }) {
        return collections.query(id, { where: [{ property: 'Status', op: 'is', value: 'Done' }], limit: 3 });
      }
    `,
      { id: COLLECTION },
    );
    // One page: the backend said it applied the filter, so the limit is real.
    assert.equal(fake.calls.filter((c) => c.method === "queryCollection").length, 1);
  } finally {
    await t.env.close();
  }
});

test("selecting columns drops the rest before they cost anything", async () => {
  const { t } = await envWith();
  try {
    const keys = await t.script<string[]>(
      `
      import { collections } from 'env:base';
      export default async function main({ id }) {
        const [row] = await collections.query(id, { limit: 1, properties: ['Name', 'Status'] });
        return Object.keys(row.properties);
      }
    `,
      { id: COLLECTION },
    );
    assert.deepEqual(keys.sort(), ["Name", "Status"]);
  } finally {
    await t.env.close();
  }
});

test("creating a row checks plain values against the schema", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) {
        return pages.create(id, {
          title: 'Ship the export path',
          properties: { Status: 'In progress', Due: '2026-09-30', Tags: ['infra'], Estimate: 3 },
          markdown: '## Context\\n\\n- [ ] port the fix',
        });
      }
    `,
      { id: COLLECTION },
    );

    const create = fake.calls.find((c) => c.method === "createPage");
    const [parent, input] = create!.args as [{ type: string; id: string }, { properties: Record<string, unknown>; blocks: Array<{ type: string }> }];
    assert.deepEqual(parent, { type: "collection", id: COLLECTION });
    assert.equal(input.properties.Status, "In progress");
    assert.deepEqual(input.properties.Due, { start: "2026-09-30" });
    assert.deepEqual(input.properties.Tags, ["infra"]);
    assert.equal(input.properties.Name, "Ship the export path", "title fills the title column");
    assert.deepEqual(input.blocks.map((b) => b.type), ["heading", "to_do"]);
  } finally {
    await t.env.close();
  }
});

test("a bad write fails before it reaches the provider", async () => {
  const { t, fake } = await envWith();
  try {
    for (const [values, pattern] of [
      [`{ Statuss: 'Done' }`, /no column named "Statuss"/],
      [`{ Status: 'done' }`, /expected one of "To do", "In progress", "Done"/],
      [`{ Key: 'BUG-9' }`, /the backend computes it and refuses writes/],
      [`{ Estimate: 'three' }`, /"Estimate" is a number column/],
    ] as const) {
      const failed = await t.runScript(
        `
        import { pages } from 'env:base';
        export default async function main({ id }) { return pages.create(id, { title: 'x', properties: ${values} }); }
      `,
        { id: COLLECTION },
      );
      assert.equal(failed.ok, false, values);
      assert.match(String(failed.error), pattern);
    }
    assert.equal(fake.calls.some((c) => c.method === "createPage"), false);
  } finally {
    await t.env.close();
  }
});

test("a page outside a collection has a title and nothing else", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.create({ pageId: id }, { title: 'Notes' }); }
    `,
      { id: PAGE },
    );
    const [parent] = fake.calls.find((c) => c.method === "createPage")!.args as [{ type: string }];
    assert.equal(parent.type, "page");

    const failed = await t.runScript(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) {
        return pages.create({ pageId: id }, { title: 'Notes', properties: { Status: 'Done' } });
      }
    `,
      { id: PAGE },
    );
    assert.match(String(failed.error), /not a row in a collection/);
  } finally {
    await t.env.close();
  }
});

test("a body longer than the chunk size still lands in one page", async () => {
  const { t, fake } = await envWith({}, { appendChunk: 20 });
  try {
    const markdown = Array.from({ length: 55 }, (_, i) => `- item ${i}`).join("\n");
    await t.script(
      `
      import { pages } from 'env:base';
      export default async function main({ id, markdown }) { return pages.create(id, { title: 'Long', markdown }); }
    `,
      { id: COLLECTION, markdown },
    );

    const [, input] = fake.calls.find((c) => c.method === "createPage")!.args as [unknown, { blocks: unknown[] }];
    assert.equal(input.blocks.length, 20);
    const appends = fake.calls.filter((c) => c.method === "appendBlocks");
    assert.deepEqual(appends.map((c) => (c.args[1] as unknown[]).length), [20, 15]);
  } finally {
    await t.env.close();
  }
});

test("updating touches only what was passed", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.update(id, { properties: { Status: 'Done' } }); }
    `,
      { id: ROW },
    );
    const [, patch] = fake.calls.find((c) => c.method === "updatePage")!.args as [string, Record<string, unknown>];
    assert.deepEqual(patch, { properties: { Status: "Done" } });

    await t.script(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) { return pages.update(id, { archived: true }); }
    `,
      { id: ROW },
    );
    const [, trash] = fake.calls.filter((c) => c.method === "updatePage").pop()!.args as [string, Record<string, unknown>];
    assert.deepEqual(trash, { archived: true });

    const nothing = await t.runScript(`
      import { pages } from 'env:base';
      export default async function main() { return pages.update('row-1', {}); }
    `);
    assert.match(String(nothing.error), /nothing to change/);
  } finally {
    await t.env.close();
  }
});

test("blocks are reachable as structure, raw or flattened, and editable in place", async () => {
  const { t, fake } = await envWith();
  try {
    const result = await t.script<{ open: number; flatText: string; rawSpans: number }>(
      `
      import { blocks } from 'env:base';
      export default async function main({ page, todo }) {
        const tree = await blocks.children(page, { depth: 2 });
        const raw = await blocks.children(page, { raw: true, depth: 1 });
        await blocks.update(todo, { checked: true });
        return {
          open: tree.filter((b) => b.type === 'to_do' && b.checked === false).length,
          flatText: tree.find((b) => b.type === 'paragraph').text,
          rawSpans: raw.find((b) => b.type === 'paragraph').text.length,
        };
      }
    `,
      { page: PAGE, todo: TODO_BLOCK },
    );

    assert.equal(result.open, 1);
    assert.equal(result.flatText, "See the spec — urgent");
    assert.equal(result.rawSpans, 4, "raw keeps the spans; flat keeps the words");
    assert.ok(fake.calls.some((c) => c.method === "updateBlock" && c.args[0] === TODO_BLOCK));
  } finally {
    await t.env.close();
  }
});

test("a page exports into the tree, subtree and attachments included", async () => {
  const { t } = await envWith();
  try {
    const out = await t.script<{ files: string[]; pages: number; assets: string[] }>(
      `
      import { pages } from 'env:base';
      export default async function main({ id }) {
        return pages.export(id, '/out/launch.md', { recursive: true, assets: true });
      }
    `,
      { id: PAGE },
    );

    assert.equal(out.pages, 2);
    assert.equal(out.files[0], "/out/launch.md");
    assert.equal(out.files[1], `/out/launch/${CHILD}.md`);
    assert.deepEqual(out.assets, ["/out/launch.assets/1-spec.pdf"]);

    const markdown = await t.fs.readFile("/out/launch.md");
    assert.match(markdown, /^# Launch plan/);
    // The signed URL is gone from the file; the local path took its place.
    assert.equal(markdown.includes("files.example.com"), false);
    assert.match(markdown, /\/out\/launch\.assets\/1-spec\.pdf/);

    assert.match(await t.fs.readFile(out.files[1]), /Child body/);
    assert.deepEqual(Array.from(await t.fs.readBytes(out.assets[0])), [0x25, 0x50, 0x44, 0x46, 0x2d]);
  } finally {
    await t.env.close();
  }
});

test("download goes through the provider, and reports an expired URL as one", async () => {
  const { t, fake } = await envWith();
  try {
    const path = await t.script<string>(
      `
      import { download } from 'env:base';
      export default async function main({ url }) { return download(url, '/tmp/spec.pdf'); }
    `,
      { url: FILE_URL },
    );
    assert.equal(path, "/tmp/spec.pdf");
    assert.ok(fake.calls.some((c) => c.method === "fetchFile"));

    fake.files.delete(FILE_URL);
    const failed = await t.runScript(
      `
      import { download } from 'env:base';
      export default async function main({ url }) { return download(url, '/tmp/again.pdf'); }
    `,
      { url: FILE_URL },
    );
    assert.match(String(failed.error), /signed and short-lived/);
    assert.match(String(failed.error), /fake/, "the provider is named");
  } finally {
    await t.env.close();
  }
});

test("a capability the backend lacks is named, not crashed into", async () => {
  // A read-only backend is a normal backend. The failure has to say which
  // method is missing from which provider, or a script has no way to adapt.
  const { t } = await envWith({ without: ["createPage", "fetchFile", "request", "queryCollection"] });
  try {
    const capabilities = await t.script<Record<string, boolean>>(`
      import { capabilities } from 'env:base';
      export default async function main() { return capabilities(); }
    `);
    assert.equal(capabilities.create, false);
    assert.equal(capabilities.files, false);
    assert.equal(capabilities.query, false);
    assert.equal(capabilities.collections, true);

    for (const [source, pattern] of [
      [`pages.create('${COLLECTION}', { title: 'x' })`, /does not implement createPage\(\)/],
      [`download('${FILE_URL}', '/tmp/x')`, /does not implement fetchFile\(\)/],
      [`request('GET', '/x')`, /does not implement request\(\)/],
      [`collections.query('${COLLECTION}')`, /does not implement queryCollection\(\)/],
      [`pages.export('${PAGE}', '/out/x.md', { assets: true })`, /does not implement fetchFile\(\)/],
    ] as const) {
      const failed = await t.runScript(`
        import { pages, collections, download, request } from 'env:base';
        export default async function main() { return ${source}; }
      `);
      assert.equal(failed.ok, false, source);
      assert.match(String(failed.error), pattern);
      assert.match(String(failed.error), /provider "fake"/);
    }
  } finally {
    await t.env.close();
  }
});

test("without identify(), base probes rather than demanding one", async () => {
  const { t, fake } = await envWith();
  try {
    const kind = await t.script<{ kind: string }>(
      `
      import { describe } from 'env:base';
      export default async function main({ id }) { return describe(id); }
    `,
      { id: COLLECTION },
    );
    assert.equal(kind.kind, "collection");
    // Page first, because that is the common case; the collection lookup is
    // the fallback, not the other way round.
    assert.deepEqual(
      fake.calls.slice(0, 2).map((c) => c.method),
      ["getPage", "getCollection"],
    );
  } finally {
    await t.env.close();
  }
});

test("identify(), when a provider has one, replaces the probe", async () => {
  const { t, fake } = await envWith();
  fake.identify = async (id: string) => {
    fake.calls.push({ method: "identify", args: [id] });
    return id === COLLECTION ? "collection" : "page";
  };
  const adapter = base({ provider: fake });
  const t2 = await createAdapterTestEnv(adapter);
  try {
    await t2.script(
      `
      import { describe } from 'env:base';
      export default async function main({ id }) { return describe(id); }
    `,
      { id: COLLECTION },
    );
    assert.equal(fake.calls[0].method, "identify");
    assert.equal(fake.calls.some((c) => c.method === "getPage"), false);
  } finally {
    await t2.env.close();
    await t.env.close();
  }
});

test("a failing provider call names the provider and the method", async () => {
  const { t, fake } = await envWith();
  try {
    fake.getPage = async () => {
      throw new Error("upstream is down");
    };
    const failed = await t.runScript(`
      import { pages } from 'env:base';
      export default async function main() { return pages.get('page-launch'); }
    `);
    assert.match(String(failed.error), /getPage: upstream is down/);
    assert.match(String(failed.error), /env:base/, "and the module it came from");
  } finally {
    await t.env.close();
  }
});

test("search and the escape hatch reach the provider unchanged", async () => {
  const { t } = await envWith();
  try {
    const hits = await t.script<Array<{ title: string }>>(`
      import { search } from 'env:base';
      export default async function main() { return search('launch'); }
    `);
    assert.deepEqual(hits.map((h) => h.title), ["Launch plan"]);

    const raw = await t.script<{ method: string; path: string }>(`
      import { request } from 'env:base';
      export default async function main() { return request('PATCH', '/blocks/x', { checked: true }); }
    `);
    assert.deepEqual(raw, { method: "PATCH", path: "/blocks/x", body: { checked: true } });
  } finally {
    await t.env.close();
  }
});

test("two backends can be mounted side by side", async () => {
  // The module name is an option, so `env:wiki` and `env:crm` are one adapter
  // twice rather than a second package.
  const wiki = base({ provider: createFake(), name: "wiki" });
  const t = await createAdapterTestEnv(wiki);
  try {
    assert.equal(wiki.name, "wiki");
    const page = await t.script<{ title: string }>(
      `
      import { pages } from 'env:wiki';
      export default async function main({ id }) { return pages.get(id); }
    `,
      { id: PAGE },
    );
    assert.equal(page.title, "Launch plan");
  } finally {
    await t.env.close();
  }
});
