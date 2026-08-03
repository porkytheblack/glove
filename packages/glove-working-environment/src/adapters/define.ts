/**
 * The stdlib adapter authoring contract.
 *
 * An adapter bridges a real host-side library (pdf-lib, exceljs, sharp, …)
 * into the environment. The model experiences it as a typed importable
 * module — `import { pdf } from 'env:documents'` — plus docs materialized
 * read-only at `/std/<name>/`.
 *
 * {@link defineAdapter} is the front door: it types the bindings, checks the
 * spec eagerly (so mistakes surface in the adapter's own tests rather than at
 * environment creation), and hands `create` a context alongside the VFS
 * handle.
 */
import type { EnvFsHandle, StdlibAdapter } from "../types";
import { validateHandles, type HandlesSpec } from "./handles";

/** The shape an adapter's `create` returns: a module namespace. */
export type AdapterBindings = Record<string, unknown>;

/** Second argument to {@link AdapterSpec.create}. */
export interface AdapterContext {
  /** The registered module name — scripts import it as `env:<name>`. */
  name: string;
  /**
   * True for the instance backing write-time script validation, where the VFS
   * handle refuses every mutation (a rejected `write_file` must leave no
   * trace, and validation runs module top-level code). Adapters that
   * pre-compute or warm caches can skip that work; most can ignore this.
   *
   * `create` is therefore called twice per environment and must be free of
   * side effects outside the handle it is given.
   */
  readOnly: boolean;
}

export interface AdapterSpec<T extends AdapterBindings> {
  /** Module name: `"documents"` → `import { pdf } from 'env:documents'`. */
  name: string;
  /** One-liner surfaced in the run_script tool description and in `ls /std`. */
  description: string;
  /** `.d.ts` source describing the exports; materialized at `/std/<name>/index.d.ts`. */
  types: string;
  /** README with worked examples; materialized at `/std/<name>/README.md`. */
  docs?: string;
  /**
   * The files this adapter understands, declared so the environment can route
   * to it without calling in. Pairs with a `describe(path)` binding: the
   * `describe` verb dispatches here, and `ls` uses it to say which module can
   * open an otherwise opaque binary.
   *
   * ```ts
   * handles: { extensions: [".png", ".jpg"], magic: [{ bytes: [0x89, 0x50, 0x4e, 0x47] }] }
   * ```
   *
   * Magic bytes are matched first and beat any extension claim — a PDF named
   * `.docx` is a PDF.
   */
  handles?: HandlesSpec;
  /**
   * Produce the bindings. ALL I/O must go through the given handle — it is
   * the capability boundary, routing through the same guarded gateway as the
   * model verbs (zones, limits, script pipeline, version recording). An
   * adapter that reaches for the network or the host filesystem breaks the
   * contract; the environment cannot detect it, so don't.
   */
  create(vfs: EnvFsHandle, ctx: AdapterContext): T;
}

/**
 * A defined adapter. Structurally a {@link StdlibAdapter} — pass it straight
 * to `createWorkingEnvironment({ stdlib: [...] })` — but with `create`'s
 * return type preserved so host-side callers and tests keep their types.
 */
export interface DefinedAdapter<T extends AdapterBindings> extends StdlibAdapter {
  create(vfs: EnvFsHandle, ctx?: Partial<AdapterContext>): T;
}

/**
 * The `describe(path)` convention (one per format adapter): a tokens-cheap
 * structural summary of a binary artifact, so a model can orient without
 * reading bytes it cannot interpret. Adapters extend this with
 * format-specific fields — page counts, sheet names, image dimensions.
 */
export interface FileSummary {
  /** The path described, echoed back so the summary stands alone in context. */
  path: string;
  /** Format tag, e.g. "pdf", "xlsx", "png". */
  format: string;
  /** Size of the file on disk. */
  bytes: number;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** Names that would collide with a builtin module. */
const RESERVED = new Set(["fs", "std"]);

/**
 * Declare a stdlib adapter. Validates the spec immediately and returns a
 * ready-to-register adapter.
 *
 * ```ts
 * export const images = () =>
 *   defineAdapter({
 *     name: "images",
 *     description: "Inspect and transform raster images.",
 *     types: IMAGES_TYPES,
 *     docs: IMAGES_DOCS,
 *     create: (vfs) => ({
 *       async describe(path) { ... },
 *       async resize(input, output, opts) { ... },
 *     }),
 *   });
 * ```
 */
export function defineAdapter<T extends AdapterBindings>(spec: AdapterSpec<T>): DefinedAdapter<T> {
  const where = `stdlib adapter ${JSON.stringify(spec?.name ?? "(unnamed)")}`;
  if (!spec || typeof spec !== "object") throw new TypeError("defineAdapter expects a spec object");
  if (typeof spec.name !== "string" || !NAME_RE.test(spec.name)) {
    throw new TypeError(
      `${where}: name must match ${NAME_RE.source} — lowercase, starting with a letter, e.g. "spreadsheets" (it becomes the import specifier env:<name>)`,
    );
  }
  if (RESERVED.has(spec.name)) {
    throw new TypeError(`${where}: "${spec.name}" is a builtin module name — pick another`);
  }
  if (typeof spec.description !== "string" || spec.description.trim() === "") {
    throw new TypeError(`${where}: description is required — one line, shown in the tool description and in ls /std`);
  }
  if (typeof spec.types !== "string" || spec.types.trim() === "") {
    throw new TypeError(
      `${where}: types is required — .d.ts source for the module's exports, materialized at /std/${spec.name}/index.d.ts. It is how the model learns the API.`,
    );
  }
  if (spec.docs !== undefined && typeof spec.docs !== "string") {
    throw new TypeError(`${where}: docs must be a string (markdown) when provided`);
  }
  if (typeof spec.create !== "function") {
    throw new TypeError(`${where}: create(vfs, ctx) is required and must return the module's bindings`);
  }
  if (spec.handles !== undefined) validateHandles(spec.handles, where);

  const create = (vfs: EnvFsHandle, ctx?: Partial<AdapterContext>): T => {
    const bindings = spec.create(vfs, { name: spec.name, readOnly: false, ...ctx });
    if (!bindings || typeof bindings !== "object") {
      throw new TypeError(`${where}: create() must return an object of bindings, got ${bindings === null ? "null" : typeof bindings}`);
    }
    return bindings;
  };

  return {
    name: spec.name,
    description: spec.description.trim(),
    types: spec.types,
    ...(spec.docs === undefined ? {} : { docs: spec.docs }),
    ...(spec.handles === undefined ? {} : { handles: spec.handles }),
    create,
  };
}
