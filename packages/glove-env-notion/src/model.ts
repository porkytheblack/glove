/**
 * The object model, reduced to values a script can use.
 *
 * Notion's API returns its own shapes faithfully: a title is an array of
 * spans, a number is `{ type: 'number', number: 3 }`, a relation is a list of
 * objects holding ids, and a rollup is a discriminated union three levels
 * deep. Every one of those is the right wire format and the wrong thing to
 * write a loop over. `rows.filter(r => r.Status === 'Done')` is what a model
 * writes from memory; `rows.filter(r => r.properties.Status.status?.name ===
 * 'Done')` is what it has to be told, and gets wrong, once per property type.
 *
 * So this module does one job in both directions:
 *
 * - {@link readProperty} — any of the twenty-odd property types → a plain
 *   JavaScript value, with the type recorded separately rather than encoded
 *   in the shape.
 * - {@link toPropertyValue} — a plain value plus the schema's declared type →
 *   the payload the API expects.
 *
 * The asymmetry is real and unavoidable: reading needs no schema because the
 * value carries its own type tag, while writing needs one because `"Done"`
 * could be a select, a status, a title or a phone number.
 */

// ------------------------------------------------------------ wire shapes

/** One span of formatted text. A block's text is an array of these, never a string. */
export interface RichText {
  type?: "text" | "mention" | "equation";
  plain_text?: string;
  href?: string | null;
  annotations?: Annotations;
  text?: { content: string; link?: { url: string } | null };
  equation?: { expression: string };
  mention?: Mention;
}

export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

export interface Mention {
  type?: string;
  user?: { id: string; name?: string };
  page?: { id: string };
  database?: { id: string };
  data_source?: { id: string; database_id?: string };
  date?: DateValue;
  link_preview?: { url: string };
  template_mention?: Record<string, unknown>;
  custom_emoji?: { name?: string; url?: string };
}

export interface DateValue {
  start: string;
  end?: string | null;
  time_zone?: string | null;
}

/** A block as the API returns it: one envelope, one polymorphic payload. */
export interface RawBlock {
  object?: "block";
  id: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  parent?: RawParent;
  [payload: string]: unknown;
}

export interface RawParent {
  type?: string;
  page_id?: string;
  block_id?: string;
  database_id?: string;
  data_source_id?: string;
  workspace?: boolean;
}

export interface RawPage {
  object?: "page";
  id: string;
  url?: string;
  public_url?: string | null;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  icon?: unknown;
  cover?: unknown;
  parent?: RawParent;
  properties?: Record<string, RawPropertyValue>;
}

export interface RawPropertyValue {
  id?: string;
  type?: string;
  [payload: string]: unknown;
}

// -------------------------------------------------------------- rich text

/** The text of a span array, formatting discarded. */
export function plainText(spans: RichText[] | undefined): string {
  if (!Array.isArray(spans)) return "";
  return spans.map(spanText).join("");
}

/** One span's text, falling back to its payload when `plain_text` is absent. */
export function spanText(span: RichText | undefined): string {
  if (!span) return "";
  if (typeof span.plain_text === "string") return span.plain_text;
  if (span.text?.content) return span.text.content;
  if (span.equation?.expression) return span.equation.expression;
  if (span.mention) return mentionText(span.mention);
  return "";
}

/** A readable stand-in for a mention, used when nothing better is available. */
export function mentionText(mention: Mention): string {
  if (mention.user) return `@${mention.user.name ?? mention.user.id}`;
  if (mention.date) return formatDate(mention.date);
  if (mention.link_preview) return mention.link_preview.url;
  if (mention.custom_emoji?.name) return `:${mention.custom_emoji.name}:`;
  const id = mention.page?.id ?? mention.data_source?.id ?? mention.database?.id;
  return id ? `[${mention.type ?? "mention"}:${id}]` : "";
}

/**
 * A plain string as the span array the API wants.
 *
 * Notion caps a single rich text object at 2000 characters and rejects the
 * whole request past it, so long text is split rather than truncated — the
 * seam is invisible in the editor.
 */
export function richText(text: string, link?: string): RichText[] {
  if (text === "") return [];
  const chunks: RichText[] = [];
  for (let i = 0; i < text.length; i += 2000) {
    const content = text.slice(i, i + 2000);
    chunks.push({
      type: "text",
      text: { content, ...(link ? { link: { url: link } } : {}) },
    });
  }
  return chunks;
}

