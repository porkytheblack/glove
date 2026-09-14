/**
 * The provider contract: everything base does not know how to do.
 *
 * Base owns the model and the work above it — rendering a block tree as
 * markdown, walking it to a depth, checking a write against a schema,
 * chunking a long body, exporting a subtree into the filesystem, and telling a
 * script what went wrong. None of that is backend-specific, and none of it
 * should be written twice.
 *
 * What is backend-specific is exactly this interface: fetch a page, list a
 * block's children, read a schema, query rows, write things back. A provider
 * translates its own API into {@link Page}, {@link Block} and
 * {@link Collection} and stops there.
 *
 * ## Two methods are required; the rest are capabilities
 *
 * `getPage` and `listBlocks` are the floor — without them there is nothing to
 * read. Everything else is optional, and base reports what is missing rather
 * than crashing into it: a read-only provider is a legitimate provider, and a
 * script gets `provider "wiki" does not implement createPage()` instead of
 * `undefined is not a function`.
 *
 * ```ts
 * const wiki: Provider = {
 *   name: "wiki",
 *   async getPage(id) {
 *     const doc = await api.get(`/docs/${id}`);
 *     return { id: doc.id, title: doc.title, updatedAt: doc.modified };
 *   },
 *   async listBlocks(parentId) {
 *     const nodes = await api.get(`/docs/${parentId}/nodes`);
 *     return { blocks: nodes.map(toBlock) };
 *   },
 * };
 *
 * const env = await createWorkingEnvironment({ stdlib: [base({ provider: wiki })] });
 * ```
 *
 * ## Rules a provider must hold
 *
 * 1. **Return the model, not your wire format.** Whatever does not fit, park
 *    in `raw`; base never drops it and never interprets it.
 * 2. **One level per `listBlocks` call.** Base does the recursion, because
 *    base is the one that knows how deep the caller asked to go. Set
 *    `hasChildren` so it knows there is more.
 * 3. **Paginate with `cursor`.** Return the next one; base loops until it is
 *    absent. Never return a partial list without a cursor — a truncated
 *    result set is the failure mode that reads as a correct answer.
 * 4. **Push down what you can, declare what you cannot.** Say so in
 *    `unsupported` and base finishes the filter and the sort in memory. Silent
 *    non-application returns wrong rows; declaring it returns right ones.
 * 5. **Throw {@link ProviderError}** so failures carry your name and a code.
 */
import { ProviderError, UnsupportedError } from "./model";
import type { Block, Collection, Page, Query, QueryResult, Ref, RichText } from "./model";

/** What a page looks like on the way in. */
export interface PageInput {
  title?: string;
  /** Validated against the collection's schema before it reaches you. */
  properties?: Record<string, unknown>;
  /** Already converted from markdown, if that is how the caller wrote it. */
  blocks?: Block[];
  icon?: string;
}

export interface PagePatch {
  title?: string;
  properties?: Record<string, unknown>;
  icon?: string;
  /** Move to trash, or restore from it. */
  archived?: boolean;
}

/** Where a new page goes. */
export interface ParentRef {
  type: "page" | "collection";
  id: string;
}

export interface SearchOptions {
  kind?: "page" | "collection";
  limit?: number;
  cursor?: string;
}

export interface SearchResult {
  hits: Array<{ id: string; kind: "page" | "collection" | string; title: string; url?: string; updatedAt?: string }>;
  cursor?: string;
}

/**
 * A backend, as base needs to see it.
 *
 * Implement `name`, `getPage` and `listBlocks`. Add the rest as your backend
 * supports them.
 */
export interface Provider {
  /** Short, lowercase. It appears in every error this provider produces. */
  readonly name: string;

  // ---- required

  /** One page's identity and properties. Not its body. */
  getPage(id: string): Promise<Page>;

  /**
   * One level of children. Base recurses and paginates; you return what this
   * call gives you plus a cursor if there is more.
   *
   * A page id and a block id are usually the same namespace — `listBlocks` on
   * a page id is how a page's body is read.
   */
  listBlocks(parentId: string, opts?: { cursor?: string }): Promise<{ blocks: Block[]; cursor?: string }>;

  // ---- optional: reading

