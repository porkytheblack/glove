/**
 * The adapter, exercised the only way it is ever used: from inside a script,
 * across the realm bridge, against the guarded VFS. Calling `create()` and
 * poking the returned functions would test an object the model never touches.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertAdapterOk, createAdapterTestEnv } from "glove-working-environment/testing";
import { notion } from "../src/index";
import { createFake, DB_ID, DS_ID, PAGE_ID, PDF_BLOCK_ID, ROW_ID, TODO_BLOCK_ID, TWO_DS_DB_ID, CHILD_ID } from "./fake";

async function envWith(fake = createFake(), options = {}) {
  const adapter = notion({ token: "secret_x", fetch: fake.fetch, sleep: async () => {}, ...options });
  const t = await createAdapterTestEnv(adapter);
  return { t, fake, adapter };
}

test("the module describes itself accurately", async () => {
  const { t, adapter } = await envWith();
  try {
    const audit = await t.audit();
    assertAdapterOk(audit);
    assert.deepEqual(
      audit.bindings.sort(),
      ["blocks", "dataSources", "databases", "describe", "download", "pages", "request", "search"],
    );
    assert.equal(adapter.skills?.length, 5);
  } finally {
    await t.env.close();
  }
});

test("describe answers what a pasted link actually is", async () => {
  const { t } = await envWith();
  try {
    const [page, database, dataSource] = await t.script<Array<Record<string, unknown>>>(`
      import { describe } from 'env:notion';
      export default async function main({ page, database, dataSource }) {
        return [await describe(page), await describe(database), await describe(dataSource)];
      }
    `, { page: `https://www.notion.so/Launch-plan-${PAGE_ID.replace(/-/g, "")}`, database: DB_ID, dataSource: DS_ID });

    assert.equal(page.object, "page");
    assert.equal(page.title, "Launch plan");
    assert.equal(page.blocks, 9);

    assert.equal(database.object, "database");
    assert.deepEqual(database.dataSources, [{ id: DS_ID, name: "Tasks" }]);

    assert.equal(dataSource.object, "data_source");
    assert.equal((dataSource.properties as Record<string, string>).Status, "status");
    assert.deepEqual(dataSource.parent, { type: "database", id: DB_ID });
  } finally {
    await t.env.close();
  }
});

test("a page reads as markdown, and an unsupported block does not stop it", async () => {
  const { t } = await envWith();
  try {
    const page = await t.script<{ markdown: string; title: string; blocks: Array<{ type: string }> }>(`
      import { pages } from 'env:notion';
      export default async function main({ id }) { return pages.read(id); }
    `, { id: PAGE_ID });

    assert.equal(page.title, "Launch plan");
    assert.match(page.markdown, /^# Overview/m);
    assert.match(page.markdown, /\[the spec\]\(https:\/\/example\.com\/spec\) — \*\*urgent\*\*/);
    assert.match(page.markdown, /- Parent bullet\n {2}- Nested bullet/);
    assert.match(page.markdown, /- \[ \] Port the fix/);
    assert.match(page.markdown, /```javascript\nconst x = 1;\n```/);
    assert.match(page.markdown, /<!-- unsupported block /);
    assert.match(page.markdown, /\| Region \| Revenue \|/);
    assert.ok(page.blocks.some((b) => b.type === "child_page"));
  } finally {
    await t.env.close();
  }
});

test("rows come back as plain values, every page of them", async () => {
  const { t } = await envWith();
  try {
    const result = await t.script<{ count: number; first: Record<string, unknown>; done: number }>(`
      import { dataSources } from 'env:notion';
      export default async function main({ id }) {
        const rows = await dataSources.query(id);
        return {
          count: rows.length,
          first: rows[0].properties,
          done: rows.filter((r) => r.properties.Status === 'Done').length,
        };
      }
    `, { id: DS_ID });

    assert.equal(result.count, 250);
    assert.equal(result.done, 84);
    assert.equal(result.first.Status, "Done");
    assert.deepEqual(result.first.Tags, ["infra", "urgent"]);
    assert.deepEqual(result.first.Due, { start: "2026-09-30" });
    assert.equal(result.first.Key, "BUG-42");
  } finally {
    await t.env.close();
  }
});