function formatDate(date: DateValue): string {
  return date.end ? `${date.start} → ${date.end}` : date.start;
}

// --------------------------------------------------------------- reading

/** A date property, flattened. `end` is present only for a range. */
export interface NotionDate {
  start: string;
  end?: string;
  timeZone?: string;
}

/** A person, as much of one as the API returns for the current token. */
export interface NotionPerson {
  id: string;
  name?: string;
}

/**
 * A file attached to a page or a property.
 *
 * `expires` is set for Notion-hosted files: the URL is signed and stops
 * resolving, usually within the hour. Store the id and re-fetch, or pull the
 * bytes into the tree with `download()`; never persist the URL.
 */
export interface NotionFile {
  name: string;
  url: string;
  /** ISO 8601 expiry, for Notion-hosted files only. */
  expires?: string;
}

/** Every shape {@link readProperty} can return. */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | NotionDate
  | NotionPerson
  | NotionPerson[]
  | NotionFile[]
  | Record<string, unknown>;

/**
 * One property value, flattened.
 *
 * The mapping, in full, because guessing it is the tax this module exists to
 * remove:
 *
 * | Type | Returns |
 * |---|---|
 * | `title`, `rich_text` | `string` (formatting discarded — read the blocks for that) |
 * | `number` | `number \| null` |
 * | `select`, `status` | `string \| null` (the option name) |
 * | `multi_select` | `string[]` |
 * | `date` | `NotionDate \| null` |
 * | `people` | `NotionPerson[]` |
 * | `files` | `NotionFile[]` |
 * | `checkbox` | `boolean` |
 * | `url`, `email`, `phone_number` | `string \| null` |
 * | `relation` | `string[]` of page ids |
 * | `rollup` | the reduced value — number, date, or an array of them |
 * | `formula` | the computed value, by its own type |
 * | `created_time`, `last_edited_time` | ISO 8601 `string` |
 * | `created_by`, `last_edited_by` | `NotionPerson` |
 * | `unique_id` | `"BUG-42"`, or the bare number when the data source has no prefix |
 * | `verification` | `{ state, verifiedBy?, date? }` |
 * | `button` | `null` — a button is an action, and has no value to read |
 *
 * An unknown type returns `null` rather than throwing: the property enum
 * grows, and one new column should not break a script that reads nine others.
 */
export function readProperty(value: RawPropertyValue | undefined | null): PropertyValue {
  if (!value || typeof value !== "object") return null;
  const type = typeof value.type === "string" ? value.type : "";
  const payload = value[type];

  switch (type) {
    case "title":
    case "rich_text":
      return plainText(payload as RichText[]);
    case "number":
      return typeof payload === "number" ? payload : null;
    case "select":
    case "status":
      return optionName(payload);
    case "multi_select":
      return Array.isArray(payload) ? payload.map((o) => optionName(o) ?? "").filter((n) => n !== "") : [];
    case "date":
      return toDate(payload as DateValue | null);
    case "people":
      return Array.isArray(payload) ? payload.map(toPerson) : [];
    case "files":
      return Array.isArray(payload) ? payload.map(toFile) : [];
    case "checkbox":
      return payload === true;
    case "url":
    case "email":
    case "phone_number":
      return typeof payload === "string" && payload !== "" ? payload : null;
    case "relation":
      return Array.isArray(payload)
        ? payload.map((r) => (r && typeof r === "object" ? String((r as { id?: string }).id ?? "") : "")).filter(Boolean)
        : [];
    case "rollup":
      return readRollup(payload as RawPropertyValue);
    case "formula":
      return readFormula(payload as RawPropertyValue);
    case "created_time":
    case "last_edited_time":
      return typeof payload === "string" ? payload : null;
    case "created_by":
    case "last_edited_by":
      return payload && typeof payload === "object" ? toPerson(payload) : null;
    case "unique_id": {
      const uid = payload as { prefix?: string | null; number?: number | null } | null;
      if (!uid || typeof uid.number !== "number") return null;
      return uid.prefix ? `${uid.prefix}-${uid.number}` : uid.number;
    }
    case "verification": {
      const v = payload as { state?: string; verified_by?: unknown; date?: DateValue | null } | null;
      if (!v) return null;
      return {
        state: v.state ?? "unverified",
        ...(v.verified_by ? { verifiedBy: toPerson(v.verified_by) } : {}),
        ...(v.date ? { date: toDate(v.date) } : {}),
      };
    }
    case "button":
      return null;
    default:
      return null;
  }
}

