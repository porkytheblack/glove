/** Materialized at `/std/base/index.d.ts` and `/std/base/README.md`. */

export const BASE_TYPES = `/** env:base — pages, blocks and collections, from inside a script. */

/** One span of text with its own formatting. A rich text value is an array of these. */
export interface Span {
  text: string;
  href?: string;
  annotations?: {
    bold?: boolean; italic?: boolean; strikethrough?: boolean;
    underline?: boolean; code?: boolean; color?: string;
  };
  /** An inline reference rather than literal text. */
  mention?: { type: string; id?: string; url?: string; name?: string };
  /** Inline expression source; \`text\` holds a readable rendering of it. */
  equation?: string;
}

export type RichText = Span[];

/** A reference to another object in the graph. */
export interface Ref {
  type: 'page' | 'collection' | 'block' | 'workspace' | 'unknown';
  id?: string;
}

/** A date, or a range. \`end\` is present only for a range. */
export interface DateValue { start: string; end?: string; timeZone?: string }

export interface Person { id: string; name?: string; email?: string }

/**
 * A file. \`expiresAt\` marks a signed URL — good for one fetch. Pull the bytes
 * into the tree with download() rather than storing the link.
 */
export interface FileRef { name: string; url: string; expiresAt?: string; contentType?: string }

/**
 * What a property flattens to, by column type:
 *
 *   title, text ................... string
 *   number ........................ number | null
 *   select, status ................ string | null    (the option name)
 *   multiSelect ................... string[]
 *   date .......................... DateValue | null
 *   people ........................ Person[]
 *   files ......................... FileRef[]
 *   checkbox ...................... boolean
 *   url, email, phone ............. string | null
 *   relation ...................... string[]         (page ids)
 *   rollup, formula ............... the computed value
 *   createdAt, updatedAt .......... string (ISO 8601)
 *   createdBy, updatedBy .......... Person
 *   uniqueId ...................... 'BUG-42', or a number where there is no prefix
 *   button ........................ null
 */
export type PropertyValue =
  | string | number | boolean | null
  | string[] | DateValue | Person | Person[] | FileRef[]
  | unknown[] | Record<string, unknown>;

/**
 * One node of content.
 *
 * Flat on purpose: the type is a field, not a key to index by. A block type
 * this model has never heard of still arrives, and still renders — as a
 * comment carrying its id.
 */
export interface Block {
  id?: string;
  type: string;
  text?: RichText;
  hasChildren?: boolean;
  children?: Block[];
  /** to_do */
  checked?: boolean;
  /** heading: 1, 2 or 3 */
  level?: 1 | 2 | 3;
  /** heading: a toggle heading. Not a separate type. */
  collapsible?: boolean;
  /** code */
  language?: string;
  /** equation */
  expression?: string;
  /** callout: an emoji or an image URL */
  icon?: string;
  /** media, embeds, bookmarks. Hosted URLs usually expire. */
  url?: string;
  expiresAt?: string;
  caption?: RichText;
  /** table_row */
  cells?: RichText[];
  /** table */
  columns?: number;
  hasHeader?: boolean;
  /** child_page, child_collection */
  title?: string;
  /** synced: the block this one mirrors */
  syncedFrom?: string;
  /** Anything the provider could not express in this model. Never dropped. */
  raw?: unknown;
}

/** A block with its text flattened — what you branch on. */
export interface FlatBlock {
  id?: string;
  type: string;
  text: string;
  hasChildren: boolean;
  children?: FlatBlock[];
  checked?: boolean;
  level?: number;
  collapsible?: boolean;
  language?: string;
  url?: string;
  caption?: string;
  cells?: string[];
  title?: string;
}

export interface Page {
  id: string;
  title: string;
  url?: string;
  icon?: string;
  parent?: Ref;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  /** Flat values keyed by column name. Empty for a page that is not a row. */
  properties?: Record<string, PropertyValue>;
  /** Set when this page is a row. */
  collectionId?: string;
  raw?: unknown;
}

export interface PageContent extends Page {
  markdown: string;
  blocks: FlatBlock[];
  /** Set when the walk stopped at \`depth\` and deeper blocks were not fetched. */
  truncated?: boolean;
}

export interface Column {
  type: string;
  /** select, multiSelect, status: the defined option names. */
  options?: string[];
  /** The backend owns it and refuses writes. */
  computed?: boolean;
  description?: string;
}

/** A set of pages sharing a schema. Its rows are pages, so each has a body too. */
export interface Collection {
  id: string;
  name: string;
  url?: string;
  parent?: Ref;
  schema: Record<string, Column>;
  /** The column holding the title — also every row's page title. */
  titleProperty: string;
  raw?: unknown;
}

/** One row. Plain values live under \`properties\`, keyed by column name. */
export interface Row {
  id: string;
  url?: string;
  title: string;
  properties: Record<string, PropertyValue>;
}

export interface Summary {
  id: string;
  kind: 'page' | 'collection' | 'block' | 'workspace' | 'unknown';
  title: string;
  url?: string;
  parent?: Ref;
  /** Collections only: column name → type. */
  schema?: Record<string, string>;
  /** Collections only: the columns the backend computes and refuses writes to. */
  computed?: string[];
  /** Pages only: how many top-level blocks the body holds. */
  blocks?: number;
  /** Pages only: the column names, when the page is a row. */
  properties?: string[];
}

/** One filter condition. \`property\` may be 'title'. */
export interface Condition {
  property: string;
  op: 'is' | 'isNot' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
    | 'gt' | 'gte' | 'lt' | 'lte' | 'isEmpty' | 'isNotEmpty';
  value?: unknown;
}

export interface QueryOptions {
  where?: Condition[];
  /** All conditions (and) or any (or). Default 'and'. */
  match?: 'and' | 'or';
  sort?: Array<{ property: string; direction?: 'asc' | 'desc' }>;
  /** Stop at this many rows. Without one, every row is fetched. */
  limit?: number;
  /** Keep only these columns. */
  properties?: string[];
}

export interface ReadOptions {
  /** How deep to walk the block tree. Default 4. */
  depth?: number;
}

export interface ChildrenOptions extends ReadOptions {
  /** Return the model's own blocks — spans and all — instead of flattened ones. */
  raw?: boolean;
}

export interface ExportOptions extends ReadOptions {
  /** Also write every child page, into a directory beside the file. */
  recursive?: boolean;
  /** Pull files into the tree and rewrite the links. Needs the provider's fetchFile. */
  assets?: boolean;
  maxPages?: number;
}

export interface ExportResult {
  path: string;
  files: string[];
  pages: number;
  assets?: string[];
}

export interface NewPage {
  /** Fills the title column, whatever it is called. */
  title?: string;
  /** Plain values, checked against the collection's schema. */
  properties?: Record<string, unknown>;
  markdown?: string;
  blocks?: Block[];
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

export type Parent = string | { pageId: string } | { collectionId: string };

/** What the backend behind this module actually implements. */
export interface Capabilities {
  provider: string;
  identify: boolean;
  collections: boolean;
  query: boolean;
  search: boolean;
  files: boolean;
  create: boolean;
  update: boolean;
  append: boolean;
  editBlocks: boolean;
  deleteBlocks: boolean;
  request: boolean;
}

export interface Hit {
  id: string;
  kind: string;
  title: string;
  url?: string;
  updatedAt?: string;
}

export interface BasePages {
  /** Identity and properties, without walking the body. */
  get(target: string): Promise<Page>;
  /** The whole page: properties, plus content rendered as markdown. */
  read(target: string, opts?: ReadOptions): Promise<PageContent>;
  /** Create a page under another page, or a row in a collection. */
  create(parent: Parent, spec?: NewPage): Promise<Page>;
  /** Change properties, title, icon, or trash state. */
  update(target: string, patch?: PageUpdate): Promise<Page>;
  /** Add content to the end. Returns how many blocks were added. */
  append(target: string, content: string | { markdown?: string; blocks?: Block[] }): Promise<number>;
  /** Write the page into the tree as markdown, for the other modules to read. */
  export(target: string, path: string, opts?: ExportOptions): Promise<ExportResult>;
}

export interface BaseCollections {
  /** The schema: every column, its type, and the options a select offers. */
  get(target: string): Promise<Collection>;
  /** Rows as flat records. Filters the backend cannot apply are applied here. */
  query(target: string, opts?: QueryOptions): Promise<Row[]>;
}

export interface BaseBlocks {
  /** A block's children, walked \`depth\` levels. A page id is a block id. */
  children(target: string, opts?: ChildrenOptions): Promise<FlatBlock[] | Block[]>;
  /** Append blocks, or markdown converted to them. */
  append(target: string, content: string | { markdown?: string; blocks?: Block[] }): Promise<number>;
  /** Change one block in place. */
  update(target: string, patch: Partial<Block>): Promise<Block>;
  /** Delete a block. */
  remove(target: string): Promise<{ id: string; deleted: true }>;
}

export const pages: BasePages;
export const collections: BaseCollections;
export const blocks: BaseBlocks;

/**
 * What is this? The cheap first call for an id or a pasted URL, when you do
 * not yet know whether you hold a page or a collection.
 */
export function describe(target: string): Promise<Summary>;

/**
 * What the backend behind this module can do.
 *
 * Optional capabilities are genuinely optional — a read-only backend is a
 * normal one. Check here rather than discovering it from an error.
 */
export function capabilities(): Promise<Capabilities>;

/** Find things. What gets searched depends on the backend — read /std/base/README.md. */
export function search(query: string, opts?: { kind?: 'page' | 'collection'; limit?: number }): Promise<Hit[]>;

/**
 * Pull a file into the tree, and return its path.
 *
 * Hosted URLs are usually signed and short-lived, so one read of a page is
 * worth one download. The path this returns is an ordinary path — hand it to
 * env:documents, env:images or env:ocr.
 */
export function download(url: string, path: string): Promise<string>;

/**
 * The escape hatch, straight through to the backend. Available only when the
 * provider implements it — check capabilities().request.
 */
export function request(method: string, path: string, body?: unknown): Promise<unknown>;
`;

