/**
 * A Notion-shaped API, in memory.
 *
 * The adapter's whole job is translation, so the tests need something to
 * translate *against* — one that answers in the API's own shapes, paginates
 * the way it paginates, and fails the way it fails. A recorded fixture would
 * not: half of what is worth testing here is a second request that depends on
 * the first (a block's children, a database's data source, a retry).
 */
import type { FetchLike } from "../src/client";

export interface FakeCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface FakeOptions {
  /** Queued responses, taken in order before the routed ones. */
  script?: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>;
}

export interface Fake {
  fetch: FetchLike;
  calls: FakeCall[];
  /** Ids the fake knows about, so tests can assert on what was created. */
  pages: Map<string, Record<string, unknown>>;
  blocks: Map<string, Record<string, unknown>[]>;
  dataSources: Map<string, Record<string, unknown>>;
  databases: Map<string, Record<string, unknown>>;
  rows: Map<string, Record<string, unknown>[]>;
  files: Map<string, Uint8Array>;
}

export const PAGE_ID = "11111111-1111-1111-1111-111111111111";
export const CHILD_ID = "22222222-2222-2222-2222-222222222222";
export const DB_ID = "33333333-3333-3333-3333-333333333333";
export const DS_ID = "44444444-4444-4444-4444-444444444444";
export const ROW_ID = "55555555-5555-5555-5555-555555555555";
export const TWO_DS_DB_ID = "66666666-6666-6666-6666-666666666666";
export const TODO_BLOCK_ID = "b0000004-0000-0000-0000-000000000004";
export const PDF_BLOCK_ID = "b0000008-0000-0000-0000-000000000008";