test("a database id resolves to its data source — unless there are two", async () => {
  const { t } = await envWith();
  try {
    const rows = await t.script<unknown[]>(`
      import { dataSources } from 'env:notion';
      export default async function main({ id }) { return dataSources.query(id, { limit: 3 }); }
    `, { id: DB_ID });
    assert.equal(rows.length, 3);

    const failed = await t.runScript(`
      import { dataSources } from 'env:notion';
      export default async function main({ id }) { return dataSources.query(id); }
    `, { id: TWO_DS_DB_ID });
    assert.equal(failed.ok, false);
    assert.match(String(failed.error), /holds 2 data sources/);
    assert.match(String(failed.error), /Current .*Archive/s);
  } finally {
    await t.env.close();
  }
});

test("selecting columns drops the rest before they cost anything", async () => {
  const { t } = await envWith();
  try {
    const keys = await t.script<string[]>(`
      import { dataSources } from 'env:notion';
      export default async function main({ id }) {
        const [row] = await dataSources.query(id, { limit: 1, properties: ['Name', 'Status'] });
        return Object.keys(row.properties);
      }
    `, { id: DS_ID });
    assert.deepEqual(keys.sort(), ["Name", "Status"]);
  } finally {
    await t.env.close();
  }
});

test("creating a row coerces plain values against the schema", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(`
      import { pages } from 'env:notion';
      export default async function main({ id }) {
        return pages.create(id, {
          title: 'Ship the export path',
          properties: { Status: 'In progress', Due: '2026-09-30', Tags: ['infra'], Estimate: 3 },
          markdown: '## Context\\n\\n- [ ] port the fix',
        });
      }
    `, { id: DS_ID });

    const create = fake.calls.find((c) => c.method === "POST" && c.path === "/pages");
    const body = create?.body as {
      parent: Record<string, string>;
      properties: Record<string, Record<string, unknown>>;
      children: Array<{ type: string }>;
    };
    assert.deepEqual(body.parent, { type: "data_source_id", data_source_id: DS_ID });
    assert.deepEqual(body.properties.Status, { status: { name: "In progress" } });
    assert.deepEqual(body.properties.Due, { date: { start: "2026-09-30" } });
    assert.deepEqual(body.properties.Tags, { multi_select: [{ name: "infra" }] });
    assert.deepEqual(body.children.map((b) => b.type), ["heading_2", "to_do"]);
  } finally {
    await t.env.close();
  }
});

test("a column that does not exist fails before the request goes out", async () => {
  const { t, fake } = await envWith();
  try {
    const failed = await t.runScript(`
      import { pages } from 'env:notion';
      export default async function main({ id }) {
        return pages.create(id, { title: 'x', properties: { Statuss: 'Done' } });
      }
    `, { id: DS_ID });
    assert.equal(failed.ok, false);
    assert.match(String(failed.error), /no property named "Statuss"/);
    assert.match(String(failed.error), /this data source has Name, Status/);
    assert.equal(fake.calls.some((c) => c.method === "POST" && c.path === "/pages"), false);
  } finally {
    await t.env.close();
  }
});

test("a computed column is refused with the reason", async () => {
  const { t } = await envWith();
  try {
    const failed = await t.runScript(`
      import { pages } from 'env:notion';
      export default async function main({ id }) {
        return pages.update(id, { properties: { Key: 'BUG-9' } });
      }
    `, { id: ROW_ID });
    assert.match(String(failed.error), /Notion computes it and refuses writes/);
  } finally {
    await t.env.close();
  }
});

test("a body longer than the API's child limit still lands in one page", async () => {
  const { t, fake } = await envWith();
  try {
    const markdown = Array.from({ length: 150 }, (_, i) => `- item ${i}`).join("\n");
    await t.script(`
      import { pages } from 'env:notion';
      export default async function main({ id, markdown }) { return pages.create(id, { title: 'Long', markdown }); }
    `, { id: DS_ID, markdown });

    const create = fake.calls.find((c) => c.method === "POST" && c.path === "/pages");
    assert.equal((create?.body as { children: unknown[] }).children.length, 100);
    const appends = fake.calls.filter((c) => c.method === "PATCH" && c.path.endsWith("/children"));
    assert.equal(appends.length, 1);
    assert.equal((appends[0].body as { children: unknown[] }).children.length, 50);
  } finally {
    await t.env.close();
  }
});

