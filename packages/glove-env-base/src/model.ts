/**
 * The object model.
 *
 * Every knowledge tool that is worth reading from has converged on roughly the
 * same four things, and this is them, named once:
 *
 * - **Rich text** — a run of formatted text is an *array of spans*, not a
 *   string. A sentence can hold a bold link, a person, an inline formula and a
 *   date, and anything that walks content has to handle spans or silently lose
 *   half of it.
 * - **Block** — the atom of content, and a *tree*. Indentation is structure,
 *   not styling.
 * - **Page** — a block that is also addressable and containerized: it has a
 *   title, a body, and — when it belongs to a collection — typed properties.
 * - **Collection** — a set of pages that share a schema. A row *is* a page, so
 *   every record has a document attached to it. That single fact is what
 *   separates this shape from a spreadsheet, and why "page or row?" is usually
 *   a false question.
 *
 * Nothing here is a wire format. A {@link Provider} translates its own
 * backend into these shapes, and everything above this line — markdown
 * rendering, tree walking, schema-checked writes, export into the filesystem —
 * is written once against them.
 *
 * Two conventions hold throughout, and both exist because the alternative was
 * measured to lose data quietly:
 *
 * - **Unknown is a value, not an error.** Block types and column types are
 *   open enums. A type this model has never heard of renders as a comment
 *   carrying its id rather than throwing, because the tool on the other end
 *   ships faster than the model of it.
 * - **`raw` is never dropped.** Whatever a provider could not express, it
 *   parks there, and it survives every round trip.
 */

// --------------------------------------------------------------- rich text

/** One span of text with its own formatting. */
export interface Span {
  /** The text itself. Always present, even for a mention or a formula. */
  text: string;
  /** Set when the span links somewhere. */
  href?: string;
  annotations?: Annotations;
  /** A reference to something rather than literal text. */
  mention?: Mention;
  /** Inline expression source; `text` holds a readable rendering of it. */
  equation?: string;
}

export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  /** Free-form: providers name colours differently and none of them matter to a reader. */
  color?: string;
}

/** What an inline reference points at. */
export interface Mention {
  type: "user" | "page" | "collection" | "date" | "link" | "emoji" | string;
  id?: string;
  url?: string;
  name?: string;
  date?: DateValue;
}

/** A rich text value: an ordered array of spans. */
export type RichText = Span[];

/** The text of a span array, formatting discarded. */
export function plainText(spans: RichText | string | undefined): string {
  if (typeof spans === "string") return spans;
  if (!Array.isArray(spans)) return "";
  return spans.map((span) => span?.text ?? "").join("");
}

/** A plain string as a single-span rich text value. */
export function span(text: string, extra: Omit<Span, "text"> = {}): RichText {
  return text === "" ? [] : [{ text, ...extra }];
}

/**
 * Coerce whatever a caller passed into rich text.
 *
 * Callers reach for a string nine times out of ten, and a signature that
 * accepts only spans turns the common case into ceremony.
 */
export function asRichText(value: RichText | string | undefined | null): RichText {
  if (value === undefined || value === null) return [];
  return typeof value === "string" ? span(value) : value;
}

// ------------------------------------------------------------------ blocks

/**
 * The block types this model renders.
 *
 * An open enum on purpose: a provider may return anything, and
 * {@link BlockType} is documentation plus autocomplete rather than a gate.
 */
export type BlockType =
  | "paragraph"
  | "heading"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "equation"
  | "divider"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "embed"
  | "bookmark"
  | "table"
  | "table_row"
  | "columns"
  | "column"
  | "synced"
  | "child_page"
  | "child_collection"
  | "breadcrumb"
  | "table_of_contents"
  | "unsupported"
  | (string & {});

/**
 * One node of content.
 *
 * Deliberately flat. A payload keyed by the block's own type — the shape most
 * APIs use on the wire — costs every reader an indexed lookup and every
 * writer a chance to key it wrong, and buys nothing a discriminated field
 * does not.
 */
export interface Block {
  /** Absent for a block being written; the provider assigns it. */
  id?: string;
  type: BlockType;
  /** Inline content, for the types that hold any. */
  text?: RichText;
  /** True when the provider knows there are children it has not returned. */
  hasChildren?: boolean;
  children?: Block[];

  /** `to_do`. */
  checked?: boolean;
  /** `heading`: 1, 2 or 3. */
  level?: 1 | 2 | 3;
  /**
   * `heading`: a toggle heading. Not a separate type anywhere it exists, and
   * treating it as one is how a renderer ends up with six heading branches.
   */
  collapsible?: boolean;
  /** `code`. */
  language?: string;
  /** `equation`: the expression source. */
  expression?: string;
  /** `callout`: an emoji or an image URL. */
  icon?: string;

  /**
   * `image`, `video`, `audio`, `file`, `embed`, `bookmark`.
   *
   * Hosted files usually carry a **signed, expiring** URL. Treat one as good
   * for a single fetch: pull the bytes into the tree with `download` rather
   * than storing the link.
   */
  url?: string;
  /** When the host told us; a URL past this is already dead. */
  expiresAt?: string;
  caption?: RichText;

  /** `table_row`. */
  cells?: RichText[];
  /** `table`. */
  columns?: number;
  /** `table`: whether the first row is a header. */
  hasHeader?: boolean;

  /** `child_page`, `child_collection`: the title of the thing linked. */
  title?: string;
  /** `synced`: the block this one mirrors, when it is a duplicate. */
  syncedFrom?: string;

  /** Whatever the provider could not express here. Never dropped. */
  raw?: unknown;
}

/** A reference to another object in the graph. */
export interface Ref {
  type: "page" | "collection" | "block" | "workspace" | "unknown";
  id?: string;
}