export function text(content: string, annotations: Record<string, boolean> = {}) {
  return [{ type: "text", plain_text: content, text: { content }, annotations }];
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function notFound(): Response {
  return json({ object: "error", status: 404, code: "object_not_found", message: "Could not find it." }, 404);
}

/** A page in a data source, with one of most property types. */
export function sampleRow(id: string, name: string, status: string, due?: string) {
  return {
    object: "page",
    id,
    url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    created_time: "2026-08-01T10:00:00.000Z",
    last_edited_time: "2026-08-20T10:00:00.000Z",
    parent: { type: "data_source_id", data_source_id: DS_ID },
    properties: {
      Name: { id: "title", type: "title", title: text(name) },
      Status: { id: "s", type: "status", status: { id: "1", name: status, color: "blue" } },
      Tags: { id: "t", type: "multi_select", multi_select: [{ name: "infra" }, { name: "urgent" }] },
      Due: { id: "d", type: "date", date: due ? { start: due, end: null, time_zone: null } : null },
      Owner: { id: "o", type: "people", people: [{ object: "user", id: "user-1", name: "Ada" }] },
      Done: { id: "c", type: "checkbox", checkbox: status === "Done" },
      Estimate: { id: "n", type: "number", number: 3 },
      Link: { id: "u", type: "url", url: "https://example.com" },
      Ref: { id: "r", type: "relation", relation: [{ id: PAGE_ID }], has_more: false },
      Key: { id: "k", type: "unique_id", unique_id: { prefix: "BUG", number: 42 } },
      Total: { id: "ro", type: "rollup", rollup: { type: "number", number: 12, function: "sum" } },
      Slug: { id: "f", type: "formula", formula: { type: "string", string: name.toLowerCase() } },
      Attach: {
        id: "a",
        type: "files",
        files: [
          {
            name: "spec.pdf",
            type: "file",
            file: { url: "https://file.notion.so/f/spec.pdf?sig=abc", expiry_time: "2026-09-01T11:00:00.000Z" },
          },
        ],
      },
      Never: { id: "b", type: "button", button: {} },
    },
  };
}

export function createFake(options: FakeOptions = {}): Fake {
  const script = [...(options.script ?? [])];

  const fake: Fake = {
    fetch: async () => new Response(null, { status: 500 }),
    calls: [],
    pages: new Map(),
    blocks: new Map(),
    dataSources: new Map(),
    databases: new Map(),
    rows: new Map(),
    files: new Map(),
  };

  // ------------------------------------------------------------- seed

  fake.pages.set(PAGE_ID, {
    object: "page",
    id: PAGE_ID,
    url: "https://www.notion.so/Launch-plan-11111111111111111111111111111111",
    created_time: "2026-07-01T00:00:00.000Z",
    last_edited_time: "2026-08-01T00:00:00.000Z",
    parent: { type: "workspace", workspace: true },
    properties: { title: { id: "title", type: "title", title: text("Launch plan") } },
  });
  fake.pages.set(CHILD_ID, {
    object: "page",
    id: CHILD_ID,
    url: `https://www.notion.so/${CHILD_ID.replace(/-/g, "")}`,
    parent: { type: "page_id", page_id: PAGE_ID },
    properties: { title: { id: "title", type: "title", title: text("Rollout") } },
  });
  fake.pages.set(ROW_ID, sampleRow(ROW_ID, "Ship the export path", "In progress", "2026-09-30"));

  fake.blocks.set(PAGE_ID, [
    { object: "block", id: "b0000001-0000-0000-0000-000000000001", type: "heading_1", has_children: false, heading_1: { rich_text: text("Overview"), is_toggleable: false } },
    {
      object: "block",
      id: "b0000002-0000-0000-0000-000000000002",
      type: "paragraph",
      has_children: false,
      paragraph: {
        rich_text: [
          { type: "text", plain_text: "See ", text: { content: "See " }, annotations: {} },
          { type: "text", plain_text: "the spec", text: { content: "the spec", link: { url: "https://example.com/spec" } }, href: "https://example.com/spec", annotations: {} },
          { type: "text", plain_text: " — ", text: { content: " — " }, annotations: {} },
          { type: "text", plain_text: "urgent", text: { content: "urgent" }, annotations: { bold: true } },
        ],
      },
    },
    { object: "block", id: "b0000003-0000-0000-0000-000000000003", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: text("Parent bullet") } },
    { object: "block", id: "b0000004-0000-0000-0000-000000000004", type: "to_do", has_children: false, to_do: { rich_text: text("Port the fix"), checked: false } },
    { object: "block", id: "b0000005-0000-0000-0000-000000000005", type: "code", has_children: false, code: { rich_text: text("const x = 1;"), language: "javascript" } },
    { object: "block", id: "b0000006-0000-0000-0000-000000000006", type: "unsupported", has_children: false, unsupported: {} },
    { object: "block", id: CHILD_ID, type: "child_page", has_children: true, child_page: { title: "Rollout" } },
    {
      object: "block",
      id: "b0000008-0000-0000-0000-000000000008",
      type: "pdf",
      has_children: false,
      pdf: { type: "file", file: { url: "https://file.notion.so/f/spec.pdf?sig=abc", expiry_time: "2026-09-01T11:00:00.000Z" }, caption: [] },
    },
    { object: "block", id: "b0000009-0000-0000-0000-000000000009", type: "table", has_children: true, table: { table_width: 2, has_column_header: true, has_row_header: false } },
  ]);
  fake.blocks.set("b0000003-0000-0000-0000-000000000003", [
    { object: "block", id: "b0000031-0000-0000-0000-000000000031", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: text("Nested bullet") } },
  ]);
  fake.blocks.set("b0000009-0000-0000-0000-000000000009", [
    { object: "block", id: "b0000091-0000-0000-0000-000000000091", type: "table_row", has_children: false, table_row: { cells: [text("Region"), text("Revenue")] } },
    { object: "block", id: "b0000092-0000-0000-0000-000000000092", type: "table_row", has_children: false, table_row: { cells: [text("EMEA"), text("2.4M")] } },
  ]);
  fake.blocks.set(CHILD_ID, [
    { object: "block", id: "c1", type: "paragraph", has_children: false, paragraph: { rich_text: text("Child body") } },
  ]);

  fake.databases.set(DB_ID, {
    object: "database",
    id: DB_ID,
    url: `https://www.notion.so/${DB_ID.replace(/-/g, "")}`,
    title: text("Tasks"),
    parent: { type: "page_id", page_id: PAGE_ID },
    data_sources: [{ id: DS_ID, name: "Tasks" }],
  });
  fake.databases.set(TWO_DS_DB_ID, {
    object: "database",
    id: TWO_DS_DB_ID,
    title: text("Split"),
    parent: { type: "page_id", page_id: PAGE_ID },
    data_sources: [
      { id: "77777777-7777-7777-7777-777777777777", name: "Current" },
      { id: "88888888-8888-8888-8888-888888888888", name: "Archive" },
    ],
  });

  fake.dataSources.set(DS_ID, {
    object: "data_source",
    id: DS_ID,
    name: "Tasks",
    title: text("Tasks"),
    parent: { type: "database_id", database_id: DB_ID },
    properties: {
      Name: { id: "title", type: "title", title: {} },
      Status: { id: "s", type: "status", status: { options: [{ name: "To do" }, { name: "In progress" }, { name: "Done" }] } },
      Tags: { id: "t", type: "multi_select", multi_select: { options: [{ name: "infra" }, { name: "urgent" }] } },
      Due: { id: "d", type: "date", date: {} },
      Owner: { id: "o", type: "people", people: {} },
      Done: { id: "c", type: "checkbox", checkbox: {} },
      Estimate: { id: "n", type: "number", number: { format: "number" } },
      Link: { id: "u", type: "url", url: {} },
      Ref: { id: "r", type: "relation", relation: { data_source_id: DS_ID, type: "single_property" } },
      Key: { id: "k", type: "unique_id", unique_id: { prefix: "BUG" } },
      Total: { id: "ro", type: "rollup", rollup: {} },
      Slug: { id: "f", type: "formula", formula: { expression: "" } },
      Attach: { id: "a", type: "files", files: {} },
      Never: { id: "b", type: "button", button: {} },
    },
  });

  // 250 rows, so pagination is genuinely exercised rather than asserted about.
  fake.rows.set(
    DS_ID,
    Array.from({ length: 250 }, (_, i) =>
      sampleRow(
        `99999999-0000-0000-0000-${String(i).padStart(12, "0")}`,
        `Task ${i}`,
        i % 3 === 0 ? "Done" : "In progress",
        "2026-09-30",
      ),
    ),
  );

  fake.files.set("https://file.notion.so/f/spec.pdf?sig=abc", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

  // ------------------------------------------------------------ routing

  let created = 0;

  fake.fetch = async (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    if (parsed.hostname !== "api.notion.com") {
      const bytes = fake.files.get(url);
      fake.calls.push({ method, path: url });
      return bytes ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }) : new Response(null, { status: 403 });
    }

    const path = parsed.pathname.replace(/^\/v1/, "");
    fake.calls.push({ method, path: path + parsed.search, ...(body !== undefined ? { body } : {}) });

    const queued = script.shift();
    if (queued) return json(queued.body ?? {}, queued.status, queued.headers);

    const segments = path.split("/").filter(Boolean);

    if (method === "GET" && segments[0] === "pages") {
      const page = fake.pages.get(segments[1]);
      return page ? json(page) : notFound();
    }
    if (method === "PATCH" && segments[0] === "pages") {
      const page = fake.pages.get(segments[1]);
      if (!page) return notFound();
      const merged = {
        ...page,
        ...(body?.in_trash !== undefined ? { in_trash: body.in_trash, archived: body.in_trash } : {}),
        properties: { ...(page.properties as object), ...(body?.properties ?? {}) },
      };
      fake.pages.set(segments[1], merged);
      return json(merged);
    }
    if (method === "POST" && segments[0] === "pages" && segments.length === 1) {
      const id = `aaaaaaaa-0000-0000-0000-${String(++created).padStart(12, "0")}`;
      const page = {
        object: "page",
        id,
        url: `https://www.notion.so/${id.replace(/-/g, "")}`,
        parent: body?.parent,
        properties: body?.properties ?? {},
      };
      fake.pages.set(id, page);
      fake.blocks.set(id, [...((body?.children ?? []) as Record<string, unknown>[])]);
      return json(page);
    }

    if (segments[0] === "blocks" && segments[2] === "children") {
      const id = segments[1];
      if (method === "GET") {
        const all = fake.blocks.get(id) ?? [];
        const size = Number(parsed.searchParams.get("page_size") ?? 100);
        const from = Number(parsed.searchParams.get("start_cursor") ?? 0);
        const slice = all.slice(from, from + size);
        const next = from + size;
        return json({
          object: "list",
          results: slice,
          has_more: next < all.length,
          next_cursor: next < all.length ? String(next) : null,
        });
      }
      if (method === "PATCH") {
        const existing = fake.blocks.get(id) ?? [];
        const added = (body?.children ?? []) as Record<string, unknown>[];
        fake.blocks.set(id, [...existing, ...added]);
        return json({ object: "list", results: added });
      }
    }
    if (segments[0] === "blocks" && segments.length === 2) {
      const id = segments[1];
      if (method === "GET") {
        for (const list of fake.blocks.values()) {
          const found = list.find((b) => b.id === id);
          if (found) return json(found);
        }
        return notFound();
      }
      if (method === "PATCH" || method === "DELETE") return json({ object: "block", id, type: "paragraph" });
    }

    if (method === "GET" && segments[0] === "databases") {
      const db = fake.databases.get(segments[1]);
      return db ? json(db) : notFound();
    }
    if (method === "POST" && segments[0] === "databases" && segments.length === 1) {
      const id = `bbbbbbbb-0000-0000-0000-${String(++created).padStart(12, "0")}`;
      const dsId = `cccccccc-0000-0000-0000-${String(created).padStart(12, "0")}`;
      const db = {
        object: "database",
        id,
        title: body?.title,
        parent: body?.parent,
        data_sources: [{ id: dsId, name: "Default" }],
      };
      fake.databases.set(id, db);
      fake.dataSources.set(dsId, {
        object: "data_source",
        id: dsId,
        title: body?.title,
        parent: { type: "database_id", database_id: id },
        properties: body?.initial_data_source?.properties ?? {},
      });
      fake.rows.set(dsId, []);
      return json(db);
    }

    if (method === "GET" && segments[0] === "data_sources") {
      const ds = fake.dataSources.get(segments[1]);
      return ds ? json(ds) : notFound();
    }
    if (method === "POST" && segments[0] === "data_sources" && segments[2] === "query") {
      const all = fake.rows.get(segments[1]) ?? [];
      const size = Number(body?.page_size ?? 100);
      const from = Number(body?.start_cursor ?? 0);
      const slice = all.slice(from, from + size);
      const next = from + size;
      return json({
        object: "list",
        results: slice,
        has_more: next < all.length,
        next_cursor: next < all.length ? String(next) : null,
      });
    }

    if (method === "POST" && segments[0] === "search") {
      const query = String(body?.query ?? "").toLowerCase();
      const hits = [...fake.pages.values()].filter((p) =>
        JSON.stringify(p.properties).toLowerCase().includes(query),
      );
      return json({ object: "list", results: hits, has_more: false, next_cursor: null });
    }

    return notFound();
  };

  return fake;
}
