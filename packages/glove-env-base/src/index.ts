/**
 * `env:base` — pages, blocks and collections, mounted where the work happens.
 *
 * The source material an agent needs is rarely in the conversation. It is in
 * a wiki, a tracker, a doc tool, an internal knowledge base — somewhere with
 * pages that nest, content that is a tree, and tables whose rows are
 * themselves pages. Reaching that through tool calls means the whole of every
 * page lands in the context window, and a two-hundred-row table is unreadable
 * before it is useful. Reaching it from inside a script means the page lands
 * in a variable, the rows land in an array, and only the answer comes back.
 *
 * This package is the half of that which does not depend on whose backend it
 * is:
 *
 * - **The object model** — {@link Page}, {@link Block}, {@link Collection},
 *   rich text as spans, property values flattened to plain JavaScript.
 * - **Markdown both ways**, because a block tree whose text is a span tree is
 *   the right wire format and an unusable one to reason over.
 * - **Tree walking**, with a depth the caller sets and an honest `truncated`
 *   when it stops early.
 * - **Schema-checked writes**, so a bad column name fails here — naming the
 *   real ones — rather than as a 400 that names a JSON path.
 * - **Export into the filesystem**, which is what makes a page reachable by
 *   `env:documents`, `env:images` and `env:ocr`.
 *
 * The other half — actually talking to something — is a {@link Provider}, and
 * that is yours to write. Two methods are required and the rest are
 * capabilities: base reports what a provider does not implement instead of
 * crashing into it, so a read-only backend is a first-class one.
 *
 * ```ts
 * import { createWorkingEnvironment } from "glove-working-environment";
 * import { base } from "glove-env-base";
 *
 * const env = await createWorkingEnvironment({ stdlib: [base({ provider: myWiki })] });
 * ```
 */
import { defineAdapter, type EnvFsHandle } from "glove-working-environment";
import {
  ProviderError,
  UnsupportedError,
  type Block,
  type Collection,
  type Condition,
  type Page,
  type PropertyValue,
  type Query,
  type Ref,
} from "./model";
import {
  applySort,
  applyWhere,
  isComputed,
  validateWrite,
} from "./schema";
import {
  call,
  capabilitiesOf,
  need,
  type Capabilities,
  type PageInput,
  type PagePatch,
  type ParentRef,
  type Provider,
} from "./provider";
import { flatten, fromMarkdown, toMarkdown, type FlatBlock } from "./markdown";
import { BASE_DOCS, BASE_TYPES } from "./docs";
import { BASE_SKILLS } from "./skills";

export * from "./model";
export * from "./markdown";
export * from "./schema";
export * from "./provider";
export * from "./http";

// ------------------------------------------------------------------ options

export interface BaseAdapterOptions {
  /** The backend. See {@link Provider} — two methods required, the rest optional. */
  provider: Provider;
  /** How deep `pages.read` and `blocks.children` walk by default. Default 4. */
  depth?: number;
  /**
   * Blocks per `appendBlocks` call. Default 100, which is the cap most APIs
   * impose. Base splits a long body for you; a provider never sees more.
   */
  appendChunk?: number;
  /** Largest file `download` will write. Default 50 MB. */
  maxDownloadBytes?: number;
  /** Most pages a recursive export will write. Default 100. */
  maxExportPages?: number;
  /** Module name, if you mount two backends at once: `env:wiki`, `env:crm`. */
  name?: string;
}

// ------------------------------------------------------------------- shapes

/** A page with its content rendered. */
export interface PageContent extends Page {
  markdown: string;
  blocks: FlatBlock[];
  /** Set when the walk stopped at `depth` and deeper blocks were not fetched. */
  truncated?: boolean;
}

/** What `describe` returns for any reference. */
export interface Summary {
  id: string;
  kind: Ref["type"];
  title: string;
  url?: string;
  parent?: Ref;
  /** Collections only: the schema, as column name → type. */
  schema?: Record<string, string>;
  /** Collections only: which columns the backend computes. */
  computed?: string[];
  /** Pages only: how many top-level blocks the body holds. */
  blocks?: number;
  /** Pages only: the column names, when the page is a row. */
  properties?: string[];
}

/** One row. Plain values live under `properties`, keyed by column name. */
export interface Row {
  id: string;
  url?: string;
  title: string;
  properties: Record<string, PropertyValue>;
}

export interface ReadOptions {
  /** How deep to walk. Default 4. Deeper costs one call per block with children. */
  depth?: number;
}