  /**
   * What kind of object an id names, when your backend can say cheaply.
   *
   * Without it, base probes: page, then collection. Implementing it saves a
   * failed request per lookup.
   */
  identify?(id: string): Promise<Ref["type"]>;

  /**
   * Normalize whatever a caller typed — a bare id, a URL, a share link — into
   * the id your other methods take. Base calls this first on every entry
   * point. Default: the input, trimmed.
   */
  parseRef?(input: string): string;

  /** A collection's schema. */
  getCollection?(id: string): Promise<Collection>;

  /** Rows. Push down what you can; declare the rest in `unsupported`. */
  queryCollection?(id: string, query: Query): Promise<QueryResult>;

  /** Titles, usually. Say so in your docs if it covers more. */
  search?(query: string, opts?: SearchOptions): Promise<SearchResult>;

  /**
   * Fetch a file the model referenced.
   *
   * Base has no network of its own and will not invent one: without this,
   * `download` is unavailable rather than falling back to a bare `fetch`.
   * Implement it — with whatever host restrictions your backend needs — and
   * `download` writes the bytes into the tree.
   */
  fetchFile?(url: string): Promise<{ bytes: Uint8Array; contentType?: string }>;

  // ---- optional: writing

  createPage?(parent: ParentRef, input: PageInput): Promise<Page>;
  updatePage?(id: string, patch: PagePatch): Promise<Page>;
  /** Append to the end of a page or block. Base has already chunked it. */
  appendBlocks?(parentId: string, blocks: Block[]): Promise<number>;
  updateBlock?(id: string, patch: Partial<Block>): Promise<Block>;
  deleteBlock?(id: string): Promise<void>;

  // ---- optional: everything else

  /**
   * The escape hatch, passed straight through to `request()` in scripts.
   *
   * Every backend outgrows its wrapper, usually within a release. A provider
   * that offers this gives a script a way through instead of a wall.
   */
  request?(method: string, path: string, body?: unknown): Promise<unknown>;

  /** Release connections. Called once, by `env.close()`. */
  close?(): Promise<void>;
}

/** The optional methods a provider implements, as plain booleans. */
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

export function capabilitiesOf(provider: Provider): Capabilities {
  const has = (name: keyof Provider) => typeof provider[name] === "function";
  return {
    provider: provider.name,
    identify: has("identify"),
    collections: has("getCollection"),
    query: has("queryCollection"),
    search: has("search"),
    files: has("fetchFile"),
    create: has("createPage"),
    update: has("updatePage"),
    append: has("appendBlocks"),
    editBlocks: has("updateBlock"),
    deleteBlocks: has("deleteBlock"),
    request: has("request"),
  };
}

/** Get an optional method or fail saying which provider lacks it. */
export function need<K extends keyof Provider>(
  provider: Provider,
  method: K,
  hint?: string,
): NonNullable<Provider[K]> {
  const fn = provider[method];
  if (typeof fn !== "function") throw new UnsupportedError(provider.name, String(method), hint);
  return fn as NonNullable<Provider[K]>;
}

/**
 * Run a provider call so a failure carries the provider's name.
 *
 * A bare `fetch failed` from four layers down sends a model looking at its own
 * arguments. `provider "wiki" getPage: fetch failed` sends it to the right
 * place on the first read.
 */