test("updating touches only what was passed", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(`
      import { pages } from 'env:notion';
      export default async function main({ id }) { return pages.update(id, { properties: { Status: 'Done' } }); }
    `, { id: ROW_ID });
    const patch = fake.calls.find((c) => c.method === "PATCH" && c.path === `/pages/${ROW_ID}`);
    assert.deepEqual((patch?.body as { properties: unknown }).properties, { Status: { status: { name: "Done" } } });

    await t.script(`
      import { pages } from 'env:notion';
      export default async function main({ id }) { return pages.update(id, { archived: true }); }
    `, { id: ROW_ID });
    const trash = fake.calls.filter((c) => c.method === "PATCH" && c.path === `/pages/${ROW_ID}`).pop();
    assert.deepEqual(trash?.body, { in_trash: true });
  } finally {
    await t.env.close();
  }
});

test("a page created under a page has no columns to set", async () => {
  const { t, fake } = await envWith();
  try {
    await t.script(`
      import { pages } from 'env:notion';
      export default async function main({ id }) { return pages.create({ pageId: id }, { title: 'Notes' }); }
    `, { id: PAGE_ID });
    const create = fake.calls.find((c) => c.method === "POST" && c.path === "/pages");
    assert.deepEqual((create?.body as { parent: unknown }).parent, { type: "page_id", page_id: PAGE_ID });

    const failed = await t.runScript(`
      import { pages } from 'env:notion';
      export default async function main({ id }) {
        return pages.create({ pageId: id }, { title: 'Notes', properties: { Status: 'Done' } });
      }
    `, { id: PAGE_ID });
    assert.match(String(failed.error), /has no schema/);
  } finally {
    await t.env.close();
  }
});

test("blocks are reachable as structure, and editable in place", async () => {
  const { t, fake } = await envWith();
  try {
    const result = await t.script<{ unchecked: number; rawKeys: string[] }>(`
      import { blocks } from 'env:notion';
      export default async function main({ page, todo }) {
        const tree = await blocks.children(page, { depth: 2 });
        const raw = await blocks.children(page, { raw: true, depth: 1 });
        await blocks.update(todo, { to_do: { checked: true } });
        return {
          unchecked: tree.filter((b) => b.type === 'to_do' && b.checked === false).length,
          rawKeys: Object.keys(raw[0]),
        };
      }
    `, { page: PAGE_ID, todo: TODO_BLOCK_ID });

    assert.equal(result.unchecked, 1);
    assert.ok(result.rawKeys.includes("heading_1"), "raw blocks keep the API's own payload");
    assert.ok(fake.calls.some((c) => c.method === "PATCH" && c.path === `/blocks/${TODO_BLOCK_ID}`));
  } finally {
    await t.env.close();
  }
});

test("a walk that stops early says so rather than looking complete", async () => {
  const { t } = await envWith();
  try {
    const page = await t.script<{ truncated?: boolean }>(`
      import { pages } from 'env:notion';
      export default async function main({ id }) { return pages.read(id, { depth: 1 }); }
    `, { id: PAGE_ID });
    assert.equal(page.truncated, true);
  } finally {
    await t.env.close();
  }
});

