/**
 * `env:notion` — a workspace, mounted where the work happens.
 *
 * Notion is where the source material already is: the spec, the tracker, the
 * meeting notes, the table someone maintains by hand. Reaching it through
 * tool calls means the whole of every page lands in the context window, and a
 * two-hundred-row database is unreadable before it is useful. Reaching it
 * from inside a script means the page lands in a variable, the rows land in
 * an array, and only the answer comes back.
 *
 * Three decisions shape the surface, all of them from the object model rather
 * than from taste:
 *
 * - **Pages read as markdown.** A block tree whose text is a span tree is the
 *   correct wire format and an unusable one to reason over. `pages.read`
 *   renders it; `blocks.children` still returns the tree for code that needs
 *   structure, and `{ raw: true }` returns the API's own objects for code that
 *   needs everything.
 * - **Rows read as plain values.** `properties.Status` is `'In progress'`,
 *   not `{ type: 'status', status: { name: 'In progress', color: 'blue' } }`.
 *   Writing goes back the other way against the data source's schema, so a
 *   string reaches a select as an option and a date as a date.
 * - **Databases and data sources are different objects**, because since API
 *   version `2025-09-03` they are. A database holds one or more data sources;
 *   a data source holds the schema and the rows. Passing a database id where
 *   a data source belongs is the single most likely mistake against this API,
 *   so every entry point that can resolve one to the other does, and says so
 *   when it cannot.
 *
 * What this deliberately does not do: no view configuration (a view is a
 * projection the API does not expose), no permissions, no workspace
 * administration. `request()` is the way through for anything the bindings do
 * not cover — the block type enum grows faster than any wrapper, and
 * `unsupported` is a real return value.
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import { NotionClient, NotionApiError, type FetchLike, type NotionClientOptions } from "./client";
import { dashed, toId } from "./ids";
import {
  pageTitle,
  readParent,
  readProperties,
  richText,
  toProperties,
  type NotionParent,
  type PropertyValue,
  type RawBlock,
  type RawPage,
  type RichText,
} from "./model";
import { fromMarkdown, normalizeBlocks, toMarkdown, type NotionBlock } from "./markdown";
import { NOTION_DOCS, NOTION_TYPES } from "./docs";
import { NOTION_SKILLS } from "./skills";

export { NotionApiError, NotionClient } from "./client";
export * from "./model";
export * from "./markdown";
export { dashed, isId, toId } from "./ids";

/** Hosts a Notion-hosted file URL is ever served from. */
const DEFAULT_ASSET_HOSTS = [
  "file.notion.so",
  "img.notion.so",
  "s3.us-west-2.amazonaws.com",
  "prod-files-secure.s3.us-west-2.amazonaws.com",
  "*.amazonaws.com",
];

export interface NotionAdapterOptions extends NotionClientOptions {
  /**
   * Hosts `download` will fetch from. Defaults to the ones Notion serves
   * files on.
   *
   * This is a real boundary, not a formality: the environment has no network
   * by construction, and an unrestricted `download(url, path)` would hand one
   * back — a script could name any address the host process can reach and
   * write the response into the tree. Entries may lead with `*.`.
   */
  allowHosts?: string[];
  /** Largest file `download` will write. Default 50 MB. */
  maxDownloadBytes?: number;
  /** How deep `pages.read` walks the block tree by default. Default 4. */
  depth?: number;
}

// ------------------------------------------------------------------ shapes

/** A page's identity and properties, without its content. */
export interface NotionPageInfo {
  id: string;
  url: string;
  title: string;
  parent: NotionParent;
  createdTime?: string;
  lastEditedTime?: string;
  archived: boolean;
  /** Flat values — see `readProperty` for the mapping. Empty for a page outside a data source. */
  properties: Record<string, PropertyValue>;
}

/** A page with its content rendered. */
export interface NotionPageContent extends NotionPageInfo {
  markdown: string;
  blocks: NotionBlock[];
  /** Set when the walk stopped at `depth` and blocks below it were not fetched. */
  truncated?: boolean;
}

