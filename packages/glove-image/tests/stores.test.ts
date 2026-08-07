import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffImage, fromDataUrl, toDataUrl } from "../src/core/index";
import { InMemoryImageAssetStore, InMemoryImageLibrary } from "../src/in-memory/index";

// 1x1 red PNG.
export const PNG_1x1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

test("sniffImage reads PNG dimensions from bytes", () => {
  const sniffed = sniffImage(PNG_1x1);
  assert.ok(sniffed);
  assert.equal(sniffed.mime, "image/png");
  assert.equal(sniffed.width, 1);
  assert.equal(sniffed.height, 1);
});

test("sniffImage reads GIF dimensions and rejects unknown bytes", () => {
  const gif = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x03, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
  ]);
  const sniffed = sniffImage(gif);
  assert.ok(sniffed);
  assert.equal(sniffed.mime, "image/gif");
  assert.equal(sniffed.width, 3);
  assert.equal(sniffed.height, 2);
  assert.equal(sniffImage(new Uint8Array(20)), null);
});

test("data URL round trip", () => {
  const url = toDataUrl(PNG_1x1, "image/png");
  const back = fromDataUrl(url);
  assert.equal(back.mime, "image/png");
  assert.deepEqual(back.bytes, PNG_1x1);
});

test("asset store: put/get/bytes/list/remove with filters", async () => {
  const store = new InMemoryImageAssetStore();
  const a = await store.put(PNG_1x1, {
    name: "red-dot",
    mime: "image/png",
    width: 1,
    height: 1,
    source: "imported",
    tags: ["test", "red"],
  });
  const b = await store.put(PNG_1x1, {
    mime: "image/png",
    width: 1,
    height: 1,
    source: "generated",
  });

  assert.ok(a.id.startsWith("img_"));
  assert.equal((await store.get(a.id))?.name, "red-dot");
  assert.deepEqual(await store.bytes(a.id), PNG_1x1);

  assert.equal((await store.list()).length, 2);
  assert.deepEqual((await store.list({ source: "generated" })).map((x) => x.id), [b.id]);
  assert.deepEqual((await store.list({ tags: ["red"] })).map((x) => x.id), [a.id]);
  assert.deepEqual((await store.list({ name_contains: "RED" })).map((x) => x.id), [a.id]);

  await store.remove(a.id);
  assert.equal(await store.get(a.id), null);
  await assert.rejects(store.bytes(a.id), /not found/);
});

test("library: character and scene upsert/list/remove", async () => {
  const lib = new InMemoryImageLibrary();
  await lib.saveCharacter({
    name: "mira",
    appearance: "a wiry sky-courier",
    tags: ["hero"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  await lib.saveScene({
    name: "neon-market",
    setting: "a neon market at night",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  assert.equal((await lib.getCharacter("mira"))?.appearance, "a wiry sky-courier");
  assert.equal((await lib.listCharacters({ tags: ["hero"] })).length, 1);
  assert.equal((await lib.listCharacters({ tags: ["villain"] })).length, 0);
  assert.equal((await lib.listScenes({ name_contains: "neon" })).length, 1);

  await lib.removeCharacter("mira");
  assert.equal(await lib.getCharacter("mira"), null);
});