/**
 * A whole page's properties as one flat record.
 *
 * This is what a row looks like to a script: `{ Name: 'Ship v2', Status:
 * 'In progress', Owner: [{ id, name }], Due: { start: '2026-09-14' } }`.
 */
export function readProperties(properties: Record<string, RawPropertyValue> | undefined): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [name, value] of Object.entries(properties ?? {})) out[name] = readProperty(value);
  return out;
}

/** The page's title, whichever property happens to hold it. */
export function pageTitle(page: RawPage | undefined): string {
  for (const value of Object.values(page?.properties ?? {})) {
    if (value?.type === "title") return plainText(value.title as RichText[]);
  }
  return "";
}

function optionName(option: unknown): string | null {
  if (!option || typeof option !== "object") return null;
  const name = (option as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function toDate(date: DateValue | null | undefined): NotionDate | null {
  if (!date || typeof date.start !== "string") return null;
  return {
    start: date.start,
    ...(date.end ? { end: date.end } : {}),
    ...(date.time_zone ? { timeZone: date.time_zone } : {}),
  };
}

function toPerson(person: unknown): NotionPerson {
  const p = (person ?? {}) as { id?: string; name?: string };
  return { id: String(p.id ?? ""), ...(p.name ? { name: p.name } : {}) };
}

function toFile(file: unknown): NotionFile {
  const f = (file ?? {}) as {
    name?: string;
    type?: string;
    file?: { url?: string; expiry_time?: string };
    external?: { url?: string };
    file_upload?: { id?: string };
  };
  if (f.file?.url) {
    return {
      name: f.name ?? "",
      url: f.file.url,
      ...(f.file.expiry_time ? { expires: f.file.expiry_time } : {}),
    };
  }
  return { name: f.name ?? "", url: f.external?.url ?? "" };
}

function readRollup(rollup: RawPropertyValue | null): PropertyValue {
  if (!rollup || typeof rollup !== "object") return null;
  switch (rollup.type) {
    case "number":
      return typeof rollup.number === "number" ? rollup.number : null;
    case "date":
      return toDate(rollup.date as DateValue | null);
    case "array":
      // Each element is itself a property value, so the same reducer applies
      // one level down — a rollup of dates is dates, not wrappers around them.
      return (Array.isArray(rollup.array) ? rollup.array : []).map((v) =>
        readProperty(v as RawPropertyValue),
      ) as unknown as PropertyValue;
    case "incomplete":
      return null;
    case "unsupported":
      return null;
    default:
      return null;
  }
}

function readFormula(formula: RawPropertyValue | null): PropertyValue {
  if (!formula || typeof formula !== "object") return null;
  switch (formula.type) {
    case "string":
      return typeof formula.string === "string" ? formula.string : null;
    case "number":
      return typeof formula.number === "number" ? formula.number : null;
    case "boolean":
      return formula.boolean === true;
    case "date":
      return toDate(formula.date as DateValue | null);
    default:
      return null;
  }
}

// --------------------------------------------------------------- writing

/**
 * A plain value → the payload the API expects for a property of `type`.
 *
 * `null` clears the property. A value of the wrong shape is refused here,
 * naming the property, rather than reaching the API as a 400 that names a
 * JSON path.
 */
export function toPropertyValue(type: string, value: unknown, name = "property"): RawPropertyValue {
  const bad = (want: string): never => {
    throw new Error(`${name} is a ${type} property — expected ${want}, got ${describeValue(value)}`);
  };

  switch (type) {
    case "title":
      return { title: richText(asText(value, bad)) };
    case "rich_text":
      return { rich_text: richText(asText(value, bad)) };
    case "number":
      if (value === null || value === undefined) return { number: null };
      if (typeof value !== "number" || !Number.isFinite(value)) bad("a finite number");
      return { number: value as number };
    case "select":
      return { select: value === null || value === undefined || value === "" ? null : { name: asText(value, bad) } };
    case "status":
      return { status: value === null || value === undefined || value === "" ? null : { name: asText(value, bad) } };
    case "multi_select":
      if (!Array.isArray(value)) bad("an array of option names");
      return { multi_select: (value as unknown[]).map((v) => ({ name: asText(v, bad) })) };
    case "date":
      return { date: asDate(value, bad) };
    case "checkbox":
      return { checkbox: value === true };
    case "url":
    case "email":
    case "phone_number":
      return { [type]: value === null || value === undefined || value === "" ? null : asText(value, bad) };
    case "people":
      if (!Array.isArray(value)) bad("an array of user ids");
      return { people: (value as unknown[]).map((v) => ({ object: "user", id: asIdLike(v, bad) })) };
    case "relation":
      if (!Array.isArray(value)) bad("an array of page ids");
      return { relation: (value as unknown[]).map((v) => ({ id: asIdLike(v, bad) })) };
    case "files":
      if (!Array.isArray(value)) bad("an array of { name, url }");
      return {
        files: (value as unknown[]).map((v) => {
          const f = (v ?? {}) as { name?: string; url?: string };
          if (typeof f.url !== "string") bad("an array of { name, url }");
          return { name: f.name ?? f.url ?? "", type: "external", external: { url: f.url } };
        }),
      };
    // Everything the workspace computes for itself. Sending these is not a
    // no-op — the API rejects the whole request — so they are refused here
    // with the reason rather than passed through.
    case "formula":
    case "rollup":
    case "created_time":
    case "created_by":
    case "last_edited_time":
    case "last_edited_by":
    case "unique_id":
    case "button":
    case "verification":
      throw new Error(
        `${name} is a ${type} property — Notion computes it and refuses writes. Remove it from the update.`,
      );
    default:
      throw new Error(
        `${name} has property type "${type}", which this adapter does not know how to write. ` +
          `Use request('PATCH', '/pages/<id>', …) to send the payload yourself.`,
      );
  }
}

/** Plain values + the data source schema → a `properties` payload. */
export function toProperties(
  values: Record<string, unknown>,
  schema: Record<string, { type: string }>,
): Record<string, RawPropertyValue> {
  const out: Record<string, RawPropertyValue> = {};
  for (const [name, value] of Object.entries(values)) {
    const column = schema[name];
    if (!column) {
      const known = Object.keys(schema);
      throw new Error(
        `no property named ${JSON.stringify(name)}${known.length ? ` — this data source has ${known.join(", ")}` : ""}`,
      );
    }
    out[name] = toPropertyValue(column.type, value, JSON.stringify(name));
  }
  return out;
}

function asText(value: unknown, bad: (want: string) => never): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return bad("a string");
}

function asIdLike(value: unknown, bad: (want: string) => never): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return bad("an id string");
}