/** What `describe` returns for any id or URL. */
export interface NotionSummary {
  id: string;
  object: "page" | "database" | "data_source" | "block" | "unknown";
  title: string;
  url?: string;
  parent?: NotionParent;
  /** Databases only: the data sources they contain. Query one of these, not the database. */
  dataSources?: Array<{ id: string; name: string }>;
  /** Data sources only: the schema, as property name → type. */
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
  /** Restrict to one kind. `data_source` is the queryable one; `database` is the container. */
  filter?: "page" | "data_source" | "database";
  /** Stop at this many results. Default 100. */
  limit?: number;
  /** `last_edited_time` descending by default; pass `"relevance"` for Notion's own ranking. */
  sort?: "recent" | "relevance";
}

export interface DatabaseInfo {
  id: string;
  title: string;
  url?: string;
  parent: NotionParent;
  /** One or more. Everything schema- and row-shaped happens on these, not on the database. */
  dataSources: Array<{ id: string; name: string }>;
}

export interface DataSourceColumn {
  id?: string;
  type: string;
  /** `select`, `multi_select` and `status` only: the defined option names. */
  options?: string[];
}

export interface DataSourceInfo {
  id: string;
  name: string;
  databaseId?: string;
  properties: Record<string, DataSourceColumn>;
  /** The single `title` property's name — the one that is also the page title. */
  titleProperty: string;
}

/** One row. `properties` holds plain values keyed by column name. */
export interface NotionRow {
  id: string;
  url: string;
  title: string;
  properties: Record<string, PropertyValue>;
}

export interface QueryOptions {
  /** A Notion filter object, passed through unchanged. */
  filter?: Record<string, unknown>;
  /** Notion sort objects, passed through unchanged. */
  sorts?: Array<Record<string, unknown>>;
  /** Stop at this many rows. Without one, every row is fetched. */
  limit?: number;
  /** Keep only these columns. Everything else is dropped before the row is returned. */
  properties?: string[];
}

/** Where a new page goes. A bare string is resolved to whichever it turns out to be. */
export type PageParent = string | { pageId: string } | { dataSourceId: string } | { databaseId: string };

export interface NewPage {
  /** The title. Shorthand for the data source's title property. */
  title?: string;
  /** Plain values, keyed by column name, coerced against the schema. */
  properties?: Record<string, unknown>;
  /** Body content. Markdown is converted; raw block payloads pass through. */
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
  /** How deep to walk. Default 4. Deeper costs one request per block with children. */
  depth?: number;
}

export interface ChildrenOptions extends ReadOptions {
  /** Return the API's own block objects instead of the reduced shape. */
  raw?: boolean;
}

export interface ExportOptions extends ReadOptions {
  /** Also write every child page, into a directory beside the file. Default false. */
  recursive?: boolean;
  /** Pull images and files into the tree and rewrite the links to them. Default false. */
  assets?: boolean;
  /** Most pages a recursive export will write. Default 100. */
  maxPages?: number;
}

export interface PageExport {
  /** The file the page itself was written to. */
  path: string;
  /** Every file written, this one included. */
  files: string[];
  pages: number;
  /** Asset files pulled into the tree, when `assets` was set. */
  assets?: string[];
}

export interface NewDatabase {
  /** The page it lives under. */
  parentPageId: string;
  title: string;
  /**
   * The initial data source's schema, as column name → type, or → a full
   * Notion property definition. Exactly one `title` column is required, and
   * one is added if you leave it out.
   */
  properties: Record<string, string | Record<string, unknown>>;
}

// ------------------------------------------------------------------ adapter

