/**
 * A provider, in memory.
 *
 * The seam base is built around is the {@link Provider} contract, so that is
 * what the tests exercise: a backend that answers in the model's own shapes,
 * paginates the way a real one paginates, pushes down only some of a query,
 * and can be built missing any capability so the "this backend cannot do that"
 * paths are real rather than asserted about.
 */
import type {
  Block,
  Collection,
  Page,
  Query,
  QueryResult,
  Ref,
} from "../src/model";
import type { PageInput, PagePatch, ParentRef, Provider, SearchOptions, SearchResult } from "../src/provider";

export const PAGE = "page-launch";
export const CHILD = "page-rollout";
export const COLLECTION = "col-tasks";
export const ROW = "row-1";
export const TODO_BLOCK = "blk-todo";
export const FILE_URL = "https://files.example.com/spec.pdf?sig=abc";

export interface FakeCall {
  method: string;
  args: unknown[];
}

export interface FakeOptions {
  /** Drop these capabilities, to exercise the unsupported paths. */
  without?: Array<keyof Provider>;
  /** Blocks per listBlocks page. Default 100 — set it low to force pagination. */
  pageSize?: number;
  /**
   * What the backend can filter for itself. Anything else comes back in
   * `unsupported` and base finishes the job.
   */
  pushDown?: { where?: boolean; sort?: boolean };
}

export interface Fake extends Provider {
  calls: FakeCall[];
  pages: Map<string, Page>;
  blocks: Map<string, Block[]>;
  collections: Map<string, Collection>;
  rows: Map<string, Page[]>;
  files: Map<string, Uint8Array>;
}

const text = (value: string) => [{ text: value }];