// ------------------------------------------------------------------- pages

/** A page: a title, a body, and — when it is a row — typed properties. */
export interface Page {
  id: string;
  title: string;
  url?: string;
  /** An emoji or an image URL. */
  icon?: string;
  parent?: Ref;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  /**
   * Flat values keyed by column name. Empty for a page that is not a row —
   * a standalone page has a title and nothing else.
   */
  properties?: Record<string, PropertyValue>;
  /** Set when this page is a row: the collection whose schema it follows. */
  collectionId?: string;
  raw?: unknown;
}

// ------------------------------------------------------------- collections

/**
 * A column type.
 *
 * Open, like {@link BlockType}: a provider with a type nothing here names
 * passes it through, and base treats it as opaque rather than refusing the
 * whole schema over one column.
 */
export type ColumnType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "status"
  | "date"
  | "people"
  | "files"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "relation"
  | "rollup"
  | "formula"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "uniqueId"
  | "verification"
  | "button"
  | (string & {});

export interface Column {
  type: ColumnType;
  /** `select`, `multiSelect`, `status`: the defined option names. */
  options?: string[];
  /**
   * The backend owns this value and refuses writes to it.
   *
   * Providers should set it explicitly. Left unset, base falls back to the
   * types that are computed everywhere — see `isComputed`.
   */
  computed?: boolean;
  description?: string;
}

/** A set of pages sharing a schema. Its rows are pages. */
export interface Collection {
  id: string;
  name: string;
  url?: string;
  parent?: Ref;
  /** Column name → its definition. */
  schema: Record<string, Column>;
  /** The column holding the title — also every row's page title. */
  titleProperty: string;
  raw?: unknown;
}

// -------------------------------------------------------------- properties

/** A date, or a range. `end` is present only for a range. */
export interface DateValue {
  start: string;
  end?: string;
  timeZone?: string;
}

export interface Person {
  id: string;
  name?: string;
  email?: string;
}

/**
 * A file, wherever it lives.
 *
 * `expiresAt` marks a signed URL. Store the page id and re-read; never store
 * the URL.
 */
export interface FileRef {
  name: string;
  url: string;
  expiresAt?: string;
  contentType?: string;
}

/**
 * A property value, flattened.
 *
 * The point of the whole model: `row.properties.Status` is `'In progress'`,
 * not a three-level union that a caller has to destructure differently per
 * column type. Providers flatten on the way out and base validates plain
 * values on the way back in.
 *
 * By column type:
 *
 * | Type | Value |
 * |---|---|
 * | `title`, `text` | `string` |
 * | `number` | `number \| null` |
 * | `select`, `status` | `string \| null` — the option name |
 * | `multiSelect` | `string[]` |
 * | `date` | `DateValue \| null` |
 * | `people`, `createdBy`, `updatedBy` | `Person[]` / `Person` |
 * | `files` | `FileRef[]` |
 * | `checkbox` | `boolean` |
 * | `url`, `email`, `phone` | `string \| null` |
 * | `relation` | `string[]` of page ids |
 * | `rollup`, `formula` | the computed value, by its own shape |
 * | `createdAt`, `updatedAt` | ISO 8601 `string` |
 * | `uniqueId` | `'BUG-42'`, or a number where there is no prefix |
 * | `button` | `null` — an action has no value |
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | DateValue
  | Person
  | Person[]
  | FileRef[]
  | unknown[]
  | Record<string, unknown>;

// ----------------------------------------------------------------- queries

/** A filter condition on one column. */
export interface Condition {
  property: string;
  /** `is`/`isNot` compare the flat value; the rest are the obvious things. */
  op:
    | "is"
    | "isNot"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "isEmpty"
    | "isNotEmpty";
  value?: unknown;
}

/**
 * A query over a collection.
 *
 * Kept small and structural on purpose. A provider pushes down what its
 * backend supports and reports the rest in `unsupported`, so base can
 * finish the job in memory rather than returning wrong rows — see
 * {@link QueryResult}.
 */
export interface Query {
  where?: Condition[];
  /** All conditions must hold (`and`) or any (`or`). Default `and`. */
  match?: "and" | "or";
  sort?: Array<{ property: string; direction?: "asc" | "desc" }>;
  /** Stop at this many rows. Without one, every row is fetched. */
  limit?: number;
  cursor?: string;
}

export interface QueryResult {
  rows: Page[];
  cursor?: string;
  /**
   * Conditions and sorts the backend could not apply. Base applies them
   * itself over the rows it received, so a provider may safely ignore
   * anything it cannot push down — it just has to say which.
   */
  unsupported?: { where?: Condition[]; sort?: Query["sort"] };
}

// ------------------------------------------------------------------ errors

/** A failure that came from a provider, with the provider named. */
export class ProviderError extends Error {
  readonly provider: string;
  readonly code: string;
  readonly status?: number;

  constructor(provider: string, message: string, options: { code?: string; status?: number; cause?: unknown } = {}) {
    // The provider goes in the message, not only in a field: a script sees the
    // message and nothing else, and "fetch failed" from four layers down sends
    // it looking at its own arguments.
    super(`provider "${provider}" ${message}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.code = options.code ?? "provider_error";
    if (options.status !== undefined) this.status = options.status;
  }
}

/** The provider does not implement the thing that was asked for. */
export class UnsupportedError extends Error {
  readonly provider: string;
  readonly capability: string;

  constructor(provider: string, capability: string, hint?: string) {
    super(
      `provider "${provider}" does not implement ${capability}()` +
        (hint ? ` — ${hint}` : "") +
        `. Capabilities are optional by design; check base.capabilities() before calling, or implement it.`,
    );
    this.name = "UnsupportedError";
    this.provider = provider;
    this.capability = capability;
  }
}