function asDate(value: unknown, bad: (want: string) => never): DateValue | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return { start: value.toISOString() };
  if (typeof value === "string") return { start: value };
  if (typeof value === "object") {
    const d = value as { start?: unknown; end?: unknown; timeZone?: unknown; time_zone?: unknown };
    if (typeof d.start !== "string") bad("an ISO date string or { start, end? }");
    return {
      start: d.start as string,
      ...(typeof d.end === "string" ? { end: d.end } : {}),
      ...(typeof (d.timeZone ?? d.time_zone) === "string" ? { time_zone: (d.timeZone ?? d.time_zone) as string } : {}),
    };
  }
  return bad("an ISO date string or { start, end? }");
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value instanceof Date) return "a Date";
  return typeof value;
}

// ---------------------------------------------------------------- parents

/** A parent reference, normalized across the shapes the API uses. */
export interface NotionParent {
  type: "page" | "database" | "data_source" | "block" | "workspace" | "unknown";
  id?: string;
}

/**
 * Read a parent without caring which migration era produced it.
 *
 * A page created before API version 2025-09-03 carries `parent.database_id`;
 * one created after carries `parent.data_source_id`, and both are in the wild
 * for as long as the split is rolling out. Code that reads only one of them
 * works until it doesn't.
 */
export function readParent(parent: RawParent | undefined): NotionParent {
  if (!parent) return { type: "unknown" };
  if (parent.data_source_id) return { type: "data_source", id: parent.data_source_id };
  if (parent.database_id) return { type: "database", id: parent.database_id };
  if (parent.page_id) return { type: "page", id: parent.page_id };
  if (parent.block_id) return { type: "block", id: parent.block_id };
  if (parent.workspace) return { type: "workspace" };
  return { type: "unknown" };
}