export interface ChildrenOptions extends ReadOptions {
  /** Return the model's own blocks — spans, annotations and all — instead of flattened ones. */
  raw?: boolean;
}

export interface QueryOptions extends Query {
  /** Keep only these columns. Everything else is dropped before the row is returned. */
  properties?: string[];
}

export interface ExportOptions extends ReadOptions {
  /** Also write every child page, into a directory beside the file. Default false. */
  recursive?: boolean;
  /** Pull files into the tree and rewrite the links to them. Needs `fetchFile`. */
  assets?: boolean;
  /** Most pages to write. Defaults to the adapter's `maxExportPages`. */
  maxPages?: number;
}

export interface ExportResult {
  /** The file the page itself was written to. */
  path: string;
  /** Every file written, this one included. */
  files: string[];
  pages: number;
  /** Asset files pulled into the tree, when `assets` was set. */
  assets?: string[];
}

export interface NewPage {
  /** Fills the title column, whatever it is called. */
  title?: string;
  /** Plain values, checked against the collection's schema. */
  properties?: Record<string, unknown>;
  /** Body content. Markdown is converted; blocks pass through. */
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

/** Where a new page goes. A bare string is resolved to whichever it turns out to be. */
export type Parent = string | { pageId: string } | { collectionId: string };

// ------------------------------------------------------------------ adapter

export function base(options: BaseAdapterOptions) {
  const provider = options.provider;
  if (!provider || typeof provider !== "object") {
    throw new TypeError("base() needs a provider — see the Provider contract; two methods are required");
  }
  for (const required of ["getPage", "listBlocks"] as const) {
    if (typeof provider[required] !== "function") {
      throw new TypeError(
        `base(): provider "${provider.name ?? "(unnamed)"}" must implement ${required}() — it is one of the two ` +
          `methods without which there is nothing to read`,
      );
    }
  }

  const defaultDepth = Math.max(1, options.depth ?? 4);
  const chunk = Math.max(1, options.appendChunk ?? 100);
  const maxDownloadBytes = Math.max(1, options.maxDownloadBytes ?? 50 * 1024 * 1024);
  const maxExportPages = Math.max(1, options.maxExportPages ?? 100);
  const capabilities = capabilitiesOf(provider);

  return defineAdapter({
    name: options.name ?? "base",
    description: `Read and write pages, blocks and collections through the "${provider.name}" provider: pages as markdown, rows as flat records, files into the tree.`,
    types: BASE_TYPES,
    docs: BASE_DOCS,
    skills: BASE_SKILLS,
    close: provider.close ? () => provider.close!() : undefined,

    create(vfs: EnvFsHandle) {
      // Per-environment, and per-`create` call — so nothing leaks between the
      // real bindings and the read-only pair used to validate a script.
      const kinds = new Map<string, Ref["type"]>();
      const schemas = new Map<string, Collection>();

      const ref = (input: string): string => {
        if (typeof input !== "string" || input.trim() === "") {
          throw new Error("expected an id or a URL, got an empty value");
        }
        return provider.parseRef ? provider.parseRef(input.trim()) : input.trim();
      };

      /** What kind of object an id names. Asked once, then remembered. */
      const kindOf = async (id: string): Promise<Ref["type"]> => {
        const cached = kinds.get(id);
        if (cached) return cached;

        if (provider.identify) {
          const kind = await call(provider, "identify", () => provider.identify!(id));
          kinds.set(id, kind);
          return kind;
        }

        // No identify(): probe. Page first, because it is the common case.
        try {
          await call(provider, "getPage", () => provider.getPage(id));
          kinds.set(id, "page");
          return "page";
        } catch (pageError) {
          if (!provider.getCollection) throw pageError;
          try {
            await call(provider, "getCollection", () => provider.getCollection!(id));
            kinds.set(id, "collection");
            return "collection";
          } catch {
            // The page error is the informative one — it is the lookup the
            // caller almost certainly meant.
            throw pageError;
          }
        }
      };

      const collectionOf = async (id: string): Promise<Collection> => {
        const cached = schemas.get(id);
        if (cached) return cached;
        const get = need(provider, "getCollection", "collections are how rows get a schema");
        const collection = await call(provider, "getCollection", () => get.call(provider, id));
        schemas.set(id, collection);
        return collection;
      };

      // --------------------------------------------------------- blocks

      /** Every child of a block, walked `depth` levels, paginating each level. */
      const childrenOf = async (id: string, depth: number, state: { truncated: boolean }): Promise<Block[]> => {
        const blocks: Block[] = [];
        let cursor: string | undefined;
        do {
          const page = await call(provider, "listBlocks", () => provider.listBlocks(id, cursor ? { cursor } : undefined));
          blocks.push(...(page?.blocks ?? []));
          cursor = page?.cursor;
        } while (cursor);

        if (depth <= 1) {
          if (blocks.some((block) => block.hasChildren)) state.truncated = true;
          return blocks;
        }

        for (const block of blocks) {
          // A provider that already nested children is honoured rather than
          // re-walked; verifyProvider warns about it, but doing it twice here
          // would be worse than inconsistent, it would be slow.
          if (block.children && block.children.length > 0) continue;
          if (!block.hasChildren || !block.id) continue;
          block.children = await childrenOf(block.id, depth - 1, state);
        }
        return blocks;
      };

      const bodyOf = (content: { markdown?: string; blocks?: Block[] } | string | undefined): Block[] => {
        if (typeof content === "string") return fromMarkdown(content);
        if (Array.isArray(content?.blocks) && content.blocks.length > 0) return content.blocks;
        if (typeof content?.markdown === "string" && content.markdown.trim() !== "") return fromMarkdown(content.markdown);
        return [];
      };

      const appendAll = async (id: string, blocks: Block[]): Promise<number> => {
        const append = need(provider, "appendBlocks");
        let written = 0;
        for (let i = 0; i < blocks.length; i += chunk) {
          written += (await call(provider, "appendBlocks", () =>
            append.call(provider, id, blocks.slice(i, i + chunk)),
          )) ?? 0;
        }
        // A provider that returns nothing still appended what it was given.
        return written || blocks.length;
      };

      // ---------------------------------------------------------- pages

      /** Values checked against the schema behind a page, when there is one. */
      const checked = async (
        collectionId: string | undefined,
        values: Record<string, unknown> | undefined,
        title: string | undefined,
      ): Promise<Record<string, unknown> | undefined> => {
        const hasValues = values && Object.keys(values).length > 0;
        if (!hasValues && title === undefined) return undefined;

        if (!collectionId) {
          if (hasValues) {
            throw new Error(
              "this page is not a row in a collection, so it has no columns — only its title. Create it in a " +
                "collection if it needs properties.",
            );
          }
          return undefined;
        }
        if (!provider.getCollection) {
          // No schema to check against. The provider chose not to expose one,
          // so the values go through untouched and it validates them itself —
          // better than refusing a write the backend would have accepted.
          return { ...(values ?? {}) };
        }

        const collection = await collectionOf(collectionId);
        const merged = { ...(values ?? {}) };
        if (title !== undefined) merged[collection.titleProperty] = title;
        return validateWrite(collection.schema, merged, `collection ${JSON.stringify(collection.name)}`);
      };

      const resolveParent = async (parent: Parent): Promise<ParentRef> => {
        if (typeof parent === "object" && parent !== null) {
          if ("collectionId" in parent) return { type: "collection", id: ref(parent.collectionId) };
          if ("pageId" in parent) return { type: "page", id: ref(parent.pageId) };
        }
        if (typeof parent !== "string") {
          throw new Error("parent must be an id, a URL, or { pageId } / { collectionId }");
        }
        const id = ref(parent);
        const kind = await kindOf(id);
        if (kind === "page" || kind === "collection") return { type: kind, id };
        throw new Error(`${id} is a ${kind} — a page can only be created under a page or in a collection`);
      };

      const toRow = (page: Page, keep: Set<string> | null): Row => ({
        id: page.id,
        ...(page.url ? { url: page.url } : {}),
        title: page.title,
        properties: keep
          ? Object.fromEntries(Object.entries(page.properties ?? {}).filter(([name]) => keep.has(name)))
          : (page.properties ?? {}),
      });

      const pages = {
        /** Identity and properties, without walking the body. */
        async get(target: string): Promise<Page> {
          const id = ref(target);
          const page = await call(provider, "getPage", () => provider.getPage(id));
          kinds.set(page.id ?? id, "page");
          return page;
        },

        /** The whole page: properties, plus its content rendered as markdown. */
        async read(target: string, opts: ReadOptions = {}): Promise<PageContent> {
          const id = ref(target);
          const page = await call(provider, "getPage", () => provider.getPage(id));
          kinds.set(page.id ?? id, "page");
          const state = { truncated: false };
          const tree = await childrenOf(page.id ?? id, Math.max(1, opts.depth ?? defaultDepth), state);
          return {
            ...page,
            markdown: toMarkdown(tree),
            blocks: flatten(tree),
            ...(state.truncated ? { truncated: true } : {}),
          };
        },

        /**
         * Create a page, under another page or as a row in a collection.
         *
         * `title` is shorthand: under a page it is the page title, and in a
         * collection it fills whichever column holds the title.
         */
        async create(parent: Parent, spec: NewPage = {}): Promise<Page> {
          const create = need(provider, "createPage");
          const target = await resolveParent(parent);
          const properties = await checked(
            target.type === "collection" ? target.id : undefined,
            spec.properties,
            spec.title,
          );

          const input: PageInput = {
            ...(spec.title !== undefined ? { title: spec.title } : {}),
            ...(properties ? { properties } : {}),
            ...(spec.icon ? { icon: spec.icon } : {}),
          };

          const body = bodyOf(spec);
          // Hand the provider the first chunk with the create, then continue
          // as appends — one page, however long the body.
          if (body.length > 0) input.blocks = body.slice(0, chunk);

          const page = await call(provider, "createPage", () => create.call(provider, target, input));
          kinds.set(page.id, "page");
          if (body.length > chunk) await appendAll(page.id, body.slice(chunk));
          return page;
        },

        /** Change properties, the title, the icon, or trash state. */
        async update(target: string, patch: PageUpdate = {}): Promise<Page> {
          const update = need(provider, "updatePage");
          const id = ref(target);
          if (Object.keys(patch ?? {}).length === 0) throw new Error("update() was given nothing to change");

          let properties = patch.properties;
          if (patch.properties && Object.keys(patch.properties).length > 0) {
            const page = await call(provider, "getPage", () => provider.getPage(id));
            properties = (await checked(collectionIdOf(page), patch.properties, undefined)) as
              | Record<string, unknown>
              | undefined;
          }

          const body: PagePatch = {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(properties ? { properties } : {}),
            ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
          };
          return call(provider, "updatePage", () => update.call(provider, id, body));
        },

        /** Add content to the end of a page. Markdown or blocks. */
        async append(target: string, content: string | { markdown?: string; blocks?: Block[] }): Promise<number> {
          const body = bodyOf(content);
          if (body.length === 0) throw new Error("append() was given no content");
          return appendAll(ref(target), body);
        },

        /**
         * Write a page into the tree as markdown.
         *
         * The bridge to the rest of the environment: what it writes is an
         * ordinary path, so `env:documents` can turn it into a PDF and
         * `env:fs` can grep it.
         */
        async export(target: string, path: string, opts: ExportOptions = {}): Promise<ExportResult> {
          const depth = Math.max(1, opts.depth ?? defaultDepth);
          const limit = Math.max(1, opts.maxPages ?? maxExportPages);
          const files: string[] = [];
          const assets: string[] = [];
          const seen = new Set<string>();

          const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
          const stem = baseName(path);
          const assetDir = `${dir}/${stem}.assets`;

          const writeOne = async (pageTarget: string, filePath: string): Promise<string[]> => {
            const id = ref(pageTarget);
            if (seen.has(id) || seen.size >= limit) return [];
            seen.add(id);

            const page = await call(provider, "getPage", () => provider.getPage(id));
            const state = { truncated: false };
            const tree = await childrenOf(page.id ?? id, depth, state);
            let markdown = `# ${page.title || "Untitled"}\n\n${toMarkdown(tree)}\n`;

            if (opts.assets && provider.fetchFile) {
              for (const url of assetUrls(tree)) {
                const assetPath = `${assetDir}/${assetName(url, assets.length + 1)}`;
                try {
                  await download(url, assetPath);
                  assets.push(assetPath);
                  markdown = markdown.split(url).join(assetPath);
                } catch {
                  // A signed URL that expired before we got to it is not a
                  // reason to lose the page; the link stays as it was.
                }
              }
            }

            await vfs.writeFile(filePath, markdown);
            files.push(filePath);

            if (!opts.recursive) return [];
            return tree.filter((block) => block.type === "child_page" && block.id).map((block) => block.id as string);
          };

          if (opts.assets && !provider.fetchFile) {
            throw new UnsupportedError(
              provider.name,
              "fetchFile",
              "export({ assets: true }) needs it; export without assets, or implement it",
            );
          }

          const queue = await writeOne(target, path);
          while (queue.length > 0 && seen.size < limit) {
            const childId = queue.shift() as string;
            const more = await writeOne(childId, `${dir}/${stem}/${slug(childId)}.md`);
            queue.push(...more);
          }

          return { path, files, pages: files.length, ...(opts.assets ? { assets } : {}) };
        },
      };

      // ---------------------------------------------------- collections

      const collections = {
        /** The schema: every column, its type, and the options a select offers. */
        async get(target: string): Promise<Collection> {
          const id = ref(target);
          const collection = await collectionOf(id);
          kinds.set(collection.id ?? id, "collection");
          return collection;
        },

        /**
         * Rows, as flat records.
         *
         * Whatever the provider could not filter or sort itself is applied
         * here, over the rows it returned — so the answer is right even
         * against a backend that pushes nothing down.
         */
        async query(target: string, opts: QueryOptions = {}): Promise<Row[]> {
          const run = need(provider, "queryCollection");
          const id = ref(target);
          const { properties, ...query } = opts;
          const keep = properties ? new Set(properties) : null;

          const rows: Page[] = [];
          let cursor = query.cursor;
          let leftover: { where?: Condition[]; sort?: Query["sort"] } = {};
          // Client-side filtering has to see every row before it can honour a
          // limit, so the limit is only pushed down when the backend applied
          // the whole filter.
          let exhausted = false;
          for (let page = 0; page < MAX_QUERY_PAGES; page++) {
            const result = await call(provider, "queryCollection", () =>
              run.call(provider, id, { ...query, ...(cursor ? { cursor } : {}) }),
            );
            rows.push(...(result?.rows ?? []));
            leftover = result?.unsupported ?? {};
            // A limit can only be pushed down when the backend applied the
            // whole filter; otherwise the rows that survive it are not known
            // until every one has been seen.
            const satisfied =
              query.limit !== undefined &&
              rows.length >= query.limit &&
              !leftover.where?.length &&
              !leftover.sort?.length;
            if (!result?.cursor || satisfied) {
              exhausted = true;
              break;
            }
            cursor = result.cursor;
          }
          if (!exhausted) {
            throw new Error(
              `collection ${id} returned more than ${MAX_QUERY_PAGES} pages of rows. Narrow it with a filter or a ` +
                `limit — returning what arrived would look like the whole answer.`,
            );
          }

          let out = applyWhere(rows, leftover.where, query.match ?? "and");
          out = applySort(out, leftover.sort);
          if (query.limit !== undefined) out = out.slice(0, query.limit);
          return out.map((row) => toRow(row, keep));
        },
      };

      // --------------------------------------------------------- blocks

      const blocks = {
        /** A block's children, walked `depth` levels. A page id is a block id. */
        async children(target: string, opts: ChildrenOptions = {}): Promise<FlatBlock[] | Block[]> {
          const state = { truncated: false };
          const tree = await childrenOf(ref(target), Math.max(1, opts.depth ?? defaultDepth), state);
          return opts.raw ? tree : flatten(tree);
        },

        /** Append blocks, or markdown converted to them. */
        async append(target: string, content: string | { markdown?: string; blocks?: Block[] }): Promise<number> {
          return pages.append(target, content);
        },

        /** Change one block in place. */
        async update(target: string, patch: Partial<Block>): Promise<Block> {
          const update = need(provider, "updateBlock");
          return call(provider, "updateBlock", () => update.call(provider, ref(target), patch));
        },

        /** Delete a block. Most backends make this recoverable; check yours. */
        async remove(target: string): Promise<{ id: string; deleted: true }> {
          const remove = need(provider, "deleteBlock");
          const id = ref(target);
          await call(provider, "deleteBlock", () => remove.call(provider, id));
          return { id, deleted: true };
        },
      };

      // ------------------------------------------------------ top level

      /**
       * Pull a file out of the backend and into the tree.
       *
       * Hosted file URLs are usually signed and short-lived, so a URL read
       * from a page is worth one fetch. Everything downstream works on paths,
       * and this is how a remote attachment becomes one.
       *
       * The fetch is the **provider's**, not base's: this environment has no
       * network by construction, and handing it a general one through the
       * back door would undo the reason it has none.
       */
      const download = async (url: string, path: string): Promise<string> => {
        const fetchFile = need(
          provider,
          "fetchFile",
          "base has no network of its own, so a provider has to do the fetching",
        );
        if (typeof url !== "string" || url === "") throw new Error("download() needs a URL");
        const file = await call(provider, "fetchFile", () => fetchFile.call(provider, url));
        const bytes = file?.bytes;
        if (!(bytes instanceof Uint8Array)) {
          throw new ProviderError(provider.name, "fetchFile() must resolve to { bytes: Uint8Array }");
        }
        if (bytes.byteLength > maxDownloadBytes) {
          throw new Error(`${path} would be ${bytes.byteLength} bytes, over the ${maxDownloadBytes} cap`);
        }
        await vfs.writeFile(path, bytes);
        return path;
      };

      return {
        pages,
        collections,
        blocks,
        download,

        /**
         * What is this? The cheap first call for an id or a pasted URL, when
         * you do not yet know whether you hold a page or a collection.
         */
        async describe(target: string): Promise<Summary> {
          const id = ref(target);
          const kind = await kindOf(id);

          if (kind === "collection") {
            const collection = await collectionOf(id);
            return {
              id: collection.id ?? id,
              kind: "collection",
              title: collection.name,
              ...(collection.url ? { url: collection.url } : {}),
              ...(collection.parent ? { parent: collection.parent } : {}),
              schema: Object.fromEntries(Object.entries(collection.schema).map(([name, c]) => [name, c.type])),
              computed: Object.entries(collection.schema)
                .filter(([, column]) => isComputed(column))
                .map(([name]) => name),
            };
          }

          const page = await call(provider, "getPage", () => provider.getPage(id));
          const state = { truncated: false };
          const tree = await childrenOf(page.id ?? id, 1, state);
          const names = Object.keys(page.properties ?? {});
          return {
            id: page.id ?? id,
            kind: "page",
            title: page.title,
            ...(page.url ? { url: page.url } : {}),
            ...(page.parent ? { parent: page.parent } : {}),
            blocks: tree.length,
            ...(names.length > 0 ? { properties: names } : {}),
          };
        },

        /** What this provider can do. Optional methods are genuinely optional. */
        async capabilities(): Promise<Capabilities> {
          return capabilities;
        },

        /** Find things. What is searched is the provider's business — read its docs. */
        async search(query: string, opts: { kind?: "page" | "collection"; limit?: number } = {}) {
          const run = need(provider, "search");
          const result = await call(provider, "search", () => run.call(provider, String(query ?? ""), opts));
          const hits = result?.hits ?? [];
          return opts.limit ? hits.slice(0, opts.limit) : hits;
        },

        /**
         * The escape hatch, straight through to the provider.
         *
         * Every backend outgrows its wrapper, usually within a release. A
         * provider that offers `request` gives a script a way through instead
         * of a wall.
         */
        async request(method: string, path: string, body?: unknown): Promise<unknown> {
          const run = need(provider, "request", "it is the provider's opt-in escape hatch");
          return call(provider, "request", () => run.call(provider, method, path, body));
        },
      };
    },
  });
}

export default base;

// ------------------------------------------------------------------ helpers

/** A page's collection, from whichever field carries it. */
function collectionIdOf(page: Page): string | undefined {
  if (page.collectionId) return page.collectionId;
  return page.parent?.type === "collection" ? page.parent.id : undefined;
}

function baseName(path: string): string {
  const last = path.split("/").pop() ?? path;
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}

/** An id as a filename: safe characters only, never empty. */
function slug(id: string): string {
  const cleaned = id.replace(/[^\w.-]/g, "");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "page" : cleaned.slice(0, 120);
}

/** Every file URL in a block tree, in document order, de-duplicated. */
function assetUrls(blocks: Block[]): string[] {
  const urls: string[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (typeof block.url === "string" && block.url !== "" && FILE_BLOCKS.has(block.type)) urls.push(block.url);
      if (block.children) walk(block.children);
    }
  };
  walk(blocks ?? []);
  return [...new Set(urls)];
}

const FILE_BLOCKS = new Set(["image", "video", "audio", "file"]);

/** Pages of rows one query will walk before it refuses to pretend it has them all. */
const MAX_QUERY_PAGES = 200;

/** A URL's filename, with its query string discarded and its position kept. */
function assetName(url: string, ordinal: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    name = "";
  }
  name = name.replace(/[^\w.-]/g, "_");
  return name === "" || name === "." || name === ".." ? `asset-${ordinal}` : `${ordinal}-${name}`;
}