test("a page exports into the tree, subtree and attachments included", async () => {
  const { t } = await envWith();
  try {
    const out = await t.script<{ files: string[]; pages: number; assets: string[] }>(`
      import { pages } from 'env:notion';
      export default async function main({ id }) {
        return pages.export(id, '/out/launch.md', { recursive: true, assets: true });
      }
    `, { id: PAGE_ID });

    assert.equal(out.pages, 2);
    assert.equal(out.files[0], "/out/launch.md");
    assert.equal(out.files[1], `/out/launch/${CHILD_ID.replace(/-/g, "")}.md`);
    assert.deepEqual(out.assets, ["/out/launch.assets/1-spec.pdf"]);

    const markdown = await t.fs.readFile("/out/launch.md");
    assert.match(markdown, /^# Launch plan/);
    // The signed URL is gone from the file; the local path took its place.
    assert.equal(markdown.includes("file.notion.so"), false);
    assert.match(markdown, /\/out\/launch\.assets\/1-spec\.pdf/);

    assert.match(await t.fs.readFile(out.files[1]), /Child body/);
    assert.deepEqual(Array.from(await t.fs.readBytes("/out/launch.assets/1-spec.pdf")), [0x25, 0x50, 0x44, 0x46, 0x2d]);
  } finally {
    await t.env.close();
  }
});

test("download is not a general fetch", async () => {
  // The environment has no network by construction. This binding must not
  // quietly hand one back.
  const { t } = await envWith();
  try {
    const denied = await t.runScript(`
      import { download } from 'env:notion';
      export default async function main() { return download('https://internal.example/secrets', '/tmp/x'); }
    `);
    assert.match(String(denied.error), /refusing to fetch from internal\.example/);

    const insecure = await t.runScript(`
      import { download } from 'env:notion';
      export default async function main() { return download('http://file.notion.so/a', '/tmp/x'); }
    `);
    assert.match(String(insecure.error), /https only/);
  } finally {
    await t.env.close();
  }
});

test("a widened allowlist is honoured, and a wildcard matches only subdomains", async () => {
  const fake = createFake();
  fake.files.set("https://files.example.com/a.bin", new Uint8Array([1, 2, 3]));
  const { t } = await envWith(fake, { allowHosts: ["*.example.com"] });
  try {
    const path = await t.script<string>(`
      import { download } from 'env:notion';
      export default async function main() { return download('https://files.example.com/a.bin', '/tmp/a.bin'); }
    `);
    assert.deepEqual(Array.from(await t.fs.readBytes(path)), [1, 2, 3]);

    const bare = await t.runScript(`
      import { download } from 'env:notion';
      export default async function main() { return download('https://example.com/a.bin', '/tmp/b.bin'); }
    `);
    assert.match(String(bare.error), /refusing to fetch/);
  } finally {
    await t.env.close();
  }
});

test("an expired file URL says what to do about it", async () => {
  const fake = createFake();
  fake.files.delete("https://file.notion.so/f/spec.pdf?sig=abc");
  const { t } = await envWith(fake);
  try {
    const failed = await t.runScript(`
      import { download } from 'env:notion';
      export default async function main() {
        return download('https://file.notion.so/f/spec.pdf?sig=abc', '/tmp/spec.pdf');
      }
    `);
    assert.match(String(failed.error), /signed and\s+short-lived/);
  } finally {
    await t.env.close();
  }
});

test("search reaches titles, and a database is created with a title column either way", async () => {
  const { t, fake } = await envWith();
  try {
    const hits = await t.script<Array<{ title: string }>>(`
      import { search } from 'env:notion';
      export default async function main() { return search('launch'); }
    `);
    assert.deepEqual(hits.map((h) => h.title), ["Launch plan"]);

    await t.script(`
      import { databases } from 'env:notion';
      export default async function main({ id }) {
        return databases.create({ parentPageId: id, title: 'Bugs', properties: { Status: 'select' } });
      }
    `, { id: PAGE_ID });
    const create = fake.calls.find((c) => c.method === "POST" && c.path === "/databases");
    const properties = (create?.body as { initial_data_source: { properties: Record<string, unknown> } })
      .initial_data_source.properties;
    assert.deepEqual(properties.Status, { select: {} });
    assert.deepEqual(properties.Name, { title: {} }, "a data source without a title column is not a data source");
  } finally {
    await t.env.close();
  }
});

test("request is the way through when a binding does not exist", async () => {
  const { t } = await envWith();
  try {
    const raw = await t.script<{ id: string }>(`
      import { request } from 'env:notion';
      export default async function main({ id }) { return request('GET', '/blocks/' + id); }
    `, { id: PDF_BLOCK_ID });
    assert.equal(raw.id, PDF_BLOCK_ID);
  } finally {
    await t.env.close();
  }
});

test("an id nothing answers to is named as such", async () => {
  const { t } = await envWith();
  try {
    const failed = await t.runScript(`
      import { describe } from 'env:notion';
      export default async function main() { return describe('00000000000000000000000000000000'); }
    `);
    assert.match(String(failed.error), /nothing in this workspace answers to/);
    assert.match(String(failed.error), /has not been given access/);
  } finally {
    await t.env.close();
  }
});

test("a failing capability names the module it came from", async () => {
  const { t } = await envWith();
  try {
    const failed = await t.runScript(`
      import { pages } from 'env:notion';
      export default async function main() { return pages.get('not-an-id'); }
    `);
    assert.match(String(failed.error), /env:notion/);
  } finally {
    await t.env.close();
  }
});