export function notion(options: NotionAdapterOptions) {
  const client = new NotionClient(options);
  const allowHosts = options.allowHosts ?? DEFAULT_ASSET_HOSTS;
  const maxDownloadBytes = Math.max(1, options.maxDownloadBytes ?? 50 * 1024 * 1024);
  const defaultDepth = Math.max(1, options.depth ?? 4);
  const rawFetch: FetchLike | undefined = options.fetch;

  return defineAdapter({
    name: "notion",
    description:
      "Read and write a Notion workspace: pages as markdown, database rows as flat records, files pulled into the tree.",
    types: NOTION_TYPES,
    docs: NOTION_DOCS,
    skills: NOTION_SKILLS,

    create(vfs: EnvFsHandle) {
      // Both caches are per-environment and per-`create` call, which means
      // they are also per read-only validation instance — no state leaks
      // between the real bindings and the ones used to validate a script.
      const kinds = new Map<string, NotionSummary["object"]>();
      const schemas = new Map<string, DataSourceInfo>();

      // ------------------------------------------------------- resolving

      /** What kind of object an id names, discovered by asking. */
      const kindOf = async (id: string): Promise<NotionSummary["object"]> => {
        const cached = kinds.get(id);
        if (cached) return cached;
        for (const [kind, path] of [
          ["page", "pages"],
          ["data_source", "data_sources"],
          ["database", "databases"],
          ["block", "blocks"],
        ] as const) {
          try {
            await client.request("GET", `/${path}/${id}`);
            kinds.set(id, kind);
            return kind;
          } catch (e) {
            if (e instanceof NotionApiError && (e.status === 404 || e.status === 400)) continue;
            throw e;
          }
        }
        throw new Error(
          `nothing in this workspace answers to ${id} — it is not a page, data source, database or block. ` +
            `Either the id is wrong, or the integration has not been given access to it.`,
        );
      };

      /**
       * A database id → the data source to actually work with.
       *
       * One data source is the overwhelmingly common case and resolving it
       * silently is right. Two or more is genuinely ambiguous, and picking
       * the first would write rows into whichever table happened to be
       * created first — so it refuses, and names them.
       */
      const dataSourceOfDatabase = async (databaseId: string): Promise<string> => {
        const database = await databases.get(databaseId);
        if (database.dataSources.length === 1) return database.dataSources[0].id;
        if (database.dataSources.length === 0) {
          throw new Error(`database ${databaseId} has no data sources — there is nothing to read or write`);
        }
        const listed = database.dataSources.map((d) => `${d.name} (${d.id})`).join(", ");
        throw new Error(
          `database ${databaseId} holds ${database.dataSources.length} data sources — pass the one you mean: ${listed}`,
        );
      };

      /** Any reference to a table → the data source id. */
      const asDataSourceId = async (target: string): Promise<string> => {
        const id = toId(target);
        const kind = await kindOf(id);
        if (kind === "data_source") return id;
        if (kind === "database") return dataSourceOfDatabase(id);
        throw new Error(
          `${id} is a ${kind}, not a data source. Rows live in data sources; use describe() to find the one you want.`,
        );
      };

      const schemaOf = async (dataSourceId: string): Promise<DataSourceInfo> => {
        const cached = schemas.get(dataSourceId);
        if (cached) return cached;
        const info = await dataSources.get(dataSourceId);
        schemas.set(dataSourceId, info);
        return info;
      };

      // --------------------------------------------------------- blocks

      /** Every child of a block, walked `depth` levels deep. */
      const fetchChildren = async (
        id: string,
        depth: number,
        state: { truncated: boolean },
      ): Promise<RawBlock[]> => {
        const children = await client.collect<RawBlock>("GET", `/blocks/${id}/children`, undefined);
        if (depth <= 1) {
          if (children.some((child) => child.has_children)) state.truncated = true;
          return children;
        }
        for (const child of children) {
          if (!child.has_children) continue;
          // A synced duplicate reports children; they are the original's, and
          // fetching them is what makes the mirrored content readable at all.
          (child as Record<string, unknown>).children = await fetchChildren(child.id, depth - 1, state);
        }
        return children;
      };

      const asBlocks = (content: { markdown?: string; blocks?: RawBlock[] }): RawBlock[] => {
        if (Array.isArray(content.blocks) && content.blocks.length > 0) return content.blocks;
        if (typeof content.markdown === "string" && content.markdown.trim() !== "") return fromMarkdown(content.markdown);
        return [];
      };

      /** The API takes 100 children per request; more than that is several requests. */
      const appendChunked = async (id: string, blocks: RawBlock[]): Promise<number> => {
        for (let i = 0; i < blocks.length; i += 100) {
          await client.request("PATCH", `/blocks/${id}/children`, { children: blocks.slice(i, i + 100) });
        }
        return blocks.length;
      };

      // ---------------------------------------------------------- pages

      const toPageInfo = (page: RawPage): NotionPageInfo => ({
        id: page.id,
        url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
        title: pageTitle(page),
        parent: readParent(page.parent),
        ...(page.created_time ? { createdTime: page.created_time } : {}),
        ...(page.last_edited_time ? { lastEditedTime: page.last_edited_time } : {}),
        archived: page.archived === true || page.in_trash === true,
        properties: readProperties(page.properties),
      });

      /** The schema a page's properties are written against, when it has one. */
      const schemaForPage = async (page: RawPage): Promise<DataSourceInfo | null> => {
        const parent = readParent(page.parent);
        if (parent.type === "data_source" && parent.id) return schemaOf(parent.id);
        if (parent.type === "database" && parent.id) return schemaOf(await dataSourceOfDatabase(parent.id));
        return null;
      };

      const iconPayload = (icon: string | undefined): Record<string, unknown> | undefined => {
        if (!icon) return undefined;
        return /^https?:\/\//i.test(icon)
          ? { type: "external", external: { url: icon } }
          : { type: "emoji", emoji: icon };
      };

      const pages = {
        /** Identity and properties, without walking the body. */
        async get(target: string): Promise<NotionPageInfo> {
          const page = await client.request<RawPage>("GET", `/pages/${toId(target)}`);
          kinds.set(page.id, "page");
          return toPageInfo(page);
        },

        /** The whole page: properties, plus its content rendered as markdown. */
        async read(target: string, opts: ReadOptions = {}): Promise<NotionPageContent> {
          const id = toId(target);
          const page = await client.request<RawPage>("GET", `/pages/${id}`);
          kinds.set(page.id, "page");
          const state = { truncated: false };
          const tree = await fetchChildren(id, Math.max(1, opts.depth ?? defaultDepth), state);
          return {
            ...toPageInfo(page),
            markdown: toMarkdown(tree),
            blocks: normalizeBlocks(tree),
            ...(state.truncated ? { truncated: true } : {}),
          };
        },

        /**
         * Create a page, under another page or as a row in a data source.
         *
         * `title` is a shorthand: under a page it is the page title, and in a
         * data source it fills whichever column holds the title.
         */
        async create(parent: PageParent, spec: NewPage = {}): Promise<NotionPageInfo> {
          const target = await resolveParent(parent);
          const body: Record<string, unknown> = { parent: target.payload };

          if (target.dataSourceId) {
            const schema = await schemaOf(target.dataSourceId);
            const values = { ...(spec.properties ?? {}) };
            if (spec.title !== undefined) values[schema.titleProperty] = spec.title;
            body.properties = toProperties(values, schema.properties);
          } else {
            if (spec.properties && Object.keys(spec.properties).length > 0) {
              throw new Error(
                "a page created under another page has no schema, so it has no properties but its title — " +
                  "create it in a data source if it needs columns",
              );
            }
            body.properties = { title: { title: richText(spec.title ?? "Untitled") } };
          }

          const icon = iconPayload(spec.icon);
          if (icon) body.icon = icon;

          // Content goes in the create call up to the API's 100-child limit,
          // then continues as appends — one page, however long the body.
          const blocks = asBlocks(spec);
          if (blocks.length > 0) body.children = blocks.slice(0, 100);

          const created = await client.request<RawPage>("POST", "/pages", body);
          kinds.set(created.id, "page");
          if (blocks.length > 100) await appendChunked(created.id, blocks.slice(100));
          return toPageInfo(created);
        },

        /** Change properties, the title, the icon, or trash state. */
        async update(target: string, patch: PageUpdate = {}): Promise<NotionPageInfo> {
          const id = toId(target);
          const body: Record<string, unknown> = {};

          if (patch.properties || patch.title !== undefined) {
            const page = await client.request<RawPage>("GET", `/pages/${id}`);
            const schema = await schemaForPage(page);
            if (schema) {
              const values = { ...(patch.properties ?? {}) };
              if (patch.title !== undefined) values[schema.titleProperty] = patch.title;
              body.properties = toProperties(values, schema.properties);
            } else {
              if (patch.properties && Object.keys(patch.properties).length > 0) {
                throw new Error(`${id} is not a row in a data source, so it has no properties but its title`);
              }
              const titleKey = Object.entries(page.properties ?? {}).find(([, v]) => v?.type === "title")?.[0] ?? "title";
              body.properties = { [titleKey]: { title: richText(patch.title ?? "") } };
            }
          }

          const icon = iconPayload(patch.icon);
          if (icon) body.icon = icon;
          if (patch.archived !== undefined) body.in_trash = patch.archived;

          if (Object.keys(body).length === 0) throw new Error("update() was given nothing to change");
          const updated = await client.request<RawPage>("PATCH", `/pages/${id}`, body);
          return toPageInfo(updated);
        },

        /** Add content to the end of a page. Markdown or raw blocks. */
        async append(target: string, content: string | { markdown?: string; blocks?: RawBlock[] }): Promise<number> {
          const id = toId(target);
          const blocks = asBlocks(typeof content === "string" ? { markdown: content } : content);
          if (blocks.length === 0) throw new Error("append() was given no content");
          return appendChunked(id, blocks);
        },

        /**
         * Write a page into the tree as markdown.
         *
         * This is the bridge to the rest of the environment: the file it
         * writes is an ordinary path, so `env:documents` can turn it into a
         * PDF and `env:fs` can grep it.
         */
        async export(target: string, path: string, opts: ExportOptions = {}): Promise<PageExport> {
          const depth = Math.max(1, opts.depth ?? defaultDepth);
          const maxPages = Math.max(1, opts.maxPages ?? 100);
          const files: string[] = [];
          const assets: string[] = [];
          const seen = new Set<string>();

          const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
          const assetDir = `${dir}/${baseName(path)}.assets`;

          const writeOne = async (pageTarget: string, filePath: string): Promise<string[]> => {
            const id = toId(pageTarget);
            if (seen.has(id) || seen.size >= maxPages) return [];
            seen.add(id);

            const page = await client.request<RawPage>("GET", `/pages/${id}`);
            const state = { truncated: false };
            const tree = await fetchChildren(id, depth, state);
            let markdown = `# ${pageTitle(page) || "Untitled"}\n\n${toMarkdown(tree)}\n`;

            if (opts.assets) {
              for (const url of assetUrls(tree)) {
                const assetPath = `${assetDir}/${assetName(url, assets.length + 1)}`;
                try {
                  await download(url, assetPath);
                  assets.push(assetPath);
                  markdown = markdown.split(url).join(assetPath);
                } catch {
                  // A signed URL that has already expired is not a reason to
                  // lose the page; the link stays as it was.
                }
              }
            }

            await vfs.writeFile(filePath, markdown);
            files.push(filePath);

            if (!opts.recursive) return [];
            return tree.filter((b) => b.type === "child_page").map((b) => b.id);
          };

          const children = await writeOne(target, path);
          const queue = [...children];
          while (queue.length > 0 && seen.size < maxPages) {
            const childId = queue.shift() as string;
            const childDir = `${dir}/${baseName(path)}`;
            const more = await writeOne(childId, `${childDir}/${dashed(childId).replace(/-/g, "")}.md`);
            queue.push(...more);
          }

          return { path, files, pages: files.length, ...(opts.assets ? { assets } : {}) };
        },
      };

      // -------------------------------------------------------- databases

      const databases = {
        /** The container, and the data sources inside it. */
        async get(target: string): Promise<DatabaseInfo> {
          const raw = await client.request<Record<string, unknown>>("GET", `/databases/${toId(target)}`);
          const id = String(raw.id ?? toId(target));
          kinds.set(id, "database");
          const listed = Array.isArray(raw.data_sources) ? (raw.data_sources as Array<Record<string, unknown>>) : [];
          return {
            id,
            title: titleOf(raw.title),
            ...(typeof raw.url === "string" ? { url: raw.url } : {}),
            parent: readParent(raw.parent as never),
            dataSources: listed.map((d) => ({ id: String(d.id ?? ""), name: String(d.name ?? "") })),
          };
        },

        /** A new database with one data source, under a page. */
        async create(spec: NewDatabase): Promise<DatabaseInfo> {
          const properties = expandSchema(spec.properties);
          const raw = await client.request<Record<string, unknown>>("POST", "/databases", {
            parent: { type: "page_id", page_id: toId(spec.parentPageId) },
            title: richText(spec.title),
            initial_data_source: { properties },
          });
          const id = String(raw.id ?? "");
          kinds.set(id, "database");
          const listed = Array.isArray(raw.data_sources) ? (raw.data_sources as Array<Record<string, unknown>>) : [];
          return {
            id,
            title: spec.title,
            ...(typeof raw.url === "string" ? { url: raw.url } : {}),
            parent: readParent(raw.parent as never),
            dataSources: listed.map((d) => ({ id: String(d.id ?? ""), name: String(d.name ?? "") })),
          };
        },
      };

      // ------------------------------------------------------ data sources

      const dataSources = {
        /** The schema: every column, its type, and the options a select offers. */
        async get(target: string): Promise<DataSourceInfo> {
          const id = toId(target);
          const raw = await client.request<Record<string, unknown>>("GET", `/data_sources/${id}`);
          kinds.set(id, "data_source");
          const columns = (raw.properties ?? {}) as Record<string, Record<string, unknown>>;

          const properties: Record<string, DataSourceColumn> = {};
          let titleProperty = "";
          for (const [name, column] of Object.entries(columns)) {
            const type = String(column.type ?? "");
            if (type === "title") titleProperty = name;
            const config = column[type] as { options?: Array<{ name?: string }>; groups?: unknown } | undefined;
            const options = Array.isArray(config?.options)
              ? config.options.map((o) => String(o?.name ?? "")).filter(Boolean)
              : undefined;
            properties[name] = {
              ...(typeof column.id === "string" ? { id: column.id } : {}),
              type,
              ...(options && options.length > 0 ? { options } : {}),
            };
          }

          const parent = readParent(raw.parent as never);
          return {
            id,
            name: titleOf(raw.title) || titleOf(raw.name),
            ...(parent.type === "database" && parent.id ? { databaseId: parent.id } : {}),
            properties,
            titleProperty: titleProperty || "Name",
          };
        },

        /**
         * Rows, as flat records.
         *
         * Accepts a data source id or a database id — a database with exactly
         * one data source resolves to it, and one with several refuses and
         * names them, because picking would silently query the wrong table.
         */
        async query(target: string, opts: QueryOptions = {}): Promise<NotionRow[]> {
          const id = await asDataSourceId(target);
          const body: Record<string, unknown> = {};
          if (opts.filter) body.filter = opts.filter;
          if (opts.sorts) body.sorts = opts.sorts;

          const raw = await client.collect<RawPage>("POST", `/data_sources/${id}/query`, body, opts.limit);
          const keep = opts.properties ? new Set(opts.properties) : null;

          return raw.map((page) => {
            const properties = readProperties(page.properties);
            return {
              id: page.id,
              url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
              title: pageTitle(page),
              properties: keep
                ? Object.fromEntries(Object.entries(properties).filter(([name]) => keep.has(name)))
                : properties,
            };
          });
        },
      };

      // ----------------------------------------------------------- blocks

      const blocks = {
        /** A block's children, walked `depth` levels. A page id is a block id. */
        async children(target: string, opts: ChildrenOptions = {}): Promise<NotionBlock[] | RawBlock[]> {
          const state = { truncated: false };
          const tree = await fetchChildren(toId(target), Math.max(1, opts.depth ?? defaultDepth), state);
          return opts.raw ? tree : normalizeBlocks(tree);
        },

        /** Append blocks, or markdown converted to them. */
        async append(target: string, content: string | { markdown?: string; blocks?: RawBlock[] }): Promise<number> {
          return pages.append(target, content);
        },

        /**
         * Change one block in place. The patch is the API's own type-keyed
         * shape — `{ to_do: { checked: true } }`, `{ paragraph: { rich_text: … } }`.
         */
        async update(target: string, patch: Record<string, unknown>): Promise<RawBlock> {
          return client.request<RawBlock>("PATCH", `/blocks/${toId(target)}`, patch);
        },

        /** Move a block to the trash. Recoverable in Notion for 30 days. */
        async remove(target: string): Promise<{ id: string; archived: true }> {
          const id = toId(target);
          await client.request("DELETE", `/blocks/${id}`);
          return { id, archived: true };
        },
      };

      // ------------------------------------------------------- top level

      /**
       * Pull a file out of Notion and into the tree.
       *
       * Notion-hosted URLs are signed and expire within the hour, so a URL
       * read from a page is worth exactly one fetch. Everything downstream —
       * `env:documents`, `env:images`, `env:ocr` — works on paths, and this is
       * how a Notion attachment becomes one.
       */
      const download = async (url: string, path: string): Promise<string> => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error(`download() needs an absolute URL, got ${JSON.stringify(url)}`);
        }
        if (parsed.protocol !== "https:") throw new Error(`refusing to fetch ${parsed.protocol}// — https only`);
        if (!hostAllowed(parsed.hostname, allowHosts)) {
          throw new Error(
            `refusing to fetch from ${parsed.hostname}. This environment has no network of its own, and ` +
              `download() is not a general one: it reaches the hosts Notion serves files from ` +
              `(${allowHosts.join(", ")}). Pass allowHosts to notion() to widen it.`,
          );
        }

        const ambient = globalThis.fetch;
        const fetcher: FetchLike = rawFetch ?? ((u, init) => ambient(u, init));
        const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) {
          throw new Error(
            `${parsed.hostname} returned ${response.status} for this file. A Notion file URL is signed and ` +
              `short-lived — re-read the page to get a fresh one rather than reusing a stored URL.`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxDownloadBytes) {
          throw new Error(`${path} would be ${bytes.byteLength} bytes, over the ${maxDownloadBytes} cap`);
        }
        await vfs.writeFile(path, bytes);
        return path;
      };

      const resolveParent = async (
        parent: PageParent,
      ): Promise<{ payload: Record<string, unknown>; dataSourceId?: string }> => {
        if (typeof parent === "object" && parent !== null) {
          if ("dataSourceId" in parent) {
            const id = toId(parent.dataSourceId);
            return { payload: { type: "data_source_id", data_source_id: id }, dataSourceId: id };
          }
          if ("databaseId" in parent) {
            const id = await dataSourceOfDatabase(toId(parent.databaseId));
            return { payload: { type: "data_source_id", data_source_id: id }, dataSourceId: id };
          }
          if ("pageId" in parent) return { payload: { type: "page_id", page_id: toId(parent.pageId) } };
        }
        if (typeof parent !== "string") throw new Error("parent must be an id, a URL, or { pageId } / { dataSourceId }");

        const id = toId(parent);
        const kind = await kindOf(id);
        if (kind === "page") return { payload: { type: "page_id", page_id: id } };
        if (kind === "data_source") return { payload: { type: "data_source_id", data_source_id: id }, dataSourceId: id };
        if (kind === "database") {
          const dataSourceId = await dataSourceOfDatabase(id);
          return { payload: { type: "data_source_id", data_source_id: dataSourceId }, dataSourceId };
        }
        throw new Error(`${id} is a ${kind} — a page can only be created under a page or in a data source`);
      };

      return {
        pages,
        databases,
        dataSources,
        blocks,
        download,

        /**
         * What is this? The cheap first call, for an id or a pasted URL, when
         * you do not yet know whether you are holding a page, a database or
         * the data source inside it.
         */
        async describe(target: string): Promise<NotionSummary> {
          const id = toId(target);
          const kind = await kindOf(id);

          if (kind === "page") {
            const info = await pages.get(id);
            const children = await client.collect<RawBlock>("GET", `/blocks/${id}/children`, undefined);
            return {
              id,
              object: "page",
              title: info.title,
              url: info.url,
              parent: info.parent,
              blocks: children.length,
            };
          }
          if (kind === "database") {
            const info = await databases.get(id);
            return {
              id,
              object: "database",
              title: info.title,
              ...(info.url ? { url: info.url } : {}),
              parent: info.parent,
              dataSources: info.dataSources,
            };
          }
          if (kind === "data_source") {
            const info = await dataSources.get(id);
            return {
              id,
              object: "data_source",
              title: info.name,
              ...(info.databaseId ? { parent: { type: "database" as const, id: info.databaseId } } : {}),
              properties: Object.fromEntries(Object.entries(info.properties).map(([name, c]) => [name, c.type])),
            };
          }

          const raw = await client.request<RawBlock>("GET", `/blocks/${id}`);
          return {
            id,
            object: "block",
            type: raw.type,
            title: normalizeBlocks([raw])[0]?.text ?? "",
            parent: readParent(raw.parent),
          };
        },

        /**
         * Find things by title. Notion's search covers titles only — it does
         * not look inside page content, and it sees only what the integration
         * has been given access to.
         */
        async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
          const body: Record<string, unknown> = { query: String(query ?? "") };
          if (opts.filter) body.filter = { property: "object", value: opts.filter };
          if (opts.sort !== "relevance") body.sort = { direction: "descending", timestamp: "last_edited_time" };

          const raw = await client.collect<Record<string, unknown>>("POST", "/search", body, opts.limit ?? 100);
          return raw.map((hit) => ({
            id: String(hit.id ?? ""),
            object: String(hit.object ?? "unknown"),
            title: hit.object === "page" ? pageTitle(hit as unknown as RawPage) : titleOf(hit.title),
            ...(typeof hit.url === "string" ? { url: hit.url } : {}),
            ...(typeof hit.last_edited_time === "string" ? { lastEditedTime: hit.last_edited_time } : {}),
            parent: readParent(hit.parent as never),
          }));
        },

        /**
         * The escape hatch. Any endpoint, any body, the raw response.
         *
         * The block type enum grows faster than any wrapper around it, and
         * `unsupported` is a real return value — so there is always a way
         * through rather than a wall.
         */
        async request(method: string, path: string, body?: unknown): Promise<unknown> {
          return client.request(method, path, body);
        },
      };
    },
  });
}

