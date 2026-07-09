/**
 * The function catalog — capabilities as plain callables.
 *
 * The table contract ({@link ../db/provider!ResourceTable}) asks authors to
 * model each capability as an entity: columns, required pushdown keys, a
 * volatility class. That's the right shape when the data is worth querying,
 * and the wrong amount of ceremony when the tools are unknown up front (an
 * arbitrary MCP server discovered at runtime has no columns to declare).
 *
 * A {@link ToolFn} is the light alternative: the contract IS the tool's own
 * description + input schema, the result is whatever the tool returns (plain
 * data), and a REPL surface (glove-lisp's function mode, glove-js) exposes it
 * as a callable the model composes with core language primitives. No table
 * modeling, no pushdown, no volatility — a call fires when its form evaluates.
 */
import { z } from "zod";

export interface ToolFnContext {
  signal?: AbortSignal;
  /** Stamped by the session (audit trails on the underlying tool). */
  actor?: string;
}

/**
 * A capability as a plain async function. `inputSchema` is descriptive — the
 * surfaces use it for discovery (`fns()` / `describe`), for the primed catalog,
 * and for missing-required / unknown-key checks before a call fires.
 */
export interface ToolFn {
  /** Callable name — `[A-Za-z_][A-Za-z0-9_]*` (enforced at register). */
  name: string;
  description?: string;
  /** JSON Schema for the input object. Absent = "any object". */
  inputSchema?: Record<string, unknown>;
  /** Informational effect hint (preamble grouping, `fns()` output). Never gates. */
  readOnlyHint?: boolean;
  /**
   * A TS-like description of what a call RETURNS (e.g. `{ id: string, count:
   * number }[]`), for discovery. Absent unless populated by
   * {@link ../fns/shape!sampleResultShapes} — the input schema says how to CALL a
   * function; this says what a row looks like, so the model needn't guess field
   * names. Surfaced by `describe(...)` and the primed catalog.
   */
  resultShape?: string;
  /** Fire the tool. Returns plain data (JSON-parsed where possible). Throws on error. */
  call(args: Record<string, unknown>, ctx?: ToolFnContext): Promise<unknown>;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate a callable name — surfaces bind it as an identifier in both Lisp and JS. */
export function assertFnName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid function name "${name}" — names must match [A-Za-z_][A-Za-z0-9_]* so they bind as identifiers. Rename it (defineFn's "name", fnFromTool's opts.name, or fnsFromMcp's opts.filter).`,
    );
  }
}

/** A registry of {@link ToolFn}s — one catalog can mount on any surface. */
export class FnCatalog {
  private fns = new Map<string, ToolFn>();

  register(fn: ToolFn): void {
    assertFnName(fn.name);
    if (this.fns.has(fn.name)) {
      throw new Error(`function "${fn.name}" is already registered`);
    }
    this.fns.set(fn.name, fn);
  }

  registerAll(fns: ToolFn[]): void {
    for (const fn of fns) this.register(fn);
  }

  get(name: string): ToolFn | undefined {
    return this.fns.get(name);
  }

  list(): ToolFn[] {
    return [...this.fns.values()];
  }

  names(): string[] {
    return [...this.fns.keys()];
  }
}

/** A Zod object schema, duck-typed so we accept any Zod v4 instance. */
type AnyZodObject = z.ZodObject<any, any>;

function isZodSchema(v: unknown): v is AnyZodObject {
  return typeof v === "object" && v !== null && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

/** One line per issue — a multi-line zod dump is unreadable mid-transcript. */
export function summarizeZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
}

export interface DefineFnSpec<S extends AnyZodObject = AnyZodObject> {
  name: string;
  description?: string;
  /** Raw JSON Schema, or a Zod object (converted; also validates args at call time). */
  input?: Record<string, unknown> | S;
  readOnlyHint?: boolean;
  handler(args: Record<string, unknown>, ctx: ToolFnContext): Promise<unknown> | unknown;
}

/** Author a {@link ToolFn} inline — the no-underlying-Glove-tool case. */
export function defineFn(spec: DefineFnSpec): ToolFn {
  assertFnName(spec.name);
  const zod = isZodSchema(spec.input) ? spec.input : undefined;
  const inputSchema = zod
    ? (z.toJSONSchema(zod, { unrepresentable: "any" }) as Record<string, unknown>)
    : (spec.input as Record<string, unknown> | undefined);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    readOnlyHint: spec.readOnlyHint,
    async call(args, ctx = {}) {
      let input = args;
      if (zod) {
        const parsed = zod.safeParse(args);
        if (!parsed.success) {
          throw new Error(`${spec.name}: ${summarizeZodError(parsed.error)}`);
        }
        input = parsed.data as Record<string, unknown>;
      }
      return spec.handler(input, ctx);
    },
  };
}