export const BASE_DOCS = `# env:base

Pages, blocks and collections — from inside a script.

\`\`\`js
import { describe, pages, collections } from 'env:base';
\`\`\`

## The model in three sentences

Everything readable is a **block**, and blocks nest — indentation is real
structure. A **page** is a block that is addressable and holds other blocks,
plus a title. A **collection** is a set of pages sharing a schema, so a row
*is* a page: it has typed columns *and* a body.

That last point is the one worth holding on to. "Should this be a page or a
row?" is usually a false question — a row is both.

## Start from whatever you were given

\`\`\`js
const what = await describe(idOrUrl);
\`\`\`

- \`kind: 'page'\` → \`pages.read(id)\` for content, \`pages.get(id)\` for just
  properties.
- \`kind: 'collection'\` → the reply carries \`schema\` (column name → type) and
  \`computed\` (the ones the backend owns). Query it.

## Reading a page

\`\`\`js
const page = await pages.read(idOrUrl);
page.title       // 'Launch plan'
page.markdown    // the whole body, rendered
page.properties  // {} for a standalone page; flat values for a row
\`\`\`

Content comes back as markdown because a block tree whose text is a span tree
is unreadable at any useful size. When you need structure — checking off
to-dos, walking a table — use \`blocks.children(id)\`, and
\`blocks.children(id, { raw: true })\` when you need the spans too.

\`truncated: true\` on the result means the walk stopped at \`depth\`. Raise it
rather than assuming you saw everything.

## Reading a collection

\`\`\`js
const rows = await collections.query(collectionId, {
  where: [{ property: 'Status', op: 'isNot', value: 'Done' }],
  sort: [{ property: 'Due', direction: 'asc' }],
  properties: ['Name', 'Status', 'Due'],   // drop the columns you will not read
});

for (const row of rows) {
  row.title                  // the title column
  row.properties.Status      // 'In progress'
  row.properties.Owner       // [{ id, name }]
  row.properties.Due         // { start: '2026-09-14' }
}
\`\`\`

**Values live under \`.properties\`, keyed by the column's name.** Pagination is
not something to remember — every row is fetched. Whatever the backend cannot
filter or sort itself is applied here, so the answer is right either way.

## Writing

\`\`\`js
await pages.create(collectionId, {
  title: 'Ship the export path',
  properties: { Status: 'In progress', Due: '2026-09-30', Tags: ['infra'] },
  markdown: '## Context\\n\\n- [ ] port the fix',
});
\`\`\`

Values are plain and checked against the schema first:

- a column that does not exist fails here, naming the ones that do;
- a value the column cannot hold fails here, naming the column;
- a select option outside the defined set fails here, listing them;
- a computed column (formula, rollup, uniqueId, createdAt, button…) is refused
  with the reason. The backend owns it.

None of those reach the network. \`pages.update(id, { properties: { Status: 'Done' } })\`
is the same shape, and changes only what you pass.

To create a page rather than a row, give it a page as parent:
\`pages.create({ pageId }, { title, markdown })\`.

## Not every backend does everything

\`\`\`js
const can = await capabilities();
if (can.create) await pages.create(...);
\`\`\`

This module talks to whatever backend the host mounted, and optional
capabilities are genuinely optional — a read-only one is normal. Calling
something unimplemented tells you so by name rather than failing as
\`undefined is not a function\`.

## Getting content into the tree

\`\`\`js
import { pages, download } from 'env:base';
import { pdf } from 'env:documents';

const page = await pages.read(id);
const attachment = page.blocks.find((b) => b.type === 'file');
await download(attachment.url, '/inbox/spec.pdf');
const { text } = await pdf.extractText('/inbox/spec.pdf');
\`\`\`

Hosted file URLs are usually **signed and expiring** — worth one fetch, never
worth storing. For a whole subtree:

\`\`\`js
const out = await pages.export(id, '/out/handbook.md', { recursive: true, assets: true });
out.files   // one markdown file per page; attachments pulled in, links rewritten
\`\`\`

Those are ordinary paths, so the rest of the environment applies.

## When the model has no name for something

Block types and column types are open. Anything unrecognized renders as an
HTML comment carrying the block's id rather than breaking the page, and it is
still reachable through \`blocks.children\`. Where the backend offers one,
\`request()\` goes straight at it.
`;
