/** Materialized at `/std/notion/index.d.ts` and `/std/notion/README.md`. */

export const NOTION_TYPES = `/** env:notion — a Notion workspace, read and written from a script. */

/** A parent reference, normalized across the shapes the API uses. */
export interface NotionParent {
  type: 'page' | 'database' | 'data_source' | 'block' | 'workspace' | 'unknown';
  id?: string;
}

/** A date property. \`end\` is present only for a range. */
export interface NotionDate {
  start: string;
  end?: string;
  timeZone?: string;
}

export interface NotionPerson {
  id: string;
  name?: string;
}

/**
 * A file on a page or in a property.
 *
 * \`expires\` is set for Notion-hosted files: the URL is signed and stops
 * resolving, usually within the hour. Never store one — pull the bytes into
 * the tree with \`download()\` instead.
 */
export interface NotionFile {
  name: string;
  url: string;
  expires?: string;
}

/**
 * What a property value flattens to, by property type:
 *
 *   title, rich_text .............. string
 *   number ........................ number | null
 *   select, status ................ string | null   (the option name)
 *   multi_select .................. string[]
 *   date .......................... NotionDate | null
 *   people ........................ NotionPerson[]
 *   files ......................... NotionFile[]
 *   checkbox ...................... boolean
 *   url, email, phone_number ...... string | null
 *   relation ...................... string[]        (page ids)
 *   rollup, formula ............... the computed value
 *   created_time, last_edited_* ... string (ISO 8601) or NotionPerson
 *   unique_id ..................... 'BUG-42', or a number with no prefix
 *   button ........................ null
 */
export type PropertyValue =
  | string | number | boolean | null
  | string[] | NotionDate | NotionPerson | NotionPerson[] | NotionFile[]
  | Record<string, unknown>;

/** A block reduced to what a script usually wants. */
export interface NotionBlock {
  id: string;
  type: string;
  /** The block's text, formatting discarded. */
  text: string;
  hasChildren: boolean;
  children?: NotionBlock[];
  /** to_do only. */
  checked?: boolean;
  /** code only. */
  language?: string;
  /** Media, embeds and bookmarks. Notion-hosted URLs expire. */
  url?: string;
  caption?: string;
  /** 1, 2 or 3 for headings. */
  level?: number;
  /** A toggle heading is heading_n with this set — not a separate type. */
  toggleable?: boolean;
  /** table_row only: each cell's plain text. */
  cells?: string[];
}

/** A raw block payload, as the API models it. Accepted anywhere blocks are written. */
export interface RawBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  [payload: string]: unknown;
}

export interface NotionPageInfo {
  id: string;
  url: string;
  title: string;
  parent: NotionParent;
  createdTime?: string;
  lastEditedTime?: string;
  archived: boolean;
  /** Flat values, keyed by column name. Empty for a page outside a data source. */
  properties: Record<string, PropertyValue>;
}

export interface NotionPageContent extends NotionPageInfo {
  markdown: string;
  blocks: NotionBlock[];
  /** Set when the walk stopped at \`depth\` and deeper blocks were not fetched. */
  truncated?: boolean;
}

export interface NotionSummary {
  id: string;
  object: 'page' | 'database' | 'data_source' | 'block' | 'unknown';
  title: string;
  url?: string;
  parent?: NotionParent;
  /** Databases only. Query one of these, never the database itself. */
  dataSources?: Array<{ id: string; name: string }>;
  /** Data sources only: property name → type. */
  properties?: Record<string, string>;
  /** Pages only: how many top-level blocks the body holds. */
  blocks?: number;
  /** Blocks only. */
  type?: string;
}

export interface SearchHit {
  id: string;
  object: string;
  title: string;
  url?: string;
  lastEditedTime?: string;
  parent?: NotionParent;
}

export interface SearchOptions {
  /** data_source is the queryable one; database is the container around it. */
  filter?: 'page' | 'data_source' | 'database';
  /** Default 100. */
  limit?: number;
  /** Newest first by default. */
  sort?: 'recent' | 'relevance';
}

export interface DatabaseInfo {
  id: string;
  title: string;
  url?: string;
  parent: NotionParent;
  dataSources: Array<{ id: string; name: string }>;
}

export interface DataSourceColumn {
  id?: string;
  type: string;
  /** select, multi_select and status only. */
  options?: string[];
}

export interface DataSourceInfo {
  id: string;
  name: string;
  databaseId?: string;
  properties: Record<string, DataSourceColumn>;
  /** The one title column — also the page title of every row. */
  titleProperty: string;
}

/** One row. Plain values live under \`properties\`, keyed by column name. */
export interface NotionRow {
  id: string;
  url: string;
  title: string;
  properties: Record<string, PropertyValue>;
}

export interface QueryOptions {
  /** A Notion filter object, passed through unchanged. */
  filter?: Record<string, unknown>;
  sorts?: Array<Record<string, unknown>>;
  /** Stop at this many rows. Without one, every row is fetched. */
  limit?: number;
  /** Keep only these columns. */
  properties?: string[];
}

export type PageParent = string | { pageId: string } | { dataSourceId: string } | { databaseId: string };

export interface NewPage {
  /** Fills the title column, whatever it is called. */
  title?: string;
  /** Plain values, coerced against the data source's schema. */
  properties?: Record<string, unknown>;
  markdown?: string;
  blocks?: RawBlock[];
  /** An emoji, or an image URL. */
  icon?: string;
}

export interface PageUpdate {
  title?: string;
  properties?: Record<string, unknown>;
  icon?: string;
  /** Move to trash, or restore from it. */
  archived?: boolean;
}

export interface ReadOptions {
  /** How deep to walk the block tree. Default 4. */
  depth?: number;
}

export interface ChildrenOptions extends ReadOptions {
  /** Return the API's own block objects instead of the reduced shape. */
  raw?: boolean;
}

export interface ExportOptions extends ReadOptions {
  /** Also write every child page, into a directory beside the file. */
  recursive?: boolean;
  /** Pull images and files into the tree and rewrite the links. */
  assets?: boolean;
  /** Most pages a recursive export will write. Default 100. */
  maxPages?: number;
}

export interface PageExport {
  path: string;
  files: string[];
  pages: number;
  assets?: string[];
}

export interface NewDatabase {
  parentPageId: string;
  title: string;
  /** Column name → type ('title', 'select', 'date', …), or a full Notion definition. */
  properties: Record<string, string | Record<string, unknown>>;
}

export interface NotionPages {
  /** Identity and properties, without walking the body. */
  get(target: string): Promise<NotionPageInfo>;
  /** The whole page: properties, plus content rendered as markdown. */
  read(target: string, opts?: ReadOptions): Promise<NotionPageContent>;
  /** Create a page under another page, or a row in a data source. */
  create(parent: PageParent, spec?: NewPage): Promise<NotionPageInfo>;
  /** Change properties, title, icon, or trash state. */
  update(target: string, patch?: PageUpdate): Promise<NotionPageInfo>;
  /** Add content to the end of a page. Returns how many blocks were added. */
  append(target: string, content: string | { markdown?: string; blocks?: RawBlock[] }): Promise<number>;
  /** Write the page into the tree as markdown, for the other modules to read. */
  export(target: string, path: string, opts?: ExportOptions): Promise<PageExport>;
}

export interface NotionDatabases {
  /** The container, and the data sources inside it. */
  get(target: string): Promise<DatabaseInfo>;
  /** A new database with one data source, under a page. */
  create(spec: NewDatabase): Promise<DatabaseInfo>;
}

export interface NotionDataSources {
  /** The schema: every column, its type, and the options a select offers. */
  get(target: string): Promise<DataSourceInfo>;
  /** Rows as flat records. Accepts a data source id, or a database with exactly one. */
  query(target: string, opts?: QueryOptions): Promise<NotionRow[]>;
}

export interface NotionBlocks {
  /** A block's children, walked \`depth\` levels. A page id is a block id. */
  children(target: string, opts?: ChildrenOptions): Promise<NotionBlock[] | RawBlock[]>;
  /** Append blocks, or markdown converted to them. */
  append(target: string, content: string | { markdown?: string; blocks?: RawBlock[] }): Promise<number>;
  /** Change one block in place, with the API's own type-keyed patch. */
  update(target: string, patch: Record<string, unknown>): Promise<RawBlock>;
  /** Move a block to the trash. */
  remove(target: string): Promise<{ id: string; archived: true }>;
}

export const pages: NotionPages;
export const databases: NotionDatabases;
export const dataSources: NotionDataSources;
export const blocks: NotionBlocks;

/**
 * What is this? The cheap first call for an id or a pasted URL, when you do
 * not yet know whether you hold a page, a database, or a data source.
 *
 * Every entry point in this module takes a bare id, a dashed id, or any
 * notion.so URL — including the ?p= form Notion copies for a row.
 */
export function describe(target: string): Promise<NotionSummary>;

/**
 * Find things by title. Notion's search covers titles only — never page
 * content — and sees only what the integration has been given access to.
 */
export function search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;

/**
 * Pull a Notion-hosted file into the tree, and return its path.
 *
 * File URLs are signed and expire within the hour, so one read of a page is
 * worth one download. The path this returns is an ordinary path — hand it to
 * env:documents, env:images or env:ocr.
 */
export function download(url: string, path: string): Promise<string>;

/**
 * Any endpoint, any body, the raw response — for what the bindings above do
 * not cover. Paths are relative to the API version root: '/pages/<id>'.
 */
export function request(method: string, path: string, body?: unknown): Promise<unknown>;
`;