export async function call<T>(provider: Provider, method: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UnsupportedError) throw error;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider.name, `${method}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

// -------------------------------------------------------------- conformance

export interface ProviderReport {
  provider: string;
  ok: boolean;
  capabilities: Capabilities;
  /** Things that will break base. */
  errors: string[];
  /** Things that will make the provider harder to use well. */
  warnings: string[];
}

export interface VerifyOptions {
  /** A page the provider can read. Enables the live shape checks. */
  pageId?: string;
  /** A collection the provider can read. Enables the schema and row checks. */
  collectionId?: string;
}

/**
 * Check a provider against the contract.
 *
 * Written to be run from a provider author's own test suite: the static half
 * needs nothing, and passing a real id turns on the shape checks that catch
 * the mistakes a type signature cannot — a `listBlocks` that recurses on your
 * behalf, a paginated call with no cursor, a schema with no title column.
 *
 * ```ts
 * const report = await verifyProvider(wiki, { pageId: KNOWN_PAGE });
 * assert.deepEqual(report.errors, []);
 * ```
 */
export async function verifyProvider(provider: Provider, options: VerifyOptions = {}): Promise<ProviderReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof provider?.name !== "string" || provider.name.trim() === "") {
    errors.push("name is empty — it is what every error from this provider is attributed to");
  }
  for (const required of ["getPage", "listBlocks"] as const) {
    if (typeof provider?.[required] !== "function") errors.push(`${required}() is required`);
  }

  const capabilities = capabilitiesOf(provider ?? ({ name: "(unnamed)" } as Provider));

  if (capabilities.query && !capabilities.collections) {
    errors.push("queryCollection() without getCollection() — rows are unusable without the schema behind them");
  }
  if (capabilities.create && !capabilities.collections) {
    warnings.push("createPage() without getCollection() — writes into a collection cannot be schema-checked first");
  }
  if (!capabilities.request) {
    warnings.push("no request() — scripts have no way through when they need something this contract does not model");
  }

  if (errors.length === 0 && options.pageId) {
    try {
      const page = await provider.getPage(provider.parseRef?.(options.pageId) ?? options.pageId);
      if (typeof page?.id !== "string" || page.id === "") errors.push("getPage() returned no id");
      if (typeof page?.title !== "string") errors.push("getPage() returned no title — use an empty string, not undefined");
      if ((page as unknown as { properties?: unknown })?.properties !== undefined && typeof page.properties !== "object") {
        errors.push("getPage() returned a non-object `properties`");
      }
    } catch (error) {
      errors.push(`getPage(${options.pageId}) threw: ${message(error)}`);
    }

    try {
      const first = await provider.listBlocks(provider.parseRef?.(options.pageId) ?? options.pageId);
      if (!Array.isArray(first?.blocks)) {
        errors.push("listBlocks() must return { blocks: Block[] }");
      } else {
        for (const block of first.blocks) {
          if (typeof block?.type !== "string" || block.type === "") {
            errors.push("listBlocks() returned a block with no type — use 'unsupported' rather than omitting it");
            break;
          }
        }
        // Base recurses. A provider that also recurses does the work twice and
        // makes `depth` meaningless, which is invisible until a deep page.
        if (first.blocks.some((b) => Array.isArray(b.children) && b.children.length > 0)) {
          warnings.push(
            "listBlocks() returned nested children — base walks the tree itself, so returning one level is enough " +
              "and returning more makes the caller's `depth` mean nothing",
          );
        }
      }
    } catch (error) {
      errors.push(`listBlocks(${options.pageId}) threw: ${message(error)}`);
    }
  }

  if (errors.length === 0 && options.collectionId && capabilities.collections) {
    try {
      const id = provider.parseRef?.(options.collectionId) ?? options.collectionId;
      const collection = await provider.getCollection!(id);
      if (!collection?.schema || typeof collection.schema !== "object") {
        errors.push("getCollection() returned no schema");
      } else {
        const titles = Object.entries(collection.schema).filter(([, column]) => column?.type === "title");
        if (titles.length === 0) {
          errors.push("getCollection() returned a schema with no title column — every row needs one");
        } else if (!collection.titleProperty) {
          errors.push(`getCollection() left titleProperty empty — it should be ${JSON.stringify(titles[0][0])}`);
        }
      }
      if (capabilities.query) {
        const result = await provider.queryCollection!(id, { limit: 1 });
        if (!Array.isArray(result?.rows)) errors.push("queryCollection() must return { rows: Page[] }");
        else if (result.rows.length > 0 && typeof result.rows[0].properties !== "object") {
          warnings.push("queryCollection() returned rows with no `properties` — flat values are the point of a row");
        }
      }
    } catch (error) {
      errors.push(`collection checks threw: ${message(error)}`);
    }
  }

  return { provider: provider?.name ?? "(unnamed)", ok: errors.length === 0, capabilities, errors, warnings };
}

/** Throw a readable report unless the provider passed. Warnings never throw. */
export function assertProviderOk(report: ProviderReport): void {
  if (report.ok) return;
  throw new Error(
    `provider "${report.provider}" does not satisfy the contract:\n${report.errors.map((e) => `  ✗ ${e}`).join("\n")}`,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { Block, Collection, Page, Query, QueryResult, Ref, RichText };