export default notion;

// ------------------------------------------------------------------ helpers

/** `title` comes back as spans on a database, and as a plain string in places. */
function titleOf(title: unknown): string {
  if (typeof title === "string") return title;
  if (!Array.isArray(title)) return "";
  return (title as RichText[]).map((span) => span?.plain_text ?? span?.text?.content ?? "").join("");
}

function hostAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

function baseName(path: string): string {
  const last = path.split("/").pop() ?? path;
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}

/** Every file URL in a block tree, in document order, de-duplicated. */
function assetUrls(blocks: RawBlock[]): string[] {
  const urls: string[] = [];
  const walk = (list: RawBlock[]) => {
    for (const block of list) {
      const body = (block as Record<string, unknown>)[block.type];
      if (body && typeof body === "object") {
        const hosted = (body as { file?: { url?: string } }).file?.url;
        if (typeof hosted === "string" && hosted !== "") urls.push(hosted);
      }
      const kids = (block as Record<string, unknown>).children;
      if (Array.isArray(kids)) walk(kids as RawBlock[]);
    }
  };
  walk(blocks);
  return [...new Set(urls)];
}

/** A signed URL's filename, with its query string discarded. */
function assetName(url: string, ordinal: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    name = "";
  }
  name = name.replace(/[^\w.\-]/g, "_");
  return name === "" || name === "." || name === ".." ? `asset-${ordinal}` : `${ordinal}-${name}`;
}

/** `{ Status: 'select' }` → the full property definition the API wants. */
function expandSchema(properties: Record<string, string | Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let hasTitle = false;
  for (const [name, spec] of Object.entries(properties ?? {})) {
    if (typeof spec === "string") {
      if (spec === "title") hasTitle = true;
      out[name] = { [spec]: {} };
    } else {
      if ("title" in spec) hasTitle = true;
      out[name] = spec;
    }
  }
  if (!hasTitle) out.Name = { title: {} };
  return out;
}