export const NOTION_DOCS = `# env:notion

A Notion workspace, from inside a script.

\`\`\`js
import { describe, pages, dataSources } from 'env:notion';
\`\`\`

## The three-sentence model

Everything is a **block**; a **page** is a block with a URL and a container;
a **database** holds one or more **data sources**, and a data source holds a
schema and rows. A row *is* a page, so it has a body as well as columns.

That last split is new (API version 2025-09-03) and it is the one thing worth
getting right: **schemas and rows live on data sources, not on databases.**
\`describe(id)\` on a database lists the data sources inside it.

## Reading a page

\`\`\`js
const page = await pages.read('https://www.notion.so/Launch-plan-1a2b3c…');
page.title       // 'Launch plan'
page.markdown    // the whole body, rendered
page.properties  // {} for a standalone page; flat values for a row
\`\`\`

Content comes back as markdown because a block tree whose text is a span tree
is unreadable at any useful size. Use \`blocks.children(id)\` when you need
structure, and \`blocks.children(id, { raw: true })\` when you need everything.

## Reading a database

\`\`\`js
const db = await describe(databaseUrl);          // { dataSources: [{ id, name }] }
const rows = await dataSources.query(db.dataSources[0].id, {
  filter: { property: 'Status', status: { equals: 'In progress' } },
});

for (const row of rows) {
  row.title                  // the title column
  row.properties.Owner       // [{ id, name }]
  row.properties.Due         // { start: '2026-09-14' }
}
\`\`\`

\`query\` also accepts a database id directly when that database has exactly
one data source. With more than one it refuses and names them, rather than
querying whichever was created first.

Every row is fetched — pagination is not something you have to remember. Pass
\`limit\` when you only need the first few, and \`properties: ['Name', 'Status']\`
to drop columns you are not going to read.

## Writing

\`\`\`js
await pages.create(dataSourceId, {
  title: 'Ship the export path',
  properties: { Status: 'In progress', Due: '2026-09-30', Tags: ['infra'] },
  markdown: '## Context\\n\\nThe old exporter dropped attachments.',
});
\`\`\`

Values are plain, and coerced against the schema — \`'In progress'\` becomes a
status option, \`'2026-09-30'\` becomes a date. A name that is not a column, or
a value the column cannot hold, fails here with the column named rather than
at the API as a 400.

Computed columns (formula, rollup, unique_id, created_time, button…) are
refused with the reason: Notion owns them.

## Getting files out

Notion-hosted URLs are signed and expire within the hour.

\`\`\`js
import { pages, download } from 'env:notion';
import { pdf } from 'env:documents';

const page = await pages.read(id);
const file = page.blocks.find((b) => b.type === 'pdf');
await download(file.url, '/inbox/spec.pdf');
const text = await pdf.extractText('/inbox/spec.pdf');
\`\`\`

\`pages.export(id, '/out/page.md', { recursive: true, assets: true })\` does the
whole subtree at once: one markdown file per page, attachments pulled into a
sibling directory, links rewritten to the local paths.

## When the API has no model for something

The block type enum grows faster than any wrapper. Unknown blocks render as an
HTML comment carrying their id rather than breaking the page, and \`request()\`
is the way through:

\`\`\`js
import { request } from 'env:notion';
const raw = await request('GET', '/blocks/1a2b3c…/children?page_size=100');
\`\`\`

## Errors worth recognizing

- **object_not_found** almost never means the object is missing. An
  integration sees only what has been shared with it: open the page in Notion
  → ••• → Connections, and add it.
- **validation_error** on a create is usually a database id where a data
  source id belongs.
`;
