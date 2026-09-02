import assert from "node:assert/strict";
import test from "node:test";
import { assertProviderOk, capabilitiesOf, verifyProvider } from "../src/provider";
import type { Provider } from "../src/provider";
import { createFake, COLLECTION, PAGE } from "./fake-provider";

test("a complete provider passes, and reports what it can do", async () => {
  const report = await verifyProvider(createFake(), { pageId: PAGE, collectionId: COLLECTION });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.capabilities.provider, "fake");
  assert.equal(report.capabilities.query, true);
  assert.equal(report.capabilities.files, true);
  assertProviderOk(report);
});

test("the two required methods are required", async () => {
  const report = await verifyProvider({ name: "thin" } as unknown as Provider);
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /getPage\(\) is required/);
  assert.match(report.errors.join("\n"), /listBlocks\(\) is required/);
  assert.throws(() => assertProviderOk(report), /does not satisfy the contract/);
});

test("a nameless provider is caught — its name is what its errors are attributed to", async () => {
  const report = await verifyProvider({ ...createFake(), name: "  " } as Provider);
  assert.match(report.errors.join("\n"), /name is empty/);
});

test("rows without a schema behind them is an error, not a style choice", async () => {
  const report = await verifyProvider(createFake({ without: ["getCollection"] }));
  assert.match(report.errors.join("\n"), /queryCollection\(\) without getCollection\(\)/);
});

test("a read-only provider is legitimate, and says so", async () => {
  const readOnly = createFake({ without: ["createPage", "updatePage", "appendBlocks", "updateBlock", "deleteBlock"] });
  const report = await verifyProvider(readOnly, { pageId: PAGE });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(capabilitiesOf(readOnly), {
    provider: "fake",
    identify: false,
    collections: true,
    query: true,
    search: true,
    files: true,
    create: false,
    update: false,
    append: false,
    editBlocks: false,
    deleteBlocks: false,
    request: true,
  });
});

test("no escape hatch is a warning, not a failure", async () => {
  const report = await verifyProvider(createFake({ without: ["request"] }), { pageId: PAGE });
  assert.equal(report.ok, true);
  assert.match(report.warnings.join("\n"), /no request\(\)/);
});

test("a provider that recurses on base's behalf is warned about", async () => {
  // Base walks the tree itself, so nesting here does the work twice and makes
  // the caller's `depth` mean nothing — invisible until a deep page.
  const eager = createFake();
  const original = eager.listBlocks.bind(eager);
  eager.listBlocks = async (id, opts) => {
    const page = await original(id, opts);
    return { ...page, blocks: page.blocks.map((b) => ({ ...b, children: [{ type: "paragraph", text: [{ text: "x" }] }] })) };
  };
  const report = await verifyProvider(eager, { pageId: PAGE });
  assert.equal(report.ok, true);
  assert.match(report.warnings.join("\n"), /walks the tree itself/);
});

test("a block with no type is caught — 'unsupported' is the answer, not omission", async () => {
  const sloppy = createFake();
  sloppy.listBlocks = async () => ({ blocks: [{ type: "" } as never] });
  const report = await verifyProvider(sloppy, { pageId: PAGE });
  assert.match(report.errors.join("\n"), /no type/);
});

test("a schema with no title column is caught", async () => {
  const sloppy = createFake();
  sloppy.getCollection = async () => ({ id: "x", name: "x", titleProperty: "", schema: { A: { type: "text" } } });
  const report = await verifyProvider(sloppy, { collectionId: COLLECTION });
  assert.match(report.errors.join("\n"), /no title column/);
});

test("a throwing provider is reported, not propagated", async () => {
  const broken = createFake();
  broken.getPage = async () => {
    throw new Error("upstream is down");
  };
  const report = await verifyProvider(broken, { pageId: PAGE });
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /threw: upstream is down/);
});