export function createFake(options: FakeOptions = {}): Fake {
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const pushWhere = options.pushDown?.where ?? false;
  const pushSort = options.pushDown?.sort ?? false;
  const calls: FakeCall[] = [];

  const pages = new Map<string, Page>();
  const blocks = new Map<string, Block[]>();
  const collections = new Map<string, Collection>();
  const rows = new Map<string, Page[]>();
  const files = new Map<string, Uint8Array>();

  // ------------------------------------------------------------- seed

  pages.set(PAGE, {
    id: PAGE,
    title: "Launch plan",
    url: "https://example.com/launch",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    parent: { type: "workspace" },
  });
  pages.set(CHILD, { id: CHILD, title: "Rollout", parent: { type: "page", id: PAGE } });

  blocks.set(PAGE, [
    { id: "blk-h", type: "heading", level: 1, text: text("Overview") },
    {
      id: "blk-p",
      type: "paragraph",
      text: [
        { text: "See " },
        { text: "the spec", href: "https://example.com/spec" },
        { text: " — " },
        { text: "urgent", annotations: { bold: true } },
      ],
    },
    { id: "blk-b", type: "bulleted_list_item", text: text("Parent bullet"), hasChildren: true },
    { id: TODO_BLOCK, type: "to_do", text: text("Port the fix"), checked: false },
    { id: "blk-c", type: "code", language: "javascript", text: text("const x = 1;") },
    { id: "blk-u", type: "unsupported" },
    { id: "blk-new", type: "sticker_wall", text: text("shipped last tuesday") },
    { id: CHILD, type: "child_page", title: "Rollout" },
    { id: "blk-f", type: "file", url: FILE_URL, caption: text("the spec"), expiresAt: "2026-09-01T11:00:00.000Z" },
    { id: "blk-t", type: "table", columns: 2, hasHeader: true, hasChildren: true },
  ]);
  blocks.set("blk-b", [{ id: "blk-b1", type: "bulleted_list_item", text: text("Nested bullet") }]);
  blocks.set("blk-t", [
    { id: "blk-t1", type: "table_row", cells: [text("Region"), text("Revenue")] },
    { id: "blk-t2", type: "table_row", cells: [text("EMEA"), text("2.4M")] },
  ]);
  blocks.set(CHILD, [{ id: "blk-cb", type: "paragraph", text: text("Child body") }]);

  collections.set(COLLECTION, {
    id: COLLECTION,
    name: "Tasks",
    parent: { type: "page", id: PAGE },
    titleProperty: "Name",
    schema: {
      Name: { type: "title" },
      Status: { type: "status", options: ["To do", "In progress", "Done"] },
      Tags: { type: "multiSelect", options: ["infra", "urgent"] },
      Due: { type: "date" },
      Owner: { type: "people" },
      Estimate: { type: "number" },
      Link: { type: "url" },
      Ref: { type: "relation" },
      Key: { type: "uniqueId" },
      Total: { type: "rollup" },
      Shipped: { type: "checkbox" },
      Mood: { type: "vibe" },
    },
  });

  // 250 rows, so pagination is genuinely exercised rather than asserted about.
  rows.set(
    COLLECTION,
    Array.from({ length: 250 }, (_, i) => makeRow(`row-${i}`, `Task ${i}`, i % 3 === 0 ? "Done" : "In progress", i)),
  );
  const seededRow = makeRow(ROW, "Ship the export path", "In progress", 7);
  rows.get(COLLECTION)!.push(seededRow);
  pages.set(ROW, seededRow);
  blocks.set(ROW, [{ id: "blk-row", type: "paragraph", text: text("Row body") }]);

  files.set(FILE_URL, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

  // ---------------------------------------------------------- provider

  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });

  const fake: Fake = {
    name: "fake",
    calls,
    pages,
    blocks,
    collections,
    rows,
    files,

    parseRef(input) {
      // A URL carries the id in its last segment; anything else is already one.
      return /^https?:\/\//i.test(input) ? (input.split("?")[0].split("/").pop() ?? input) : input;
    },

    async getPage(id) {
      record("getPage", id);
      const page = pages.get(id);
      if (!page) throw new Error(`no page ${id}`);
      return structuredClone(page);
    },

    async listBlocks(parentId, opts) {
      record("listBlocks", parentId, opts);
      const all = blocks.get(parentId) ?? [];
      const from = Number(opts?.cursor ?? 0);
      const slice = all.slice(from, from + pageSize).map((block) => ({
        ...structuredClone(block),
        hasChildren: block.hasChildren ?? (blocks.get(block.id!) ?? []).length > 0,
      }));
      const next = from + pageSize;
      return { blocks: slice, ...(next < all.length ? { cursor: String(next) } : {}) };
    },

    async getCollection(id) {
      record("getCollection", id);
      const collection = collections.get(id);
      if (!collection) throw new Error(`no collection ${id}`);
      return structuredClone(collection);
    },

    async queryCollection(id, query): Promise<QueryResult> {
      record("queryCollection", id, query);
      const all = rows.get(id) ?? [];
      const from = Number(query.cursor ?? 0);
      const slice = all.slice(from, from + pageSize).map((row) => structuredClone(row));
      const next = from + pageSize;
      // Push down nothing by default. Declaring it is what lets base finish
      // the job — a provider that lied here would return wrong rows.
      const unsupported: QueryResult["unsupported"] = {};
      if (!pushWhere && query.where?.length) unsupported.where = query.where;
      if (!pushSort && query.sort?.length) unsupported.sort = query.sort;
      return {
        rows: slice,
        ...(next < all.length ? { cursor: String(next) } : {}),
        ...(Object.keys(unsupported).length > 0 ? { unsupported } : {}),
      };
    },

    async search(query, opts?: SearchOptions): Promise<SearchResult> {
      record("search", query, opts);
      const needle = query.toLowerCase();
      return {
        hits: [...pages.values()]
          .filter((page) => page.title.toLowerCase().includes(needle))
          .map((page) => ({ id: page.id, kind: "page" as const, title: page.title, ...(page.url ? { url: page.url } : {}) })),
      };
    },

    async fetchFile(url) {
      record("fetchFile", url);
      const bytes = files.get(url);
      if (!bytes) throw new Error(`this URL is signed and short-lived; re-read the page for a fresh one`);
      return { bytes, contentType: "application/pdf" };
    },

    async createPage(parent: ParentRef, input: PageInput) {
      record("createPage", parent, input);
      const id = `made-${pages.size}`;
      const page: Page = {
        id,
        title: input.title ?? "Untitled",
        parent: { type: parent.type, id: parent.id },
        ...(parent.type === "collection" ? { collectionId: parent.id } : {}),
        properties: (input.properties ?? {}) as Page["properties"],
      };
      pages.set(id, page);
      blocks.set(id, [...(input.blocks ?? [])]);
      if (parent.type === "collection") rows.get(parent.id)?.push(page);
      return structuredClone(page);
    },

    async updatePage(id, patch: PagePatch) {
      record("updatePage", id, patch);
      const page = pages.get(id);
      if (!page) throw new Error(`no page ${id}`);
      const merged: Page = {
        ...page,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        properties: { ...(page.properties ?? {}), ...((patch.properties ?? {}) as Page["properties"]) },
      };
      pages.set(id, merged);
      return structuredClone(merged);
    },

    async appendBlocks(parentId, incoming) {
      record("appendBlocks", parentId, incoming);
      blocks.set(parentId, [...(blocks.get(parentId) ?? []), ...incoming]);
      return incoming.length;
    },

    async updateBlock(id, patch) {
      record("updateBlock", id, patch);
      for (const list of blocks.values()) {
        const found = list.find((block) => block.id === id);
        if (found) return { ...found, ...patch };
      }
      throw new Error(`no block ${id}`);
    },

    async deleteBlock(id) {
      record("deleteBlock", id);
      for (const [key, list] of blocks) {
        const next = list.filter((block) => block.id !== id);
        if (next.length !== list.length) {
          blocks.set(key, next);
          return;
        }
      }
      throw new Error(`no block ${id}`);
    },

    async request(method, path, body) {
      record("request", method, path, body);
      return { method, path, body: body ?? null };
    },
  };

  for (const missing of options.without ?? []) delete (fake as unknown as Record<string, unknown>)[missing];
  return fake;
}

/** A row carrying one of most column types, already flattened. */
export function makeRow(id: string, name: string, status: string, n: number): Page {
  return {
    id,
    title: name,
    url: `https://example.com/${id}`,
    collectionId: COLLECTION,
    parent: { type: "collection", id: COLLECTION },
    properties: {
      Name: name,
      Status: status,
      Tags: ["infra", "urgent"],
      Due: { start: `2026-09-${String((n % 28) + 1).padStart(2, "0")}` },
      Owner: [{ id: "user-1", name: "Ada" }],
      Estimate: n,
      Link: "https://example.com",
      Ref: ["page-launch"],
      Key: "BUG-42",
      Total: 12,
      Shipped: status === "Done",
      Mood: { unexpected: true },
    },
  };
}

export type { Block, Collection, Page, Query, Ref };
